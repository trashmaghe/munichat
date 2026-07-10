import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ChatModule } from '../chat/chat.module';
import { MessagesModule } from '../messages/messages.module';
import { QUEUE_NAMES } from '../queue/queue-names';
import { LinkPreviewProcessor } from './link-preview.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.LINK_PREVIEW }),
    ChatModule,
    MessagesModule,
  ],
  providers: [LinkPreviewProcessor],
})
export class LinkPreviewModule {}
