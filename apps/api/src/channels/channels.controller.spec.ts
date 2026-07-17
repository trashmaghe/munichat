import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

describe('ChannelsController', () => {
  let controller: ChannelsController;
  let channelsService: {
    listMembershipsForUser: jest.Mock;
    getUnreadCounts: jest.Mock;
    listMembers: jest.Mock;
    isMember: jest.Mock;
  };

  const user = {
    id: 'user-1',
    adObjectGuid: 'uuid-1',
    username: 'jsilva',
    displayName: 'Joao Silva',
    email: null,
    department: 'TI',
    avatarUrl: null,
    isActive: true,
    tokenVersion: 0,
    lastLoginAt: null,
    lastSeenAt: null,
    createdAt: new Date('2026-07-10T00:00:00.000Z'),
  };

  const channel = {
    id: 'channel-1',
    name: 'ti',
    displayName: 'TI',
    type: 'DEPARTMENT',
    adGroupDn: null,
    createdAt: new Date('2026-07-10T00:00:00.000Z'),
  };

  beforeEach(async () => {
    channelsService = {
      listMembershipsForUser: jest.fn(),
      getUnreadCounts: jest.fn(),
      listMembers: jest.fn(),
      isMember: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChannelsController],
      providers: [{ provide: ChannelsService, useValue: channelsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(ChannelsController);
  });

  describe('list', () => {
    it('maps channels for the current user to summaries with unread counts', async () => {
      channelsService.listMembershipsForUser.mockResolvedValue([
        {
          userId: 'user-1',
          channelId: 'channel-1',
          role: 'MEMBER',
          joinedAt: new Date('2026-07-10T00:00:00.000Z'),
          lastReadMessageId: null,
          lastReadAt: null,
          channel,
        },
      ]);
      channelsService.getUnreadCounts.mockResolvedValue({ 'channel-1': 3 });

      const result = await controller.list(user);

      expect(result).toEqual([
        {
          id: 'channel-1',
          name: 'ti',
          displayName: 'TI',
          type: 'DEPARTMENT',
          createdAt: '2026-07-10T00:00:00.000Z',
          unreadCount: 3,
        },
      ]);
    });
  });

  describe('listMembers', () => {
    it('throws ForbiddenException when the user is not a member', async () => {
      channelsService.isMember.mockResolvedValue(false);

      await expect(
        controller.listMembers(user, 'channel-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(channelsService.listMembers).not.toHaveBeenCalled();
    });

    it('returns mapped members when the user is a member', async () => {
      channelsService.isMember.mockResolvedValue(true);
      channelsService.listMembers.mockResolvedValue([
        {
          userId: 'user-1',
          channelId: 'channel-1',
          role: 'MEMBER',
          joinedAt: new Date('2026-07-10T00:00:00.000Z'),
          user,
        },
      ]);

      const result = await controller.listMembers(user, 'channel-1');

      expect(result).toEqual([
        {
          userId: 'user-1',
          channelId: 'channel-1',
          role: 'MEMBER',
          joinedAt: '2026-07-10T00:00:00.000Z',
          user: {
            id: 'user-1',
            username: 'jsilva',
            displayName: 'Joao Silva',
            avatarUrl: null,
          },
        },
      ]);
    });
  });
});
