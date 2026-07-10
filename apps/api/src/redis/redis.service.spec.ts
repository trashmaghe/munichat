import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

const mockRedisInstance = {
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  quit: jest.fn(),
  incr: jest.fn(),
  decr: jest.fn(),
  sadd: jest.fn(),
  srem: jest.fn(),
  smembers: jest.fn(),
};

jest.mock('ioredis', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => mockRedisInstance),
  };
});

describe('RedisService', () => {
  let service: RedisService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('redis://localhost:6379'),
          },
        },
      ],
    }).compile();

    service = module.get(RedisService);
    service.onModuleInit();
  });

  it('stores a refresh token under the refresh:{jti} key with the given TTL', async () => {
    await service.setRefreshToken('jti-1', 'user-1', 604800);

    expect(mockRedisInstance.set).toHaveBeenCalledWith(
      'refresh:jti-1',
      'user-1',
      'EX',
      604800,
    );
  });

  it('reads back the owning userId for a jti', async () => {
    mockRedisInstance.get.mockResolvedValue('user-1');

    const userId = await service.getRefreshTokenUserId('jti-1');

    expect(mockRedisInstance.get).toHaveBeenCalledWith('refresh:jti-1');
    expect(userId).toBe('user-1');
  });

  it('returns null when the jti is unknown or expired', async () => {
    mockRedisInstance.get.mockResolvedValue(null);

    const userId = await service.getRefreshTokenUserId('missing-jti');

    expect(userId).toBeNull();
  });

  it('deletes a refresh token on logout', async () => {
    await service.deleteRefreshToken('jti-1');

    expect(mockRedisInstance.del).toHaveBeenCalledWith('refresh:jti-1');
  });

  it('quits the client on module destroy', async () => {
    await service.onModuleDestroy();

    expect(mockRedisInstance.quit).toHaveBeenCalled();
  });

  it('increments the presence count for a user', async () => {
    mockRedisInstance.incr.mockResolvedValue(1);

    const count = await service.incrPresenceCount('user-1');

    expect(mockRedisInstance.incr).toHaveBeenCalledWith(
      'presence:count:user-1',
    );
    expect(count).toBe(1);
  });

  it('decrements the presence count for a user', async () => {
    mockRedisInstance.decr.mockResolvedValue(0);

    const count = await service.decrPresenceCount('user-1');

    expect(mockRedisInstance.decr).toHaveBeenCalledWith(
      'presence:count:user-1',
    );
    expect(count).toBe(0);
  });

  it('adds a user to the online set', async () => {
    await service.addOnlineUser('user-1');

    expect(mockRedisInstance.sadd).toHaveBeenCalledWith(
      'presence:online',
      'user-1',
    );
  });

  it('removes a user from the online set', async () => {
    await service.removeOnlineUser('user-1');

    expect(mockRedisInstance.srem).toHaveBeenCalledWith(
      'presence:online',
      'user-1',
    );
  });

  it('lists the online set members', async () => {
    mockRedisInstance.smembers.mockResolvedValue(['user-1', 'user-2']);

    const result = await service.listOnlineUsers();

    expect(mockRedisInstance.smembers).toHaveBeenCalledWith('presence:online');
    expect(result).toEqual(['user-1', 'user-2']);
  });
});
