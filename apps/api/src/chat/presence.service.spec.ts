import { Test, TestingModule } from '@nestjs/testing';
import { PresenceService } from './presence.service';
import { RedisService } from '../redis/redis.service';

describe('PresenceService', () => {
  let service: PresenceService;
  let redisService: {
    incrPresenceCount: jest.Mock;
    decrPresenceCount: jest.Mock;
    addOnlineUser: jest.Mock;
    removeOnlineUser: jest.Mock;
    listOnlineUsers: jest.Mock;
  };

  beforeEach(async () => {
    redisService = {
      incrPresenceCount: jest.fn(),
      decrPresenceCount: jest.fn(),
      addOnlineUser: jest.fn(),
      removeOnlineUser: jest.fn(),
      listOnlineUsers: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PresenceService,
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    service = module.get(PresenceService);
  });

  describe('markOnline', () => {
    it('adds the user to the online set and returns true on the first connection (0->1)', async () => {
      redisService.incrPresenceCount.mockResolvedValue(1);

      const result = await service.markOnline('user-1');

      expect(result).toBe(true);
      expect(redisService.addOnlineUser).toHaveBeenCalledWith('user-1');
    });

    it('does not touch the online set and returns false for a second tab/socket (1->2)', async () => {
      redisService.incrPresenceCount.mockResolvedValue(2);

      const result = await service.markOnline('user-1');

      expect(result).toBe(false);
      expect(redisService.addOnlineUser).not.toHaveBeenCalled();
    });
  });

  describe('markOffline', () => {
    it('removes the user from the online set and returns true on the last disconnect (1->0)', async () => {
      redisService.decrPresenceCount.mockResolvedValue(0);

      const result = await service.markOffline('user-1');

      expect(result).toBe(true);
      expect(redisService.removeOnlineUser).toHaveBeenCalledWith('user-1');
    });

    it('does not touch the online set and returns false while other sockets remain (2->1)', async () => {
      redisService.decrPresenceCount.mockResolvedValue(1);

      const result = await service.markOffline('user-1');

      expect(result).toBe(false);
      expect(redisService.removeOnlineUser).not.toHaveBeenCalled();
    });
  });

  describe('listOnlineUsers', () => {
    it('delegates to RedisService', async () => {
      redisService.listOnlineUsers.mockResolvedValue(['user-1', 'user-2']);

      const result = await service.listOnlineUsers();

      expect(result).toEqual(['user-1', 'user-2']);
    });
  });
});
