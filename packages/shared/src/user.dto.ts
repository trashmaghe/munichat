import { z } from 'zod';

export const userSummarySchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});

export type UserSummary = z.infer<typeof userSummarySchema>;
