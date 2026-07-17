import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import type { ChannelMemberSummary, ChannelSummary } from '@munichat/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChannelsService } from './channels.service';
import {
  toChannelMemberSummary,
  toChannelSummary,
} from './channel-response.mapper';

@Controller('channels')
@UseGuards(JwtAuthGuard)
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Get()
  async list(@CurrentUser() user: User): Promise<ChannelSummary[]> {
    const memberships = await this.channelsService.listMembershipsForUser(
      user.id,
    );
    const unreadCounts =
      await this.channelsService.getUnreadCounts(memberships);
    return memberships.map((membership) =>
      toChannelSummary(membership.channel, unreadCounts[membership.channelId]),
    );
  }

  @Get(':id/members')
  async listMembers(
    @CurrentUser() user: User,
    @Param('id') channelId: string,
  ): Promise<ChannelMemberSummary[]> {
    const isMember = await this.channelsService.isMember(user.id, channelId);
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this channel');
    }
    const members = await this.channelsService.listMembers(channelId);
    return members.map(toChannelMemberSummary);
  }
}
