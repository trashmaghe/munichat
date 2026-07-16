import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ChannelsModule } from '../channels/channels.module';
import { FilesModule } from '../files/files.module';
import { GlpiModule } from '../glpi/glpi.module';
import { QUEUE_NAMES } from '../queue/queue-names';
import { MessagesController } from './messages.controller';
import { MessagesSearchController } from './messages-search.controller';
import { MessagesService } from './messages.service';

@Module({
  imports: [
    ChannelsModule,
    FilesModule,
    GlpiModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.LINK_PREVIEW }),
  ],
  controllers: [MessagesController, MessagesSearchController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
