import { z } from 'zod';
import { MessageType } from './enums';
import { userSummarySchema } from './user.dto';
import { attachmentSchema, pendingAttachmentSchema } from './attachment.dto';
import { linkPreviewSchema } from './link-preview.dto';

export const replyPreviewSchema = z.object({
  id: z.string(),
  authorId: z.string(),
  authorDisplayName: z.string(),
  contentPreview: z.string().nullable(),
  hasAttachment: z.boolean(),
  deleted: z.boolean(),
});

export type ReplyPreview = z.infer<typeof replyPreviewSchema>;

export const messageSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  authorId: z.string(),
  content: z.string(),
  type: z.nativeEnum(MessageType),
  replyToId: z.string().nullable(),
  editedAt: z.string().nullable(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  author: userSummarySchema,
  attachments: z.array(attachmentSchema),
  linkPreview: linkPreviewSchema.nullable(),
  replyTo: replyPreviewSchema.nullable(),
});

export type Message = z.infer<typeof messageSchema>;

export const sendMessageRequestSchema = z
  .object({
    channelId: z.string(),
    content: z.string().trim().max(4000),
    replyToId: z.string().nullable().optional(),
    attachments: z.array(pendingAttachmentSchema).max(1).optional(),
  })
  .superRefine((value, ctx) => {
    const hasContent = value.content.trim().length > 0;
    const hasAttachments = (value.attachments?.length ?? 0) > 0;
    if (!hasContent && !hasAttachments) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A message needs content or at least one attachment',
        path: ['content'],
      });
    }
  });

export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export const messageHistoryResponseSchema = z.object({
  messages: z.array(messageSchema),
  nextCursor: z.string().nullable(),
});

export type MessageHistoryResponse = z.infer<typeof messageHistoryResponseSchema>;
