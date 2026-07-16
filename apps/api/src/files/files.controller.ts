import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { User } from '@prisma/client';
import type { PresignUploadResponse } from '@munichat/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChannelsService } from '../channels/channels.service';
import { PresignUploadRequestDto } from './dto/presign-upload-request.dto';
import { FilesService } from './files.service';

@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(
    private readonly filesService: FilesService,
    private readonly channelsService: ChannelsService,
  ) {}

  @Post('presign')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async presign(
    @CurrentUser() user: User,
    @Body() dto: PresignUploadRequestDto,
  ): Promise<PresignUploadResponse> {
    const isMember = await this.channelsService.isMember(
      user.id,
      dto.channelId,
    );
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this channel');
    }
    return this.filesService.presignUpload(dto);
  }

  @Get(':id')
  async download(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<StreamableFile> {
    const attachment = await this.filesService.getAttachmentForDownload(id);
    if (!attachment || attachment.message.deletedAt !== null) {
      throw new NotFoundException('Attachment not found');
    }

    const isMember = await this.channelsService.isMember(
      user.id,
      attachment.message.channelId,
    );
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this channel');
    }

    const stream = await this.filesService.streamObject(attachment.objectKey);
    return new StreamableFile(stream, {
      type: attachment.mimeType,
      disposition: `attachment; filename="${attachment.fileName}"`,
      length: attachment.sizeBytes > 0 ? attachment.sizeBytes : undefined,
    });
  }
}
