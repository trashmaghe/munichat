import { Injectable } from '@nestjs/common';
import { MessageType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  decodeCursor,
  encodeCursor,
  MessageWithAuthor,
} from './message-response.mapper';

export interface GetHistoryOptions {
  cursor?: string;
  limit: number;
}

export interface HistoryPage {
  messages: MessageWithAuthor[];
  nextCursor: string | null;
}

export interface CreateMessageInput {
  channelId: string;
  authorId: string;
  content: string;
}

@Injectable()
export class MessagesService {
  constructor(private readonly prisma: PrismaService) {}

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
      include: { author: true },
    });

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const nextCursor = hasMore ? encodeCursor(page[page.length - 1]) : null;

    return { messages: page.reverse(), nextCursor };
  }

  async create({
    channelId,
    authorId,
    content,
  }: CreateMessageInput): Promise<MessageWithAuthor> {
    return this.prisma.message.create({
      data: { channelId, authorId, content, type: MessageType.TEXT },
      include: { author: true },
    });
  }
}
