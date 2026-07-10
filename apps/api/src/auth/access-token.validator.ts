import { UnauthorizedException } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AccessTokenPayload {
  sub: string;
  tokenVersion: number;
}

export async function validateAccessTokenPayload(
  prisma: PrismaService,
  payload: AccessTokenPayload,
): Promise<User> {
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
  });
  if (!user || !user.isActive || user.tokenVersion !== payload.tokenVersion) {
    throw new UnauthorizedException('Session is no longer valid');
  }
  return user;
}
