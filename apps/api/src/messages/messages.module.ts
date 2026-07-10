import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ChannelsModule } from '../channels/channels.module';
import { FilesModule } from '../files/files.module';
import { QUEUE_NAMES } from '../queue/queue-names';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  imports: [
    ChannelsModule,
    FilesModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.LINK_PREVIEW }),
  ],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
