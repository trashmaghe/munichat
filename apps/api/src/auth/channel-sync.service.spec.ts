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

  const ti = { dn: 'OU=Tecnologia da Informacao,OU=SEMAD,DC=elyzian,DC=local', name: 'Tecnologia da Informacao' };

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

  it('upserts the department channel and inserts a membership for it', async () => {
    prisma.channel.upsert.mockResolvedValueOnce({ id: 'channel-ti' });

    await service.syncChannelsForUser('user-1', ti);

    expect(prisma.channel.upsert).toHaveBeenCalledWith({
      where: { adGroupDn: ti.dn },
      create: {
        name: 'tecnologia-da-informacao',
        displayName: 'Tecnologia da Informacao',
        type: ChannelType.DEPARTMENT,
        adGroupDn: ti.dn,
      },
      update: {},
      select: { id: true },
    });

    expect(prisma.channelMember.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'user-1', channelId: 'channel-ti', role: MemberRole.MEMBER }],
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

    await service.syncChannelsForUser('user-1', ti);

    expect(prisma.channel.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { adGroupDn: ti.dn },
      select: { id: true },
    });
    expect(prisma.channelMember.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'user-1', channelId: 'channel-ti', role: MemberRole.MEMBER }],
      skipDuplicates: true,
    });
  });

  it('prunes AD-linked memberships for departments other than the current one', async () => {
    prisma.channel.upsert.mockResolvedValue({ id: 'channel-ti' });

    await service.syncChannelsForUser('user-1', ti);

    expect(prisma.channelMember.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        channel: { adGroupDn: { not: null, notIn: [ti.dn] } },
      },
    });
  });

  it('is a no-op on channel/membership upserts when the department is null, but still prunes', async () => {
    await service.syncChannelsForUser('user-1', null);

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
