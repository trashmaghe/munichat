import {
  currentUserResponseSchema,
  loginResponseSchema,
  type CurrentUserResponse,
  type LoginRequest,
  type LoginResponse,
} from '@elyzian/shared';
import { apiFetch } from '@/lib/api-client';

export async function login(credentials: LoginRequest): Promise<LoginResponse> {
  const res = await apiFetch<unknown>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
  return loginResponseSchema.parse(res);
}

export async function logout(): Promise<void> {
  await apiFetch<unknown>('/auth/logout', { method: 'POST' });
}

export async function fetchCurrentUser(): Promise<CurrentUserResponse> {
  const res = await apiFetch<unknown>('/users/me');
  return currentUserResponseSchema.parse(res);
}
