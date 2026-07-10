import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Socket } from 'socket.io';
import { ChatAuthService } from './chat-auth.service';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

function socketWithCookie(cookie: string | undefined): Socket {
  return {
    handshake: { headers: { cookie } },
  } as unknown as Socket;
}

describe('ChatAuthService', () => {
  let service: ChatAuthService;
  let jwtService: { verifyAsync: jest.Mock };
  let prisma: { user: { findUnique: jest.Mock } };

  const user = { id: 'user-1', isActive: true, tokenVersion: 0 };

  beforeEach(async () => {
    jwtService = { verifyAsync: jest.fn() };
    prisma = { user: { findUnique: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatAuthService,
        { provide: JwtService, useValue: jwtService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(ChatAuthService);
  });

  it('authenticates a socket with a valid access_token cookie', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      tokenVersion: 0,
    });
    prisma.user.findUnique.mockResolvedValue(user);

    const result = await service.authenticate(
      socketWithCookie('access_token=valid-jwt; other=1'),
    );

    expect(result).toBe(user);
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid-jwt');
  });

  it('rejects when there is no cookie header at all', async () => {
    await expect(
      service.authenticate(socketWithCookie(undefined)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when the access_token cookie is missing', async () => {
    await expect(
      service.authenticate(socketWithCookie('other=1')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when the token fails verification', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('bad signature'));

    await expect(
      service.authenticate(socketWithCookie('access_token=bad-jwt')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when the resolved user is inactive', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      tokenVersion: 0,
    });
    prisma.user.findUnique.mockResolvedValue({ ...user, isActive: false });

    await expect(
      service.authenticate(socketWithCookie('access_token=valid-jwt')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
