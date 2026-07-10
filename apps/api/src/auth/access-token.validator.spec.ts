import { UnauthorizedException } from '@nestjs/common';
import { validateAccessTokenPayload } from './access-token.validator';
import { PrismaService } from '../prisma/prisma.service';

describe('validateAccessTokenPayload', () => {
  let prisma: { user: { findUnique: jest.Mock } };
  const user = {
    id: 'user-1',
    isActive: true,
    tokenVersion: 0,
  };

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn() } };
  });

  it('returns the user when active and token version matches', async () => {
    prisma.user.findUnique.mockResolvedValue(user);

    const result = await validateAccessTokenPayload(
      prisma as unknown as PrismaService,
      {
        sub: 'user-1',
        tokenVersion: 0,
      },
    );

    expect(result).toBe(user);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
    });
  });

  it('throws when the user does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      validateAccessTokenPayload(prisma as unknown as PrismaService, {
        sub: 'missing',
        tokenVersion: 0,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws when the user is inactive', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...user, isActive: false });

    await expect(
      validateAccessTokenPayload(prisma as unknown as PrismaService, {
        sub: 'user-1',
        tokenVersion: 0,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws when the token version does not match', async () => {
    prisma.user.findUnique.mockResolvedValue(user);

    await expect(
      validateAccessTokenPayload(prisma as unknown as PrismaService, {
        sub: 'user-1',
        tokenVersion: 5,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
