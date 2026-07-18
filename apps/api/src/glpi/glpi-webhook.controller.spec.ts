import { createHmac } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { SocketEvent } from '@elyzian/shared';
import { GlpiWebhookController } from './glpi-webhook.controller';
import { GlpiService, GlpiUnavailableError } from './glpi.service';
import { PrismaService } from '../prisma/prisma.service';
import { MessagesService } from '../messages/messages.service';
import { ChatGateway } from '../chat/chat.gateway';
import { channelRoom } from '../chat/channel-room';

function fakeRequest(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): RawBodyRequest<Request> {
  return {
    headers,
    rawBody: Buffer.from(JSON.stringify(body)),
  } as unknown as RawBodyRequest<Request>;
}

function sign(secret: string, body: Record<string, unknown>): string {
  const hmac = createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex');
  return `sha256=${hmac}`;
}

describe('GlpiWebhookController', () => {
  let controller: GlpiWebhookController;
  let prisma: {
    ticketRef: { findFirst: jest.Mock; update: jest.Mock };
  };
  let glpiService: { getTicket: jest.Mock };
  let messagesService: { getById: jest.Mock };
  let chatGateway: { server: { to: jest.Mock; __roomEmit: jest.Mock } };
  let config: Record<string, string | undefined>;

  const ticketRef = {
    id: 'ticket-ref-1',
    messageId: 'm1',
    glpiTicketId: 42,
    status: 'New',
    createdById: 'user-1',
  };

  const message = {
    id: 'm1',
    channelId: 'channel-1',
    authorId: 'user-1',
    content: 'printer jammed',
    type: 'TICKET',
    replyToId: null,
    editedAt: null,
    deletedAt: null,
    createdAt: new Date('2026-07-10T00:00:00.000Z'),
    author: {
      id: 'user-1',
      username: 'jsilva',
      displayName: 'Joao Silva',
      avatarUrl: null,
    },
    attachments: [],
    linkPreview: null,
    ticketRef: {
      glpiTicketId: 42,
      status: 'Solved',
      createdAt: new Date('2026-07-10T00:00:00.000Z'),
      updatedAt: new Date('2026-07-10T00:05:00.000Z'),
    },
    replyTo: null,
  };

  async function buildController(): Promise<GlpiWebhookController> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GlpiWebhookController,
        { provide: PrismaService, useValue: prisma },
        { provide: GlpiService, useValue: glpiService },
        { provide: MessagesService, useValue: messagesService },
        { provide: ChatGateway, useValue: chatGateway },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config[key] },
        },
      ],
    }).compile();
    return module.get(GlpiWebhookController);
  }

  beforeEach(() => {
    prisma = {
      ticketRef: { findFirst: jest.fn(), update: jest.fn() },
    };
    glpiService = { getTicket: jest.fn() };
    messagesService = { getById: jest.fn() };
    const roomEmit = jest.fn();
    chatGateway = {
      server: {
        to: jest.fn().mockReturnValue({ emit: roomEmit }),
        __roomEmit: roomEmit,
      },
    };
    config = {
      GLPI_URL: 'https://glpi.example.com',
      GLPI_WEBHOOK_SECRET: undefined,
      GLPI_WEBHOOK_TICKET_ID_FIELD: 'id',
    };
  });

  it('processes an unsigned webhook when no secret is configured, updates status, and broadcasts', async () => {
    controller = await buildController();
    prisma.ticketRef.findFirst.mockResolvedValue(ticketRef);
    glpiService.getTicket.mockResolvedValue({ status: 'Solved' });
    prisma.ticketRef.update.mockResolvedValue({
      ...ticketRef,
      status: 'Solved',
    });
    messagesService.getById.mockResolvedValue(message);

    await controller.handleTicketWebhook(fakeRequest({ id: 42 }), { id: 42 });

    expect(prisma.ticketRef.findFirst).toHaveBeenCalledWith({
      where: { glpiTicketId: 42 },
    });
    expect(glpiService.getTicket).toHaveBeenCalledWith(42);
    expect(prisma.ticketRef.update).toHaveBeenCalledWith({
      where: { id: 'ticket-ref-1' },
      data: { status: 'Solved' },
    });
    expect(chatGateway.server.to).toHaveBeenCalledWith(
      channelRoom('channel-1'),
    );
    expect(chatGateway.server.__roomEmit).toHaveBeenCalledWith(
      SocketEvent.MESSAGE_UPDATED,
      expect.objectContaining({ id: 'm1', channelId: 'channel-1' }),
    );
  });

  it('extracts the ticket id from a configurable field name', async () => {
    config.GLPI_WEBHOOK_TICKET_ID_FIELD = 'ticket_id';
    controller = await buildController();
    prisma.ticketRef.findFirst.mockResolvedValue(ticketRef);
    glpiService.getTicket.mockResolvedValue({ status: 'Solved' });
    prisma.ticketRef.update.mockResolvedValue(ticketRef);
    messagesService.getById.mockResolvedValue(message);

    await controller.handleTicketWebhook(fakeRequest({ ticket_id: 42 }), {
      ticket_id: 42,
    });

    expect(prisma.ticketRef.findFirst).toHaveBeenCalledWith({
      where: { glpiTicketId: 42 },
    });
  });

  it('rejects with 400 when the ticket id field is missing or non-numeric', async () => {
    controller = await buildController();

    await expect(
      controller.handleTicketWebhook(fakeRequest({}), {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.handleTicketWebhook(fakeRequest({ id: 'not-a-number' }), {
        id: 'not-a-number',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.ticketRef.findFirst).not.toHaveBeenCalled();
  });

  it('rejects with 404 when no TicketRef matches the glpiTicketId', async () => {
    controller = await buildController();
    prisma.ticketRef.findFirst.mockResolvedValue(null);

    await expect(
      controller.handleTicketWebhook(fakeRequest({ id: 999 }), { id: 999 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(glpiService.getTicket).not.toHaveBeenCalled();
  });

  it('rejects with 502 when GLPI is unreachable', async () => {
    controller = await buildController();
    prisma.ticketRef.findFirst.mockResolvedValue(ticketRef);
    glpiService.getTicket.mockRejectedValue(new GlpiUnavailableError());

    await expect(
      controller.handleTicketWebhook(fakeRequest({ id: 42 }), { id: 42 }),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(prisma.ticketRef.update).not.toHaveBeenCalled();
  });

  it('rejects with 401 when a secret is configured but no signature header is present', async () => {
    config.GLPI_WEBHOOK_SECRET = 'shh';
    controller = await buildController();

    await expect(
      controller.handleTicketWebhook(fakeRequest({ id: 42 }), { id: 42 }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.ticketRef.findFirst).not.toHaveBeenCalled();
  });

  it('rejects with 401 when the signature does not match', async () => {
    config.GLPI_WEBHOOK_SECRET = 'shh';
    controller = await buildController();
    const req = fakeRequest(
      { id: 42 },
      { 'x-glpi-signature': 'sha256=deadbeef' },
    );

    await expect(
      controller.handleTicketWebhook(req, { id: 42 }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a webhook whose signature matches the shared secret', async () => {
    config.GLPI_WEBHOOK_SECRET = 'shh';
    controller = await buildController();
    prisma.ticketRef.findFirst.mockResolvedValue(ticketRef);
    glpiService.getTicket.mockResolvedValue({ status: 'Solved' });
    prisma.ticketRef.update.mockResolvedValue(ticketRef);
    messagesService.getById.mockResolvedValue(message);
    const body = { id: 42 };
    const req = fakeRequest(body, {
      'x-glpi-signature': sign('shh', body),
    });

    await controller.handleTicketWebhook(req, body);

    expect(prisma.ticketRef.update).toHaveBeenCalled();
  });
});
