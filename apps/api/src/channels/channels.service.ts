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
}
