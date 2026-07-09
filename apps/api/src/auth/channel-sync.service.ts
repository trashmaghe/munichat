import { Injectable } from '@nestjs/common';
import { ChannelType, MemberRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChannelSyncService {
  constructor(private readonly prisma: PrismaService) {}

  // Keeps ChannelMember rows in lockstep with the AD groups (memberOf) the user
  // currently belongs to: joins channels for newly-seen groups, and leaves
  // AD-linked channels for groups the user is no longer a member of. Channels
  // without an adGroupDn (not AD-linked) are never touched by this sync.
  async syncChannelsForUser(
    userId: string,
    memberOfDns: string[],
  ): Promise<void> {
    for (const dn of memberOfDns) {
      const channel = await this.prisma.channel.upsert({
        where: { adGroupDn: dn },
        create: {
          name: this.slugFromDn(dn),
          displayName: this.cnFromDn(dn),
          type: ChannelType.DEPARTMENT,
          adGroupDn: dn,
        },
        update: {},
      });

      await this.prisma.channelMember.upsert({
        where: { userId_channelId: { userId, channelId: channel.id } },
        create: { userId, channelId: channel.id, role: MemberRole.MEMBER },
        update: {},
      });
    }

    await this.prisma.channelMember.deleteMany({
      where: {
        userId,
        channel: { adGroupDn: { not: null, notIn: memberOfDns } },
      },
    });
  }

  private cnFromDn(dn: string): string {
    const match = /^cn=([^,]+)/i.exec(dn);
    return match ? match[1] : dn;
  }

  private slugFromDn(dn: string): string {
    return this.cnFromDn(dn)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
