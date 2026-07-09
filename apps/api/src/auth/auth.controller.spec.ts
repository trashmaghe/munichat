import { Test, TestingModule } from '@nestjs/testing';
import { Response } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: { login: jest.Mock; refresh: jest.Mock; logout: jest.Mock };
  let res: { cookie: jest.Mock; clearCookie: jest.Mock };

  const user = {
    id: 'user-1',
    username: 'jsilva',
    displayName: 'Joao Silva',
    email: null,
    department: null,
    avatarUrl: null,
    isActive: true,
  };

  const tokens = {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    accessTokenExpiresAt: new Date(Date.now() + 900_000),
    refreshTokenExpiresAt: new Date(Date.now() + 604_800_000),
  };

  beforeEach(async () => {
    authService = { login: jest.fn(), refresh: jest.fn(), logout: jest.fn() };
    res = { cookie: jest.fn(), clearCookie: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get(AuthController);
  });

  it('logs in, sets httpOnly cookies for both tokens, and returns the mapped user', async () => {
    authService.login.mockResolvedValue({ user, tokens });

    const result = await controller.login(
      { username: 'jsilva', password: 'hunter2' },
      res as unknown as Response,
    );

    expect(authService.login).toHaveBeenCalledWith('jsilva', 'hunter2');
    expect(res.cookie).toHaveBeenCalledWith(
      'access_token',
      'access-token',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    );
    expect(res.cookie).toHaveBeenCalledWith(
      'refresh_token',
      'refresh-token',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    );
    expect(result).toEqual({ user });
  });

  it('refreshes using the refresh_token cookie and re-sets both cookies', async () => {
    authService.refresh.mockResolvedValue({ user, tokens });
    const req = { cookies: { refresh_token: 'old-refresh-token' } };

    const result = await controller.refresh(
      req as never,
      res as unknown as Response,
    );

    expect(authService.refresh).toHaveBeenCalledWith('old-refresh-token');
    expect(res.cookie).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ user });
  });

  it('logs out, clears both cookies, and returns ok', async () => {
    authService.logout.mockResolvedValue(undefined);
    const req = { cookies: { refresh_token: 'old-refresh-token' } };

    const result = await controller.logout(
      req as never,
      res as unknown as Response,
    );

    expect(authService.logout).toHaveBeenCalledWith('old-refresh-token');
    expect(res.clearCookie).toHaveBeenCalledWith(
      'access_token',
      expect.any(Object),
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      'refresh_token',
      expect.any(Object),
    );
    expect(result).toEqual({ ok: true });
  });
});
