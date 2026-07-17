import { Test, TestingModule } from '@nestjs/testing';
import { ChannelsService } from './channels.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ChannelsService', () => {
  let service: ChannelsService;
  let prisma: {
    channelMember: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    channel: {
      findUnique: jest.Mock;
    };
    message: {
      count: jest.Mock;
    };
  };

  const channel = {
    id: 'channel-1',
    name: 'ti',
    displayName: 'TI',
    type: 'DEPARTMENT',
    adGroupDn: null,
    createdAt: new Date('2026-07-10T00:00:00.000Z'),
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

  beforeEach(async () => {
    prisma = {
      channelMember: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      channel: { findUnique: jest.fn() },
      message: { count: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(ChannelsService);
  });

  describe('listForUser', () => {
    it('returns the channels the user is a member of', async () => {
      prisma.channelMember.findMany.mockResolvedValue([{ channel }]);

      const result = await service.listForUser('user-1');

      expect(result).toEqual([channel]);
      expect(prisma.channelMember.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        include: { channel: true },
      });
    });
  });

  describe('listMembershipsForUser', () => {
    it('returns membership rows with the channel embedded', async () => {
      const membership = {
        userId: 'user-1',
        channelId: 'channel-1',
        role: 'MEMBER',
        joinedAt: new Date('2026-07-10T00:00:00.000Z'),
        lastReadMessageId: null,
        lastReadAt: null,
        channel,
      };
      prisma.channelMember.findMany.mockResolvedValue([membership]);

      const result = await service.listMembershipsForUser('user-1');

      expect(result).toEqual([membership]);
      expect(prisma.channelMember.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        include: { channel: true },
      });
    });
  });

  describe('getUnreadCounts', () => {
    it('counts all non-deleted messages when lastReadAt is null (never read)', async () => {
      prisma.message.count.mockResolvedValue(5);

      const result = await service.getUnreadCounts([
        { channelId: 'channel-1', lastReadAt: null },
      ]);

      expect(result).toEqual({ 'channel-1': 5 });
      expect(prisma.message.count).toHaveBeenCalledWith({
        where: { channelId: 'channel-1', deletedAt: null },
      });
    });

    it('counts messages newer than lastReadAt when it is set', async () => {
      const lastReadAt = new Date('2026-07-10T00:00:00.000Z');
      prisma.message.count.mockResolvedValue(2);

      const result = await service.getUnreadCounts([
        { channelId: 'channel-1', lastReadAt },
      ]);

      expect(result).toEqual({ 'channel-1': 2 });
      expect(prisma.message.count).toHaveBeenCalledWith({
        where: {
          channelId: 'channel-1',
          deletedAt: null,
          createdAt: { gt: lastReadAt },
        },
      });
    });

    it('runs one count per membership and keys the result by channelId', async () => {
      prisma.message.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

      const result = await service.getUnreadCounts([
        { channelId: 'channel-1', lastReadAt: null },
        { channelId: 'channel-2', lastReadAt: null },
      ]);

      expect(result).toEqual({ 'channel-1': 1, 'channel-2': 0 });
    });
  });

  describe('markRead', () => {
    it('sets lastReadMessageId and lastReadAt for the membership', async () => {
      const readAt = new Date('2026-07-10T00:00:00.000Z');

      await service.markRead('user-1', 'channel-1', 'm1', readAt);

      expect(prisma.channelMember.update).toHaveBeenCalledWith({
        where: {
          userId_channelId: { userId: 'user-1', channelId: 'channel-1' },
        },
        data: { lastReadMessageId: 'm1', lastReadAt: readAt },
      });
    });
  });

  describe('listMembers', () => {
    it('returns members with their embedded user', async () => {
      const member = {
        userId: 'user-1',
        channelId: 'channel-1',
        role: 'MEMBER',
        joinedAt: new Date(),
        user,
      };
      prisma.channelMember.findMany.mockResolvedValue([member]);

      const result = await service.listMembers('channel-1');

      expect(result).toEqual([member]);
      expect(prisma.channelMember.findMany).toHaveBeenCalledWith({
        where: { channelId: 'channel-1' },
        include: { user: true },
      });
    });
  });

  describe('isMember', () => {
    it('returns true when a membership row exists', async () => {
      prisma.channelMember.findUnique.mockResolvedValue({
        userId: 'user-1',
        channelId: 'channel-1',
      });

      const result = await service.isMember('user-1', 'channel-1');

      expect(result).toBe(true);
      expect(prisma.channelMember.findUnique).toHaveBeenCalledWith({
        where: {
          userId_channelId: { userId: 'user-1', channelId: 'channel-1' },
        },
      });
    });

    it('returns false when no membership row exists', async () => {
      prisma.channelMember.findUnique.mockResolvedValue(null);

      const result = await service.isMember('user-1', 'channel-1');

      expect(result).toBe(false);
    });
  });

  describe('findByName', () => {
    it('returns the channel matching the given name', async () => {
      prisma.channel.findUnique.mockResolvedValue(channel);

      const result = await service.findByName('ti');

      expect(result).toEqual(channel);
      expect(prisma.channel.findUnique).toHaveBeenCalledWith({
        where: { name: 'ti' },
      });
    });

    it('returns null when no channel matches', async () => {
      prisma.channel.findUnique.mockResolvedValue(null);

      const result = await service.findByName('missing');

      expect(result).toBeNull();
    });
  });

  describe('isChannelAdmin', () => {
    it('returns true when the membership role is ADMIN', async () => {
      prisma.channelMember.findUnique.mockResolvedValue({
        userId: 'user-1',
        channelId: 'channel-1',
        role: 'ADMIN',
      });

      const result = await service.isChannelAdmin('user-1', 'channel-1');

      expect(result).toBe(true);
      expect(prisma.channelMember.findUnique).toHaveBeenCalledWith({
        where: {
          userId_channelId: { userId: 'user-1', channelId: 'channel-1' },
        },
      });
    });

    it('returns false when the membership role is MEMBER', async () => {
      prisma.channelMember.findUnique.mockResolvedValue({
        userId: 'user-1',
        channelId: 'channel-1',
        role: 'MEMBER',
      });

      const result = await service.isChannelAdmin('user-1', 'channel-1');

      expect(result).toBe(false);
    });

    it('returns false when no membership row exists', async () => {
      prisma.channelMember.findUnique.mockResolvedValue(null);

      const result = await service.isChannelAdmin('user-1', 'channel-1');

      expect(result).toBe(false);
    });
  });
});
