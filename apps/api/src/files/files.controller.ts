import { Readable } from 'node:stream';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { User } from '@prisma/client';
import type { PresignUploadResponse } from '@elyzian/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChannelsService } from '../channels/channels.service';
import { PresignUploadRequestDto } from './dto/presign-upload-request.dto';
import { FilesService } from './files.service';

// Parses a single-range `Range: bytes=…` header against the object size.
// Returns the inclusive byte window, 'unsatisfiable' (→ 416), or null when the
// header is absent/malformed/multi-range (→ ignore, serve the full 200).
export function parseByteRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  let start: number;
  let end: number;
  if (rawStart === '') {
    // Suffix range: the last N bytes.
    const suffix = parseInt(rawEnd, 10);
    if (!suffix) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(rawStart, 10);
    end = rawEnd === '' ? size - 1 : parseInt(rawEnd, 10);
  }
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  if (start > end || start >= size) return 'unsatisfiable';
  return { start, end: Math.min(end, size - 1) };
}

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
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
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

    // `Content-Disposition: attachment` is kept — it governs top-level
    // navigation/downloads, not <video>/<audio>/<img> subresource loads, which
    // play/display inline regardless.
    const disposition = `attachment; filename="${attachment.fileName}"`;
    const total = attachment.sizeBytes;
    // Advertise range support so media elements can seek.
    res.setHeader('Accept-Ranges', 'bytes');

    const range = parseByteRange(req.headers['range'], total);
    if (range === 'unsatisfiable') {
      res.status(416);
      res.setHeader('Content-Range', `bytes */${total}`);
      return new StreamableFile(Readable.from([]));
    }
    if (range) {
      const stream = await this.filesService.streamObjectRange(
        attachment.objectKey,
        range.start,
        range.end,
      );
      res.status(206);
      res.setHeader(
        'Content-Range',
        `bytes ${range.start}-${range.end}/${total}`,
      );
      return new StreamableFile(stream, {
        type: attachment.mimeType,
        disposition,
        length: range.end - range.start + 1,
      });
    }

    const stream = await this.filesService.streamObject(attachment.objectKey);
    return new StreamableFile(stream, {
      type: attachment.mimeType,
      disposition,
      length: total > 0 ? total : undefined,
    });
  }
}
