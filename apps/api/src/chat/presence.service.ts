import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class PresenceService {
  constructor(private readonly redisService: RedisService) {}

  async markOnline(userId: string): Promise<boolean> {
    const count = await this.redisService.incrPresenceCount(userId);
    const isTransition = count === 1;
    if (isTransition) {
      await this.redisService.addOnlineUser(userId);
    }
    return isTransition;
  }

  async markOffline(userId: string): Promise<boolean> {
    const count = await this.redisService.decrPresenceCount(userId);
    const isTransition = count === 0;
    if (isTransition) {
      await this.redisService.removeOnlineUser(userId);
    }
    return isTransition;
  }

  async listOnlineUsers(): Promise<string[]> {
    return this.redisService.listOnlineUsers();
  }
}
