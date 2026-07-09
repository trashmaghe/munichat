import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LdapService } from './ldap.service';
import { ChannelSyncService } from './channel-sync.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

describe('AuthService', () => {
  let service: AuthService;
  let ldapService: {
    findUserByUsername: jest.Mock;
    verifyCredentials: jest.Mock;
  };
  let channelSyncService: { syncChannelsForUser: jest.Mock };
  let prisma: { user: { upsert: jest.Mock; findUnique: jest.Mock } };
  let redisService: {
    setRefreshToken: jest.Mock;
    getRefreshTokenUserId: jest.Mock;
    deleteRefreshToken: jest.Mock;
  };
  let jwtService: {
    sign: jest.Mock;
    verifyAsync: jest.Mock;
    decode: jest.Mock;
  };

  const now = Math.floor(Date.now() / 1000);
  const user = {
    id: 'user-1',
    adObjectGuid: 'uuid-1',
    username: 'jsilva',
    displayName: 'Joao Silva',
    email: 'jsilva@munichat.local',
    department: 'TI',
    avatarUrl: null,
    isActive: true,
    tokenVersion: 0,
    lastLoginAt: new Date(),
    lastSeenAt: null,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    ldapService = {
      findUserByUsername: jest.fn(),
      verifyCredentials: jest.fn(),
    };
    channelSyncService = { syncChannelsForUser: jest.fn() };
    prisma = { user: { upsert: jest.fn(), findUnique: jest.fn() } };
    redisService = {
      setRefreshToken: jest.fn(),
      getRefreshTokenUserId: jest.fn(),
      deleteRefreshToken: jest.fn(),
    };
    jwtService = {
      sign: jest
        .fn()
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token'),
      verifyAsync: jest.fn(),
      decode: jest.fn().mockImplementation((token: string) => ({
        exp: token === 'access-token' ? now + 900 : now + 604800,
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: LdapService, useValue: ldapService },
        { provide: ChannelSyncService, useValue: channelSyncService },
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redisService },
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(
              (key: string) =>
                ({
                  JWT_ACCESS_TTL: '15m',
                  JWT_REFRESH_TTL: '7d',
                  JWT_REFRESH_SECRET: 'refresh-secret',
                })[key],
            ),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('login', () => {
    it('issues tokens and syncs channels on successful LDAP bind', async () => {
      ldapService.findUserByUsername.mockResolvedValue({
        dn: 'uid=jsilva,ou=people,dc=munichat,dc=local',
        uniqueId: 'uuid-1',
        username: 'jsilva',
        displayName: 'Joao Silva',
        email: 'jsilva@munichat.local',
        department: 'TI',
        memberOf: ['cn=ti,ou=groups,dc=munichat,dc=local'],
      });
      ldapService.verifyCredentials.mockResolvedValue(true);
      prisma.user.upsert.mockResolvedValue(user);

      const result = await service.login('jsilva', 'correct-pass');

      expect(ldapService.verifyCredentials).toHaveBeenCalledWith(
        'uid=jsilva,ou=people,dc=munichat,dc=local',
        'correct-pass',
      );
      expect(channelSyncService.syncChannelsForUser).toHaveBeenCalledWith(
        'user-1',
        ['cn=ti,ou=groups,dc=munichat,dc=local'],
      );
      expect(result.user).toEqual(user);
      expect(result.tokens.accessToken).toBe('access-token');
      expect(result.tokens.refreshToken).toBe('refresh-token');
      expect(redisService.setRefreshToken).toHaveBeenCalledWith(
        expect.any(String),
        'user-1',
        expect.any(Number),
      );
    });

    it('rejects an unknown username', async () => {
      ldapService.findUserByUsername.mockResolvedValue(null);

      await expect(service.login('unknown', 'whatever')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(ldapService.verifyCredentials).not.toHaveBeenCalled();
    });

    it('rejects a wrong password', async () => {
      ldapService.findUserByUsername.mockResolvedValue({
        dn: 'uid=jsilva,ou=people,dc=munichat,dc=local',
        uniqueId: 'uuid-1',
        username: 'jsilva',
        displayName: 'Joao Silva',
        email: null,
        department: null,
        memberOf: [],
      });
      ldapService.verifyCredentials.mockResolvedValue(false);

      await expect(service.login('jsilva', 'wrong-pass')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(channelSyncService.syncChannelsForUser).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('rotates the refresh token and issues a new pair when everything checks out', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        jti: 'jti-1',
        tokenVersion: 0,
      });
      redisService.getRefreshTokenUserId.mockResolvedValue('user-1');
      prisma.user.findUnique.mockResolvedValue(user);

      const result = await service.refresh('old-refresh-token');

      expect(redisService.deleteRefreshToken).toHaveBeenCalledWith('jti-1');
      expect(result.tokens.accessToken).toBe('access-token');
    });

    it('rejects when the refresh token signature/expiry is invalid', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));

      await expect(service.refresh('bad-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects when the jti is not (or no longer) present in Redis', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        jti: 'jti-1',
        tokenVersion: 0,
      });
      redisService.getRefreshTokenUserId.mockResolvedValue(null);

      await expect(service.refresh('old-refresh-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects and revokes when tokenVersion no longer matches (global revoke)', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        jti: 'jti-1',
        tokenVersion: 0,
      });
      redisService.getRefreshTokenUserId.mockResolvedValue('user-1');
      prisma.user.findUnique.mockResolvedValue({ ...user, tokenVersion: 1 });

      await expect(service.refresh('old-refresh-token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(redisService.deleteRefreshToken).toHaveBeenCalledWith('jti-1');
    });

    it('rejects when the user has been deactivated', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        jti: 'jti-1',
        tokenVersion: 0,
      });
      redisService.getRefreshTokenUserId.mockResolvedValue('user-1');
      prisma.user.findUnique.mockResolvedValue({ ...user, isActive: false });

      await expect(service.refresh('old-refresh-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('deletes the refresh token from Redis using its decoded jti', async () => {
      jwtService.decode.mockReturnValueOnce({
        sub: 'user-1',
        jti: 'jti-1',
        tokenVersion: 0,
      });

      await service.logout('some-refresh-token');

      expect(redisService.deleteRefreshToken).toHaveBeenCalledWith('jti-1');
    });

    it('is a no-op when there is no refresh token cookie', async () => {
      await service.logout(undefined);

      expect(redisService.deleteRefreshToken).not.toHaveBeenCalled();
    });
  });
});
