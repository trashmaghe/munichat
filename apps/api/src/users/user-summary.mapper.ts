import { User } from '@prisma/client';
import { UserSummary } from '@munichat/shared';

export function toUserSummary(user: User): UserSummary {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  };
}
