import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { LdapService } from './ldap.service';
import { ChannelSyncService } from './channel-sync.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
}

interface AccessTokenPayload {
  sub: string;
  tokenVersion: number;
}

interface RefreshTokenPayload {
  sub: string;
  jti: string;
  tokenVersion: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly ldapService: LdapService,
    private readonly channelSyncService: ChannelSyncService,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(
    username: string,
    password: string,
  ): Promise<{ user: User; tokens: TokenPair }> {
    const ldapUser = await this.ldapService.findUserByUsername(username);
    if (!ldapUser) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const verified = await this.ldapService.verifyCredentials(
      ldapUser.dn,
      password,
    );
    if (!verified) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const user = await this.prisma.user.upsert({
      where: { adObjectGuid: ldapUser.uniqueId },
      create: {
        adObjectGuid: ldapUser.uniqueId,
        username: ldapUser.username,
        displayName: ldapUser.displayName,
        email: ldapUser.email,
        department: ldapUser.department,
        lastLoginAt: new Date(),
      },
      update: {
        username: ldapUser.username,
        displayName: ldapUser.displayName,
        email: ldapUser.email,
        department: ldapUser.department,
        lastLoginAt: new Date(),
      },
    });

    await this.channelSyncService.syncChannelsForUser(
      user.id,
      ldapUser.departmentDn && ldapUser.department
        ? { dn: ldapUser.departmentDn, name: ldapUser.department }
        : null,
    );

    const tokens = await this.issueTokens(user);
    return { user, tokens };
  }

  async refresh(
    refreshToken: string,
  ): Promise<{ user: User; tokens: TokenPair }> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
        refreshToken,
        {
          secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        },
      );
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const ownerId = await this.redisService.getRefreshTokenUserId(payload.jti);
    if (!ownerId || ownerId !== payload.sub) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || !user.isActive || user.tokenVersion !== payload.tokenVersion) {
      await this.redisService.deleteRefreshToken(payload.jti);
      throw new UnauthorizedException('Session is no longer valid');
    }

    // Rotate: the presented refresh token is single-use.
    await this.redisService.deleteRefreshToken(payload.jti);

    const tokens = await this.issueTokens(user);
    return { user, tokens };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) {
      return;
    }
    const payload = this.jwtService.decode<RefreshTokenPayload | null>(
      refreshToken,
    );
    if (payload?.jti) {
      await this.redisService.deleteRefreshToken(payload.jti);
    }
  }

  private async issueTokens(user: User): Promise<TokenPair> {
    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      tokenVersion: user.tokenVersion,
    };
    const accessToken = this.jwtService.sign(accessPayload, {
      expiresIn: Number(this.configService.get<string>('JWT_ACCESS_TTL')),
    });

    const jti = uuidv4();
    const refreshPayload: RefreshTokenPayload = {
      sub: user.id,
      jti,
      tokenVersion: user.tokenVersion,
    };
    const refreshToken = this.jwtService.sign(refreshPayload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: Number(this.configService.get<string>('JWT_REFRESH_TTL')),
    });

    const accessTokenExpiresAt = this.expiryDateOf(accessToken);
    const refreshTokenExpiresAt = this.expiryDateOf(refreshToken);

    const ttlSeconds = Math.max(
      1,
      Math.floor((refreshTokenExpiresAt.getTime() - Date.now()) / 1000),
    );
    await this.redisService.setRefreshToken(jti, user.id, ttlSeconds);

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
    };
  }

  private expiryDateOf(token: string): Date {
    const decoded = this.jwtService.decode<{ exp: number }>(token);
    return new Date(decoded.exp * 1000);
  }
}
