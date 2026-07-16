import path from 'node:path';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { HealthModule } from './health/health.module';
import { ChannelsModule } from './channels/channels.module';
import { MessagesModule } from './messages/messages.module';
import { ChatModule } from './chat/chat.module';
import { FilesModule } from './files/files.module';
import { LinkPreviewModule } from './link-preview/link-preview.module';
import { GlpiWebhookModule } from './glpi/glpi-webhook.module';
import { RmmModule } from './rmm/rmm.module';
import { RmmWebhookModule } from './rmm/rmm-webhook.module';
import { createBullConnection } from './queue/bullmq-connection';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(__dirname, '..', '..', '..', '.env'),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
        storage: new ThrottlerStorageRedisService(
          configService.get<string>('REDIS_URL'),
        ),
        // The e2e suites share one source IP (127.0.0.1) and log the seeded
        // users in far more than the /auth/login limit allows, so throttling
        // them makes every suite 429. Skip throttling under Jest (NODE_ENV
        // === 'test'); the rate-limit e2e spec opts back in for its own run by
        // setting THROTTLE_DISABLED='false'. Production/dev are unaffected.
        skipIf: () =>
          process.env.NODE_ENV === 'test' &&
          process.env.THROTTLE_DISABLED !== 'false',
      }),
    }),
    BullModule.forRoot({ connection: createBullConnection() }),
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    HealthModule,
    ChannelsModule,
    MessagesModule,
    ChatModule,
    FilesModule,
    LinkPreviewModule,
    GlpiWebhookModule,
    RmmModule,
    RmmWebhookModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
