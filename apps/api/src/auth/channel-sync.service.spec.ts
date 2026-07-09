import { Test, TestingModule } from '@nestjs/testing';
import { ChannelType, MemberRole } from '@prisma/client';
import { ChannelSyncService } from './channel-sync.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ChannelSyncService', () => {
  let service: ChannelSyncService;
  let prisma: {
    channel: { upsert: jest.Mock };
    channelMember: { upsert: jest.Mock; deleteMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      channel: { upsert: jest.fn() },
      channelMember: { upsert: jest.fn(), deleteMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelSyncService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(ChannelSyncService);
  });

  it('upserts a channel and membership for each memberOf DN', async () => {
    prisma.channel.upsert
      .mockResolvedValueOnce({ id: 'channel-ti' })
      .mockResolvedValueOnce({ id: 'channel-financas' });

    await service.syncChannelsForUser('user-1', [
      'cn=ti,ou=groups,dc=munichat,dc=local',
      'cn=financas,ou=groups,dc=munichat,dc=local',
    ]);

    expect(prisma.channel.upsert).toHaveBeenCalledWith({
      where: { adGroupDn: 'cn=ti,ou=groups,dc=munichat,dc=local' },
      create: {
        name: 'ti',
        displayName: 'ti',
        type: ChannelType.DEPARTMENT,
        adGroupDn: 'cn=ti,ou=groups,dc=munichat,dc=local',
      },
      update: {},
    });

    expect(prisma.channelMember.upsert).toHaveBeenCalledWith({
      where: {
        userId_channelId: { userId: 'user-1', channelId: 'channel-ti' },
      },
      create: {
        userId: 'user-1',
        channelId: 'channel-ti',
        role: MemberRole.MEMBER,
      },
      update: {},
    });
    expect(prisma.channelMember.upsert).toHaveBeenCalledTimes(2);
  });

  it('prunes AD-linked memberships for groups no longer in memberOf', async () => {
    prisma.channel.upsert.mockResolvedValue({ id: 'channel-ti' });

    await service.syncChannelsForUser('user-1', [
      'cn=ti,ou=groups,dc=munichat,dc=local',
    ]);

    expect(prisma.channelMember.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        channel: {
          adGroupDn: {
            not: null,
            notIn: ['cn=ti,ou=groups,dc=munichat,dc=local'],
          },
        },
      },
    });
  });

  it('is a no-op on channel/membership upserts when memberOf is empty, but still prunes', async () => {
    await service.syncChannelsForUser('user-1', []);

    expect(prisma.channel.upsert).not.toHaveBeenCalled();
    expect(prisma.channelMember.upsert).not.toHaveBeenCalled();
    expect(prisma.channelMember.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        channel: { adGroupDn: { not: null, notIn: [] } },
      },
    });
  });
});
