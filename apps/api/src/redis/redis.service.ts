import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: Redis;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    this.client = new Redis(this.configService.get<string>('REDIS_URL')!);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  async setRefreshToken(
    jti: string,
    userId: string,
    ttlSeconds: number,
  ): Promise<void> {
    await this.client.set(this.refreshKey(jti), userId, 'EX', ttlSeconds);
  }

  async getRefreshTokenUserId(jti: string): Promise<string | null> {
    return this.client.get(this.refreshKey(jti));
  }

  async deleteRefreshToken(jti: string): Promise<void> {
    await this.client.del(this.refreshKey(jti));
  }

  private refreshKey(jti: string): string {
    return `refresh:${jti}`;
  }

  async incrPresenceCount(userId: string): Promise<number> {
    return this.client.incr(this.presenceCountKey(userId));
  }

  async decrPresenceCount(userId: string): Promise<number> {
    return this.client.decr(this.presenceCountKey(userId));
  }

  async addOnlineUser(userId: string): Promise<void> {
    await this.client.sadd(this.presenceOnlineKey(), userId);
  }

  async removeOnlineUser(userId: string): Promise<void> {
    await this.client.srem(this.presenceOnlineKey(), userId);
  }

  async listOnlineUsers(): Promise<string[]> {
    return this.client.smembers(this.presenceOnlineKey());
  }

  private presenceCountKey(userId: string): string {
    return `presence:count:${userId}`;
  }

  private presenceOnlineKey(): string {
    return 'presence:online';
  }
}
