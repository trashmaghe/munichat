import { Test, TestingModule } from '@nestjs/testing';
import { ChannelType, MemberRole, Prisma } from '@prisma/client';
import { ChannelSyncService } from './channel-sync.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ChannelSyncService', () => {
  let service: ChannelSyncService;
  let prisma: {
    channel: { upsert: jest.Mock; findUniqueOrThrow: jest.Mock };
    channelMember: { createMany: jest.Mock; deleteMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      channel: { upsert: jest.fn(), findUniqueOrThrow: jest.fn() },
      channelMember: { createMany: jest.fn(), deleteMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelSyncService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(ChannelSyncService);
  });

  it('upserts a channel and inserts memberships for each memberOf DN', async () => {
    prisma.channel.upsert
      .mockResolvedValueOnce({ id: 'channel-ti' })
      .mockResolvedValueOnce({ id: 'channel-financas' });

    await service.syncChannelsForUser('user-1', [
      'cn=ti,ou=groups,dc=elyzian,dc=local',
      'cn=financas,ou=groups,dc=elyzian,dc=local',
    ]);

    expect(prisma.channel.upsert).toHaveBeenCalledWith({
      where: { adGroupDn: 'cn=ti,ou=groups,dc=elyzian,dc=local' },
      create: {
        name: 'ti',
        displayName: 'ti',
        type: ChannelType.DEPARTMENT,
        adGroupDn: 'cn=ti,ou=groups,dc=elyzian,dc=local',
      },
      update: {},
      select: { id: true },
    });

    // Memberships are inserted in one conflict-safe batch (ON CONFLICT DO NOTHING),
    // so a concurrent login of the same user can never trip a duplicate-key error.
    expect(prisma.channelMember.createMany).toHaveBeenCalledWith({
      data: [
        { userId: 'user-1', channelId: 'channel-ti', role: MemberRole.MEMBER },
        {
          userId: 'user-1',
          channelId: 'channel-financas',
          role: MemberRole.MEMBER,
        },
      ],
      skipDuplicates: true,
    });
    expect(prisma.channelMember.createMany).toHaveBeenCalledTimes(1);
  });

  it('re-reads the channel when a concurrent login already created it (P2002)', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: 'test' },
    );
    prisma.channel.upsert.mockRejectedValueOnce(conflict);
    prisma.channel.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'channel-ti',
    });

    await service.syncChannelsForUser('user-1', [
      'cn=ti,ou=groups,dc=elyzian,dc=local',
    ]);

    expect(prisma.channel.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { adGroupDn: 'cn=ti,ou=groups,dc=elyzian,dc=local' },
      select: { id: true },
    });
    expect(prisma.channelMember.createMany).toHaveBeenCalledWith({
      data: [
        { userId: 'user-1', channelId: 'channel-ti', role: MemberRole.MEMBER },
      ],
      skipDuplicates: true,
    });
  });

  it('prunes AD-linked memberships for groups no longer in memberOf', async () => {
    prisma.channel.upsert.mockResolvedValue({ id: 'channel-ti' });

    await service.syncChannelsForUser('user-1', [
      'cn=ti,ou=groups,dc=elyzian,dc=local',
    ]);

    expect(prisma.channelMember.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        channel: {
          adGroupDn: {
            not: null,
            notIn: ['cn=ti,ou=groups,dc=elyzian,dc=local'],
          },
        },
      },
    });
  });

  it('is a no-op on channel/membership upserts when memberOf is empty, but still prunes', async () => {
    await service.syncChannelsForUser('user-1', []);

    expect(prisma.channel.upsert).not.toHaveBeenCalled();
    expect(prisma.channelMember.createMany).not.toHaveBeenCalled();
    expect(prisma.channelMember.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        channel: { adGroupDn: { not: null, notIn: [] } },
      },
    });
  });
});
