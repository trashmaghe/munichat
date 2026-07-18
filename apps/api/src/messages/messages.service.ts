import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { MessageType, Prisma } from '@prisma/client';
import { PendingAttachment } from '@elyzian/shared';
import { PrismaService } from '../prisma/prisma.service';
import { FilesService } from '../files/files.service';
import { GlpiService, GlpiUnavailableError } from '../glpi/glpi.service';
import { LinkPreviewJobData, QUEUE_NAMES } from '../queue/queue-names';
import {
  decodeCursor,
  encodeCursor,
  MessageWithExtras,
} from './message-response.mapper';

const URL_PATTERN = /https?:\/\/\S+/i;
const TICKET_PREFIX_PATTERN = /^\/ticket(?:\s+([\s\S]*))?$/i;
const TICKET_TITLE_MAX_LENGTH = 80;

const MESSAGE_INCLUDE = {
  author: true,
  attachments: true,
  linkPreview: true,
  ticketRef: true,
  replyTo: { include: { author: true, attachments: true } },
} as const;

export interface GetHistoryOptions {
  cursor?: string;
  limit: number;
}

export interface HistoryPage {
  messages: MessageWithExtras[];
  nextCursor: string | null;
}

export interface SearchMessagesOptions {
  query: string;
  channelIds: string[];
  cursor?: string;
  limit: number;
}

export interface CreateMessageInput {
  channelId: string;
  authorId: string;
  content: string;
  replyToId?: string | null;
  attachments?: PendingAttachment[];
}

export type CreateMessageResult =
  { message: MessageWithExtras } | { error: string };

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly filesService: FilesService,
    private readonly glpiService: GlpiService,
    @InjectQueue(QUEUE_NAMES.LINK_PREVIEW)
    private readonly linkPreviewQueue: Queue<LinkPreviewJobData>,
  ) {}

  async getHistory(
    channelId: string,
    { cursor, limit }: GetHistoryOptions,
  ): Promise<HistoryPage> {
    const decoded = cursor ? decodeCursor(cursor) : null;

    const rows = await this.prisma.message.findMany({
      where: {
        channelId,
        ...(decoded
          ? {
              OR: [
                { createdAt: { lt: decoded.createdAt } },
                { createdAt: decoded.createdAt, id: { lt: decoded.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: MESSAGE_INCLUDE,
    });

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const nextCursor = hasMore ? encodeCursor(page[page.length - 1]) : null;

    return { messages: page.reverse(), nextCursor };
  }

  async search({
    query,
    channelIds,
    cursor,
    limit,
  }: SearchMessagesOptions): Promise<HistoryPage> {
    if (channelIds.length === 0) {
      return { messages: [], nextCursor: null };
    }

    const decoded = cursor ? decodeCursor(cursor) : null;

    // Only the ranking/scoping query touches raw SQL (tsvector can't be
    // expressed in a Prisma where-clause); the matching rows are then
    // re-fetched through the normal Prisma client so hydration reuses
    // MESSAGE_INCLUDE/toMessageDto exactly like getHistory does.
    const matches = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id"
      FROM "Message"
      WHERE "channelId" IN (${Prisma.join(channelIds)})
        AND "deletedAt" IS NULL
        AND message_search_vector("content") @@ websearch_to_tsquery('portuguese', ${query})
        ${
          decoded
            ? Prisma.sql`AND ("createdAt", "id") < (${decoded.createdAt}, ${decoded.id})`
            : Prisma.empty
        }
      ORDER BY "createdAt" DESC, "id" DESC
      LIMIT ${limit + 1}
    `);

    const hasMore = matches.length > limit;
    const page = matches.slice(0, limit);
    if (page.length === 0) {
      return { messages: [], nextCursor: null };
    }

    const rows = await this.prisma.message.findMany({
      where: { id: { in: page.map((row) => row.id) } },
      include: MESSAGE_INCLUDE,
    });
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const messages = page
      .map((row) => rowsById.get(row.id))
      .filter((row): row is MessageWithExtras => row !== undefined);

    const lastRow = rows.find((row) => row.id === page[page.length - 1].id);
    const nextCursor = hasMore && lastRow ? encodeCursor(lastRow) : null;

    return { messages, nextCursor };
  }

  async getById(id: string): Promise<MessageWithExtras | null> {
    return this.prisma.message.findUnique({
      where: { id },
      include: MESSAGE_INCLUDE,
    });
  }

  async create({
    channelId,
    authorId,
    content,
    replyToId,
    attachments,
  }: CreateMessageInput): Promise<CreateMessageResult> {
    const ticketMatch = TICKET_PREFIX_PATTERN.exec(content);
    if (ticketMatch) {
      return this.createTicketMessage(
        channelId,
        authorId,
        (ticketMatch[1] ?? '').trim(),
      );
    }

    for (const attachment of attachments ?? []) {
      const realSize = await this.filesService.getRealObjectSize(
        attachment.objectKey,
      );
      if (realSize === null) {
        return { error: 'Attachment was not found in storage' };
      }
      if (realSize !== attachment.sizeBytes) {
        return { error: 'Attachment size does not match the uploaded file' };
      }
    }

    const hasAttachments = (attachments?.length ?? 0) > 0;
    const type =
      hasAttachments && content.trim().length === 0
        ? MessageType.FILE
        : MessageType.TEXT;

    const message = await this.prisma.message.create({
      data: {
        channelId,
        authorId,
        content,
        type,
        replyToId: replyToId ?? null,
        attachments: hasAttachments
          ? {
              create: (attachments ?? []).map((attachment) => ({
                fileName: attachment.fileName,
                mimeType: attachment.mimeType,
                sizeBytes: attachment.sizeBytes,
                objectKey: attachment.objectKey,
              })),
            }
          : undefined,
      },
      include: MESSAGE_INCLUDE,
    });

    const url = content.match(URL_PATTERN)?.[0];
    if (url) {
      await this.linkPreviewQueue.add(
        'fetch-og-tags',
        { messageId: message.id, channelId, url },
        {
          attempts: 2,
          backoff: { type: 'fixed', delay: 2000 },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    }

    return { message };
  }

  private async createTicketMessage(
    channelId: string,
    authorId: string,
    description: string,
  ): Promise<CreateMessageResult> {
    if (!description) {
      return { error: 'Ticket description cannot be empty' };
    }

    const author = await this.prisma.user.findUniqueOrThrow({
      where: { id: authorId },
    });

    let ticket: { glpiTicketId: number; status: string };
    try {
      ticket = await this.glpiService.createTicket({
        title: description.slice(0, TICKET_TITLE_MAX_LENGTH),
        content: description,
        requesterLabel: `Reported via Elyzian by ${author.displayName} (${author.username})`,
      });
    } catch (err) {
      if (err instanceof GlpiUnavailableError) {
        return { error: 'GLPI is unreachable. Please try again later.' };
      }
      throw err;
    }

    const message = await this.prisma.message.create({
      data: {
        channelId,
        authorId,
        content: description,
        type: MessageType.TICKET,
        ticketRef: {
          create: {
            glpiTicketId: ticket.glpiTicketId,
            status: ticket.status,
            createdById: authorId,
          },
        },
      },
      include: MESSAGE_INCLUDE,
    });

    return { message };
  }

  // For bot/system-authored messages (e.g. Tactical RMM alerts) rather than
  // user input, so it deliberately skips the /ticket regex and link-preview
  // detection in create() — neither applies to a pre-formatted system message.
  async createSystemMessage(
    channelId: string,
    authorId: string,
    content: string,
  ): Promise<MessageWithExtras> {
    return this.prisma.message.create({
      data: {
        channelId,
        authorId,
        content,
        type: MessageType.SYSTEM,
      },
      include: MESSAGE_INCLUDE,
    });
  }

  async update(id: string, content: string): Promise<MessageWithExtras> {
    return this.prisma.message.update({
      where: { id },
      data: { content, editedAt: new Date() },
      include: MESSAGE_INCLUDE,
    });
  }

  async softDelete(id: string): Promise<MessageWithExtras> {
    return this.prisma.message.update({
      where: { id },
      data: { content: '', deletedAt: new Date() },
      include: MESSAGE_INCLUDE,
    });
  }
}
