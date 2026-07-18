import {
  Attachment as AttachmentModel,
  LinkPreview as LinkPreviewModel,
  Message as MessageModel,
  TicketRef as TicketRefModel,
  User,
} from '@prisma/client';
import {
  Attachment,
  Message as MessageDto,
  ReplyPreview,
} from '@elyzian/shared';
import { toUserSummary } from '../users/user-summary.mapper';

export type ReplyToMessage = MessageModel & {
  author: User;
  attachments: AttachmentModel[];
};

export type MessageWithExtras = MessageModel & {
  author: User;
  attachments: AttachmentModel[];
  linkPreview: LinkPreviewModel | null;
  ticketRef: TicketRefModel | null;
  replyTo: ReplyToMessage | null;
};

function toAttachmentDto(attachment: AttachmentModel): Attachment {
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
  };
}

export function toReplyPreview(replyTo: ReplyToMessage): ReplyPreview {
  const deleted = replyTo.deletedAt !== null;
  return {
    id: replyTo.id,
    authorId: replyTo.authorId,
    authorDisplayName: replyTo.author.displayName,
    contentPreview: deleted ? null : replyTo.content.slice(0, 120) || null,
    hasAttachment: replyTo.attachments.length > 0,
    deleted,
  };
}

export function toMessageDto(
  message: MessageWithExtras,
  glpiUrl: string,
): MessageDto {
  const deleted = message.deletedAt !== null;

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
    attachments: deleted ? [] : message.attachments.map(toAttachmentDto),
    linkPreview: deleted
      ? null
      : message.linkPreview
        ? {
            url: message.linkPreview.url,
            title: message.linkPreview.title,
            description: message.linkPreview.description,
            imageUrl: message.linkPreview.imageUrl,
            status: message.linkPreview.status,
          }
        : null,
    ticketRef:
      deleted || !message.ticketRef
        ? null
        : {
            glpiTicketId: message.ticketRef.glpiTicketId,
            status: message.ticketRef.status,
            url: `${glpiUrl}/front/ticket.form.php?id=${message.ticketRef.glpiTicketId}`,
            createdAt: message.ticketRef.createdAt.toISOString(),
            updatedAt: message.ticketRef.updatedAt.toISOString(),
          },
    replyTo: message.replyTo ? toReplyPreview(message.replyTo) : null,
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
