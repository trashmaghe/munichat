import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { parse as parseCookie } from 'cookie';
import { Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import {
  AccessTokenPayload,
  validateAccessTokenPayload,
} from '../auth/access-token.validator';

@Injectable()
export class ChatAuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async authenticate(socket: Socket): Promise<User> {
    const cookieHeader = socket.handshake.headers.cookie;
    const token = cookieHeader
      ? parseCookie(cookieHeader).access_token
      : undefined;
    if (!token) {
      throw new UnauthorizedException('Missing access token cookie');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }

    return validateAccessTokenPayload(this.prisma, payload);
  }
}
