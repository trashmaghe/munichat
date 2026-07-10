import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChannelsModule } from '../channels/channels.module';
import { MessagesModule } from '../messages/messages.module';
import { ChatAuthService } from './chat-auth.service';
import { ChatGateway } from './chat.gateway';
import { PresenceService } from './presence.service';

@Module({
  imports: [AuthModule, ChannelsModule, MessagesModule],
  providers: [ChatGateway, ChatAuthService, PresenceService],
  exports: [ChatGateway],
})
export class ChatModule {}
