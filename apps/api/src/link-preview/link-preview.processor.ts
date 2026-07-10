import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { LinkPreviewStatus } from '@prisma/client';
import { SocketEvent } from '@munichat/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MessagesService } from '../messages/messages.service';
import { toMessageDto } from '../messages/message-response.mapper';
import { ChatGateway } from '../chat/chat.gateway';
import { channelRoom } from '../chat/channel-room';
import { LinkPreviewJobData, QUEUE_NAMES } from '../queue/queue-names';
import { guardedFetchHtml } from './link-preview.fetcher';
import { parseOgTags } from './link-preview.parser';

@Processor(QUEUE_NAMES.LINK_PREVIEW)
export class LinkPreviewProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messagesService: MessagesService,
    private readonly chatGateway: ChatGateway,
  ) {
    super();
  }

  async process(job: Job<LinkPreviewJobData>): Promise<void> {
    const { messageId, channelId, url } = job.data;

    const result = await guardedFetchHtml(url);

    if ('failed' in result) {
      await this.prisma.linkPreview.upsert({
        where: { messageId },
        create: {
          messageId,
          url,
          status: LinkPreviewStatus.FAILED,
          fetchedAt: new Date(),
        },
        update: { status: LinkPreviewStatus.FAILED, fetchedAt: new Date() },
      });
    } else {
      const { title, description, imageUrl } = parseOgTags(result.html);
      await this.prisma.linkPreview.upsert({
        where: { messageId },
        create: {
          messageId,
          url,
          title,
          description,
          imageUrl,
          status: LinkPreviewStatus.READY,
          fetchedAt: new Date(),
        },
        update: {
          title,
          description,
          imageUrl,
          status: LinkPreviewStatus.READY,
          fetchedAt: new Date(),
        },
      });
    }

    const message = await this.messagesService.getById(messageId);
    if (!message) {
      return;
    }
    const dto = toMessageDto(message);
    this.chatGateway.server
      .to(channelRoom(channelId))
      .emit(SocketEvent.MESSAGE_UPDATED, dto);
  }
}
