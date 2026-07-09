import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { LoginResponse } from '@munichat/shared';
import { AuthService, TokenPair } from './auth.service';
import { LoginRequestDto } from './dto/login-request.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { toCurrentUserResponse } from '../users/user-response.mapper';

const ACCESS_TOKEN_COOKIE = 'access_token';
const REFRESH_TOKEN_COOKIE = 'refresh_token';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const { user, tokens } = await this.authService.login(
      dto.username,
      dto.password,
    );
    this.setAuthCookies(res, tokens);
    return { user: toCurrentUserResponse(user) };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const refreshToken = this.readCookie(req, REFRESH_TOKEN_COOKIE);
    const { user, tokens } = await this.authService.refresh(refreshToken ?? '');
    this.setAuthCookies(res, tokens);
    return { user: toCurrentUserResponse(user) };
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    await this.authService.logout(this.readCookie(req, REFRESH_TOKEN_COOKIE));
    res.clearCookie(ACCESS_TOKEN_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/' });
    return { ok: true };
  }

  private readCookie(req: Request, name: string): string | undefined {
    const cookies = req.cookies as
      Record<string, string | undefined> | undefined;
    return cookies?.[name];
  }

  private setAuthCookies(res: Response, tokens: TokenPair): void {
    const secure = process.env.NODE_ENV === 'production';
    res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      expires: tokens.accessTokenExpiresAt,
    });
    res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      expires: tokens.refreshTokenExpiresAt,
    });
  }
}
