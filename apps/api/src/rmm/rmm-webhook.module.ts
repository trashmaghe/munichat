import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { ChannelsModule } from '../channels/channels.module';
import { MessagesModule } from '../messages/messages.module';
import { UsersModule } from '../users/users.module';
import { RmmWebhookController } from './rmm-webhook.controller';

@Module({
  imports: [ChatModule, ChannelsModule, MessagesModule, UsersModule],
  controllers: [RmmWebhookController],
})
export class RmmWebhookModule {}
