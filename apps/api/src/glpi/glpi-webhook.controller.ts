import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  NotFoundException,
  Post,
  Req,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { SocketEvent } from '@elyzian/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MessagesService } from '../messages/messages.service';
import { toMessageDto } from '../messages/message-response.mapper';
import { ChatGateway } from '../chat/chat.gateway';
import { channelRoom } from '../chat/channel-room';
import { GlpiService, GlpiUnavailableError } from './glpi.service';

const SIGNATURE_PREFIX = 'sha256=';

@Controller('webhooks/glpi')
export class GlpiWebhookController {
  private readonly webhookSecret: string | undefined;
  private readonly ticketIdField: string;
  private readonly glpiUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly glpiService: GlpiService,
    private readonly messagesService: MessagesService,
    private readonly chatGateway: ChatGateway,
    configService: ConfigService,
  ) {
    this.webhookSecret =
      configService.get<string>('GLPI_WEBHOOK_SECRET') || undefined;
    this.ticketIdField =
      configService.get<string>('GLPI_WEBHOOK_TICKET_ID_FIELD') || 'id';
    this.glpiUrl = configService.get<string>('GLPI_URL')!;
  }

  @Post('tickets')
  @HttpCode(200)
  async handleTicketWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: Record<string, unknown>,
  ): Promise<void> {
    this.verifySignature(req);

    const rawTicketId = body[this.ticketIdField];
    const glpiTicketId = Number(rawTicketId);
    if (rawTicketId === undefined || !Number.isFinite(glpiTicketId)) {
      throw new BadRequestException('Missing or invalid ticket id field');
    }

    const ticketRef = await this.prisma.ticketRef.findFirst({
      where: { glpiTicketId },
    });
    if (!ticketRef) {
      throw new NotFoundException();
    }

    let ticket: { status: string } | null;
    try {
      ticket = await this.glpiService.getTicket(glpiTicketId);
    } catch (err) {
      if (err instanceof GlpiUnavailableError) {
        throw new BadGatewayException('GLPI is unreachable');
      }
      throw err;
    }
    if (!ticket) {
      throw new NotFoundException();
    }

    await this.prisma.ticketRef.update({
      where: { id: ticketRef.id },
      data: { status: ticket.status },
    });

    const message = await this.messagesService.getById(ticketRef.messageId);
    if (!message) {
      return;
    }
    const dto = toMessageDto(message, this.glpiUrl);
    this.chatGateway.server
      .to(channelRoom(dto.channelId))
      .emit(SocketEvent.MESSAGE_UPDATED, dto);
  }

  private verifySignature(req: RawBodyRequest<Request>): void {
    if (!this.webhookSecret) {
      return;
    }

    const header = req.headers['x-glpi-signature'];
    const signature = Array.isArray(header) ? header[0] : header;
    if (!signature?.startsWith(SIGNATURE_PREFIX) || !req.rawBody) {
      throw new UnauthorizedException('Missing signature');
    }

    const expected = createHmac('sha256', this.webhookSecret)
      .update(req.rawBody)
      .digest('hex');
    const provided = signature.slice(SIGNATURE_PREFIX.length);
    const expectedBuf = Buffer.from(expected, 'hex');
    const providedBuf = Buffer.from(provided, 'hex');

    if (
      expectedBuf.length !== providedBuf.length ||
      !timingSafeEqual(expectedBuf, providedBuf)
    ) {
      throw new UnauthorizedException('Invalid signature');
    }
  }
}
