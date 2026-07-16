import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '@prisma/client';
import type { RmmAgentSummary } from '@munichat/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChannelsService } from '../channels/channels.service';
import { RmmService } from './rmm.service';

// Monitored-device data is only exposed to members of the channel Tactical
// RMM alerts are posted into (see RmmWebhookController) — same audience,
// same access rule, so no separate RMM-specific permission model is needed.
@Controller('rmm/agents')
@UseGuards(JwtAuthGuard)
export class RmmController {
  private readonly alertChannelName: string;

  constructor(
    private readonly rmmService: RmmService,
    private readonly channelsService: ChannelsService,
    configService: ConfigService,
  ) {
    this.alertChannelName =
      configService.get<string>('RMM_ALERT_CHANNEL_NAME') || 'ti';
  }

  @Get()
  async list(@CurrentUser() user: User): Promise<RmmAgentSummary[]> {
    await this.assertAccess(user.id);
    return this.rmmService.listAgents();
  }

  @Get(':agentId')
  async getOne(
    @CurrentUser() user: User,
    @Param('agentId') agentId: string,
  ): Promise<RmmAgentSummary> {
    await this.assertAccess(user.id);
    const agent = await this.rmmService.getAgent(agentId);
    if (!agent) {
      throw new NotFoundException();
    }
    return agent;
  }

  private async assertAccess(userId: string): Promise<void> {
    const channel = await this.channelsService.findByName(
      this.alertChannelName,
    );
    const isMember =
      channel !== null &&
      (await this.channelsService.isMember(userId, channel.id));
    if (!isMember) {
      throw new ForbiddenException(
        `You must be a member of the "${this.alertChannelName}" channel to view monitored devices`,
      );
    }
  }
}
