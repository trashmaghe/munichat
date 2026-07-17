import { Injectable } from '@nestjs/common';
import { Channel, ChannelMember, MemberRole, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChannelsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string): Promise<Channel[]> {
    const memberships = await this.prisma.channelMember.findMany({
      where: { userId },
      include: { channel: true },
    });
    return memberships.map((membership) => membership.channel);
  }

  async listMembershipsForUser(
    userId: string,
  ): Promise<(ChannelMember & { channel: Channel })[]> {
    return this.prisma.channelMember.findMany({
      where: { userId },
      include: { channel: true },
    });
  }

  async listMembers(
    channelId: string,
  ): Promise<(ChannelMember & { user: User })[]> {
    return this.prisma.channelMember.findMany({
      where: { channelId },
      include: { user: true },
    });
  }

  async isMember(userId: string, channelId: string): Promise<boolean> {
    const membership = await this.prisma.channelMember.findUnique({
      where: { userId_channelId: { userId, channelId } },
    });
    return membership !== null;
  }

  async findByName(name: string): Promise<Channel | null> {
    return this.prisma.channel.findUnique({ where: { name } });
  }

  async isChannelAdmin(userId: string, channelId: string): Promise<boolean> {
    const membership = await this.prisma.channelMember.findUnique({
      where: { userId_channelId: { userId, channelId } },
    });
    return membership?.role === MemberRole.ADMIN;
  }

  // One count query per channel: a user's channel count is bounded by their
  // AD department memberships (small N), so this doesn't need a single
  // grouped raw-SQL query.
  async getUnreadCounts(
    memberships: Pick<ChannelMember, 'channelId' | 'lastReadAt'>[],
  ): Promise<Record<string, number>> {
    const entries = await Promise.all(
      memberships.map(async ({ channelId, lastReadAt }) => {
        const count = await this.prisma.message.count({
          where: {
            channelId,
            deletedAt: null,
            ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
          },
        });
        return [channelId, count] as const;
      }),
    );
    return Object.fromEntries(entries);
  }

  async markRead(
    userId: string,
    channelId: string,
    messageId: string,
    readAt: Date,
  ): Promise<void> {
    await this.prisma.channelMember.update({
      where: { userId_channelId: { userId, channelId } },
      data: { lastReadMessageId: messageId, lastReadAt: readAt },
    });
  }
}
