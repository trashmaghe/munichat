import { BadGatewayException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { SocketEvent } from '@elyzian/shared';
import { RmmWebhookController } from './rmm-webhook.controller';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { ChannelsService } from '../channels/channels.service';
import { MessagesService } from '../messages/messages.service';
import { ChatGateway } from '../chat/chat.gateway';
import { channelRoom } from '../chat/channel-room';

function fakeRequest(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

describe('RmmWebhookController', () => {
  let controller: RmmWebhookController;
  let prisma: {
    rmmAlertRef: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let usersService: { findByUsername: jest.Mock };
  let channelsService: { findByName: jest.Mock };
  let messagesService: {
    create: jest.Mock;
    createSystemMessage: jest.Mock;
    getById: jest.Mock;
  };
  let chatGateway: { server: { to: jest.Mock; __roomEmit: jest.Mock } };
  let config: Record<string, string | undefined>;

  const bot = { id: 'bot-1', username: 'rmm-bot', displayName: 'Tactical RMM' };
  const channel = { id: 'channel-1', name: 'ti' };

  const message = {
    id: 'm1',
    channelId: 'channel-1',
    authorId: 'bot-1',
    content: '[ERROR] PC-12 (Prefeitura / Sede): offline',
    type: 'SYSTEM',
    replyToId: null,
    editedAt: null,
    deletedAt: null,
    createdAt: new Date('2026-07-16T00:00:00.000Z'),
    author: {
      id: 'bot-1',
      username: 'rmm-bot',
      displayName: 'Tactical RMM',
      avatarUrl: null,
    },
    attachments: [],
    linkPreview: null,
    ticketRef: null,
    replyTo: null,
  };

  const validAlert = {
    alertId: 'alert-1',
    hostname: 'PC-12',
    client: 'Prefeitura',
    site: 'Sede',
    severity: 'warning' as const,
    message: 'offline',
    resolved: false,
  };

  async function buildController(): Promise<RmmWebhookController> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RmmWebhookController,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
        { provide: ChannelsService, useValue: channelsService },
        { provide: MessagesService, useValue: messagesService },
        { provide: ChatGateway, useValue: chatGateway },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config[key] },
        },
      ],
    }).compile();
    return module.get(RmmWebhookController);
  }

  beforeEach(() => {
    prisma = {
      rmmAlertRef: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    usersService = { findByUsername: jest.fn().mockResolvedValue(bot) };
    channelsService = { findByName: jest.fn().mockResolvedValue(channel) };
    messagesService = {
      create: jest.fn(),
      createSystemMessage: jest.fn().mockResolvedValue(message),
      getById: jest.fn().mockResolvedValue(message),
    };
    const roomEmit = jest.fn();
    chatGateway = {
      server: {
        to: jest.fn().mockReturnValue({ emit: roomEmit }),
        __roomEmit: roomEmit,
      },
    };
    config = {
      GLPI_URL: 'https://glpi.example.com',
      RMM_WEBHOOK_SECRET: undefined,
      RMM_ALERT_CHANNEL_NAME: 'ti',
      RMM_AUTO_TICKET_SEVERITY: 'error',
    };
  });

  it('rejects with 400 for a malformed payload', async () => {
    controller = await buildController();

    await expect(
      controller.handleAlertWebhook(fakeRequest(), { bogus: true }),
    ).rejects.toThrow();
  });

  it('rejects with 401 when a secret is configured but no bearer token is present', async () => {
    config.RMM_WEBHOOK_SECRET = 'shh';
    controller = await buildController();

    await expect(
      controller.handleAlertWebhook(fakeRequest(), validAlert),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects with 401 when the bearer token does not match', async () => {
    config.RMM_WEBHOOK_SECRET = 'shh';
    controller = await buildController();

    await expect(
      controller.handleAlertWebhook(
        fakeRequest({ authorization: 'Bearer wrong' }),
        validAlert,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a request whose bearer token matches the shared secret', async () => {
    config.RMM_WEBHOOK_SECRET = 'shh';
    controller = await buildController();

    await controller.handleAlertWebhook(
      fakeRequest({ authorization: 'Bearer shh' }),
      validAlert,
    );

    expect(prisma.rmmAlertRef.create).toHaveBeenCalled();
  });

  it('rejects with 502 when the configured alert channel does not exist', async () => {
    channelsService.findByName.mockResolvedValue(null);
    controller = await buildController();

    await expect(
      controller.handleAlertWebhook(fakeRequest(), validAlert),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('posts a SYSTEM message and tracks a new below-threshold alert without opening a ticket', async () => {
    prisma.rmmAlertRef.findUnique.mockResolvedValue(null);
    controller = await buildController();

    await controller.handleAlertWebhook(fakeRequest(), validAlert);

    expect(messagesService.create).not.toHaveBeenCalled();
    expect(messagesService.createSystemMessage).toHaveBeenCalledWith(
      'channel-1',
      'bot-1',
      expect.stringContaining('PC-12'),
    );
    expect(prisma.rmmAlertRef.create).toHaveBeenCalledWith({
      data: { messageId: 'm1', rmmAlertId: 'alert-1', severity: 'warning' },
    });
    expect(chatGateway.server.to).toHaveBeenCalledWith(
      channelRoom('channel-1'),
    );
    expect(chatGateway.server.__roomEmit).toHaveBeenCalledWith(
      SocketEvent.MESSAGE_NEW,
      expect.objectContaining({ id: 'm1' }),
    );
  });

  it('opens a GLPI ticket via /ticket for an error-severity alert at the default threshold', async () => {
    prisma.rmmAlertRef.findUnique.mockResolvedValue(null);
    messagesService.create.mockResolvedValue({
      message: { ...message, id: 'm2' },
    });
    messagesService.getById.mockResolvedValue({ ...message, id: 'm2' });
    controller = await buildController();

    await controller.handleAlertWebhook(fakeRequest(), {
      ...validAlert,
      severity: 'error',
    });

    expect(messagesService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'channel-1',
        authorId: 'bot-1',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.stringMatching() nested this way is typed `any` in @types/jest
        content: expect.stringMatching(/^\/ticket /),
      }),
    );
    expect(prisma.rmmAlertRef.create).toHaveBeenCalledWith({
      data: { messageId: 'm2', rmmAlertId: 'alert-1', severity: 'error' },
    });
  });

  it('falls back to a SYSTEM message when the ticket-creation path errors', async () => {
    prisma.rmmAlertRef.findUnique.mockResolvedValue(null);
    messagesService.create.mockResolvedValue({ error: 'GLPI is unreachable' });
    controller = await buildController();

    await controller.handleAlertWebhook(fakeRequest(), {
      ...validAlert,
      severity: 'error',
    });

    expect(messagesService.createSystemMessage).toHaveBeenCalledWith(
      'channel-1',
      'bot-1',
      expect.stringContaining('failed to open a GLPI ticket'),
    );
    expect(prisma.rmmAlertRef.create).toHaveBeenCalled();
  });

  it('ignores a duplicate delivery of an already-tracked unresolved alert', async () => {
    prisma.rmmAlertRef.findUnique.mockResolvedValue({
      id: 'ref-1',
      messageId: 'm1',
    });
    controller = await buildController();

    await controller.handleAlertWebhook(fakeRequest(), validAlert);

    expect(messagesService.createSystemMessage).not.toHaveBeenCalled();
    expect(messagesService.create).not.toHaveBeenCalled();
    expect(prisma.rmmAlertRef.create).not.toHaveBeenCalled();
  });

  it('marks the ref resolved and broadcasts message:updated on a resolve webhook', async () => {
    prisma.rmmAlertRef.findUnique.mockResolvedValue({
      id: 'ref-1',
      messageId: 'm1',
    });
    controller = await buildController();

    await controller.handleAlertWebhook(fakeRequest(), {
      ...validAlert,
      resolved: true,
    });

    expect(prisma.rmmAlertRef.update).toHaveBeenCalledWith({
      where: { id: 'ref-1' },
      data: { resolved: true },
    });
    expect(chatGateway.server.__roomEmit).toHaveBeenCalledWith(
      SocketEvent.MESSAGE_UPDATED,
      expect.objectContaining({ id: 'm1' }),
    );
  });

  it('no-ops a resolve webhook for an alert that was never tracked', async () => {
    prisma.rmmAlertRef.findUnique.mockResolvedValue(null);
    controller = await buildController();

    await controller.handleAlertWebhook(fakeRequest(), {
      ...validAlert,
      resolved: true,
    });

    expect(prisma.rmmAlertRef.update).not.toHaveBeenCalled();
    expect(chatGateway.server.to).not.toHaveBeenCalled();
  });
});
