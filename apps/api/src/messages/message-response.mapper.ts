import { Message as MessageModel, User } from '@prisma/client';
import { Message as MessageDto } from '@munichat/shared';
import { toUserSummary } from '../users/user-summary.mapper';

export type MessageWithAuthor = MessageModel & { author: User };

export function toMessageDto(message: MessageWithAuthor): MessageDto {
  return {
    id: message.id,
    channelId: message.channelId,
    authorId: message.authorId,
    content: message.content,
    type: message.type,
    replyToId: message.replyToId,
    editedAt: message.editedAt?.toISOString() ?? null,
    deletedAt: message.deletedAt?.toISOString() ?? null,
    createdAt: message.createdAt.toISOString(),
    author: toUserSummary(message.author),
  };
}

interface CursorKey {
  createdAt: Date;
  id: string;
}

export function encodeCursor({ createdAt, id }: CursorKey): string {
  return Buffer.from(`${createdAt.toISOString()}_${id}`).toString('base64');
}

export function decodeCursor(cursor: string): CursorKey {
  const decoded = Buffer.from(cursor, 'base64').toString('utf8');
  const [createdAt, id] = decoded.split('_');
  return { createdAt: new Date(createdAt), id };
}
