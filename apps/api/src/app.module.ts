import path from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
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
import { createBullConnection } from './queue/bullmq-connection';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(__dirname, '..', '..', '..', '.env'),
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
  ],
})
export class AppModule {}
