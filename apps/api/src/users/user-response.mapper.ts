import { User } from '@prisma/client';
import { CurrentUserResponse } from '@elyzian/shared';

export function toCurrentUserResponse(user: User): CurrentUserResponse {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    department: user.department,
    avatarUrl: user.avatarUrl,
    isActive: user.isActive,
  };
}
