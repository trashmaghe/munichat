import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { ChannelsService } from '../channels/channels.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

describe('MessagesController', () => {
  let controller: MessagesController;
  let channelsService: { isMember: jest.Mock };
  let messagesService: { getHistory: jest.Mock };

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

  beforeEach(async () => {
    channelsService = { isMember: jest.fn() };
    messagesService = { getHistory: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MessagesController],
      providers: [
        { provide: ChannelsService, useValue: channelsService },
        { provide: MessagesService, useValue: messagesService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(MessagesController);
  });

  it('throws ForbiddenException when the user is not a member', async () => {
    channelsService.isMember.mockResolvedValue(false);

    await expect(
      controller.getHistory(user, 'channel-1', { limit: 50 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(messagesService.getHistory).not.toHaveBeenCalled();
  });

  it('returns mapped history when the user is a member', async () => {
    channelsService.isMember.mockResolvedValue(true);
    messagesService.getHistory.mockResolvedValue({
      messages: [
        {
          id: 'm1',
          channelId: 'channel-1',
          authorId: 'user-1',
          content: 'hi',
          type: 'TEXT',
          replyToId: null,
          editedAt: null,
          deletedAt: null,
          createdAt: new Date('2026-07-10T00:00:00.000Z'),
          author: user,
        },
      ],
      nextCursor: null,
    });

    const result = await controller.getHistory(user, 'channel-1', {
      cursor: undefined,
      limit: 50,
    });

    expect(result).toEqual({
      messages: [
        {
          id: 'm1',
          channelId: 'channel-1',
          authorId: 'user-1',
          content: 'hi',
          type: 'TEXT',
          replyToId: null,
          editedAt: null,
          deletedAt: null,
          createdAt: '2026-07-10T00:00:00.000Z',
          author: {
            id: 'user-1',
            username: 'jsilva',
            displayName: 'Joao Silva',
            avatarUrl: null,
          },
        },
      ],
      nextCursor: null,
    });
    expect(messagesService.getHistory).toHaveBeenCalledWith('channel-1', {
      cursor: undefined,
      limit: 50,
    });
  });
});
