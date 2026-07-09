import { Controller, Get, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { CurrentUserResponse } from '@munichat/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { toCurrentUserResponse } from './user-response.mapper';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  @Get('me')
  me(@CurrentUser() user: User): CurrentUserResponse {
    return toCurrentUserResponse(user);
  }
}
