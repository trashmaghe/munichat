import { z } from 'zod';
import { LinkPreviewStatus } from './enums';

export const linkPreviewSchema = z.object({
  url: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  status: z.nativeEnum(LinkPreviewStatus),
});

export type LinkPreview = z.infer<typeof linkPreviewSchema>;
