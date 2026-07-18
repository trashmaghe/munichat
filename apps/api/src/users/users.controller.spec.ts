import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

describe('UsersController', () => {
  let controller: UsersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(UsersController);
  });

  it('maps the current user to the safe CurrentUserResponse shape', () => {
    const user = {
      id: 'user-1',
      adObjectGuid: 'uuid-1',
      username: 'jsilva',
      displayName: 'Joao Silva',
      email: 'jsilva@elyzian.local',
      department: 'TI',
      avatarUrl: null,
      isActive: true,
      tokenVersion: 0,
      lastLoginAt: new Date(),
      lastSeenAt: null,
      createdAt: new Date(),
    };

    const result = controller.me(user);

    expect(result).toEqual({
      id: 'user-1',
      username: 'jsilva',
      displayName: 'Joao Silva',
      email: 'jsilva@elyzian.local',
      department: 'TI',
      avatarUrl: null,
      isActive: true,
    });
  });
});
