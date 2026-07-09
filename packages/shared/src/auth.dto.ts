import { z } from 'zod';

export const loginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const currentUserResponseSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  email: z.string().nullable(),
  department: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  isActive: z.boolean(),
});

export type CurrentUserResponse = z.infer<typeof currentUserResponseSchema>;

export const loginResponseSchema = z.object({
  user: currentUserResponseSchema,
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;
