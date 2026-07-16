import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { RmmController } from './rmm.controller';
import { RmmService } from './rmm.service';

@Module({
  imports: [ChannelsModule],
  controllers: [RmmController],
  providers: [RmmService],
  exports: [RmmService],
})
export class RmmModule {}
