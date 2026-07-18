import { timingSafeEqual } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import {
  RmmAlertSeverity,
  rmmAlertWebhookSchema,
  SocketEvent,
} from '@elyzian/shared';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { ChannelsService } from '../channels/channels.service';
import { MessagesService } from '../messages/messages.service';
import { toMessageDto } from '../messages/message-response.mapper';
import { ChatGateway } from '../chat/chat.gateway';
import { channelRoom } from '../chat/channel-room';

const BEARER_PREFIX = 'Bearer ';
const SYSTEM_BOT_USERNAME = 'rmm-bot';

// Tactical RMM alert templates can't build a bearer token dynamically, so
// unlike GLPI's HMAC signature this is a static shared secret compared with
// timingSafeEqual — same defensive intent (no early-exit string compare),
// simpler mechanism because there's nothing to sign.
const SEVERITY_RANK: Record<RmmAlertSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
};

@Controller('webhooks/rmm')
export class RmmWebhookController {
  private readonly webhookSecret: string | undefined;
  private readonly glpiUrl: string;
  private readonly alertChannelName: string;
  private readonly autoTicketThreshold: RmmAlertSeverity | 'off';

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly channelsService: ChannelsService,
    private readonly messagesService: MessagesService,
    private readonly chatGateway: ChatGateway,
    configService: ConfigService,
  ) {
    this.webhookSecret =
      configService.get<string>('RMM_WEBHOOK_SECRET') || undefined;
    this.glpiUrl = configService.get<string>('GLPI_URL')!;
    this.alertChannelName =
      configService.get<string>('RMM_ALERT_CHANNEL_NAME') || 'ti';
    this.autoTicketThreshold =
      (configService.get<string>('RMM_AUTO_TICKET_SEVERITY') as
        RmmAlertSeverity | 'off') || 'error';
  }

  @Post('alerts')
  @HttpCode(200)
  async handleAlertWebhook(
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<void> {
    this.verifyBearerToken(req);

    const parsed = rmmAlertWebhookSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Invalid RMM alert payload');
    }
    const alert = parsed.data;

    const channel = await this.channelsService.findByName(
      this.alertChannelName,
    );
    if (!channel) {
      throw new BadGatewayException(
        `RMM alert channel "${this.alertChannelName}" is not configured`,
      );
    }

    const existingRef = await this.prisma.rmmAlertRef.findUnique({
      where: { rmmAlertId: alert.alertId },
    });

    if (alert.resolved) {
      await this.handleResolved(existingRef);
      return;
    }

    if (existingRef) {
      // Duplicate delivery of an already-tracked, still-unresolved alert.
      return;
    }

    await this.handleNewAlert(channel.id, alert);
  }

  private async handleResolved(
    existingRef: { id: string; messageId: string } | null,
  ): Promise<void> {
    if (!existingRef) {
      return;
    }

    await this.prisma.rmmAlertRef.update({
      where: { id: existingRef.id },
      data: { resolved: true },
    });

    const message = await this.messagesService.getById(existingRef.messageId);
    if (!message) {
      return;
    }
    const dto = toMessageDto(message, this.glpiUrl);
    this.chatGateway.server
      .to(channelRoom(dto.channelId))
      .emit(SocketEvent.MESSAGE_UPDATED, dto);
  }

  private async handleNewAlert(
    channelId: string,
    alert: {
      alertId: string;
      hostname: string;
      client: string;
      site: string;
      severity: RmmAlertSeverity;
      message: string;
    },
  ): Promise<void> {
    const bot = await this.usersService.findByUsername(SYSTEM_BOT_USERNAME);
    if (!bot) {
      throw new BadGatewayException('RMM system user is not seeded');
    }

    const summary = `[${alert.severity.toUpperCase()}] ${alert.hostname} (${alert.client} / ${alert.site}): ${alert.message}`;

    const result = this.shouldAutoTicket(alert.severity)
      ? await this.messagesService.create({
          channelId,
          authorId: bot.id,
          content: `/ticket ${summary}`,
        })
      : {
          message: await this.messagesService.createSystemMessage(
            channelId,
            bot.id,
            summary,
          ),
        };

    if ('error' in result) {
      // GLPI was unreachable for the auto-ticket path — still surface the
      // alert itself rather than silently dropping it.
      const fallback = await this.messagesService.createSystemMessage(
        channelId,
        bot.id,
        `${summary} (failed to open a GLPI ticket: ${result.error})`,
      );
      await this.trackAndBroadcast(channelId, alert, fallback.id);
      return;
    }

    await this.trackAndBroadcast(channelId, alert, result.message.id);
  }

  private async trackAndBroadcast(
    channelId: string,
    alert: { alertId: string; severity: RmmAlertSeverity },
    messageId: string,
  ): Promise<void> {
    await this.prisma.rmmAlertRef.create({
      data: {
        messageId,
        rmmAlertId: alert.alertId,
        severity: alert.severity,
      },
    });

    const message = await this.messagesService.getById(messageId);
    if (!message) {
      return;
    }
    const dto = toMessageDto(message, this.glpiUrl);
    this.chatGateway.server
      .to(channelRoom(channelId))
      .emit(SocketEvent.MESSAGE_NEW, dto);
  }

  private shouldAutoTicket(severity: RmmAlertSeverity): boolean {
    if (this.autoTicketThreshold === 'off') {
      return false;
    }
    return SEVERITY_RANK[severity] >= SEVERITY_RANK[this.autoTicketThreshold];
  }

  private verifyBearerToken(req: Request): void {
    if (!this.webhookSecret) {
      return;
    }

    const header = req.headers['authorization'];
    if (!header?.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const provided = Buffer.from(header.slice(BEARER_PREFIX.length));
    const expected = Buffer.from(this.webhookSecret);

    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      throw new UnauthorizedException('Invalid bearer token');
    }
  }
}
