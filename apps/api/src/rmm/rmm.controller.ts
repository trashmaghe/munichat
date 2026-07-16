import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Channel, User } from '@prisma/client';
import type { RmmAgentSummary, RmmRemoteControlUrls } from '@munichat/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChannelsService } from '../channels/channels.service';
import { AuditService } from '../audit/audit.service';
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
    private readonly auditService: AuditService,
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

  // Returns a live MeshCentral session URL — a bearer-equivalent credential.
  // Only handed to the requesting user's own response: never persisted,
  // never posted to a chat channel, never logged verbatim (only the fact
  // that access was granted is recorded, via AuditService).
  @Get(':agentId/remote-control')
  async getRemoteControl(
    @CurrentUser() user: User,
    @Param('agentId') agentId: string,
    @Req() req: Request,
  ): Promise<RmmRemoteControlUrls> {
    await this.assertOperatorAccess(user.id);
    const urls = await this.rmmService.getMeshControlUrls(agentId);
    await this.auditService.log('rmm.remote_control.requested', {
      userId: user.id,
      metadata: { agentId },
      ip: req.ip,
    });
    return urls;
  }

  private async assertAccess(userId: string): Promise<void> {
    const channel = await this.getAlertChannel();
    const isMember =
      channel !== null &&
      (await this.channelsService.isMember(userId, channel.id));
    if (!isMember) {
      throw new ForbiddenException(
        `You must be a member of the "${this.alertChannelName}" channel to view monitored devices`,
      );
    }
  }

  private async assertOperatorAccess(userId: string): Promise<void> {
    const channel = await this.getAlertChannel();
    const isAdmin =
      channel !== null &&
      (await this.channelsService.isChannelAdmin(userId, channel.id));
    if (!isAdmin) {
      throw new ForbiddenException(
        `You must be an admin of the "${this.alertChannelName}" channel to start a remote-control session`,
      );
    }
  }

  private getAlertChannel(): Promise<Channel | null> {
    return this.channelsService.findByName(this.alertChannelName);
  }
}
