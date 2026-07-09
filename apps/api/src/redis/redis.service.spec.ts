import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

const mockRedisInstance = {
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  quit: jest.fn(),
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
});
