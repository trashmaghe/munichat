import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

@Module({
  imports: [ChannelsModule],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
