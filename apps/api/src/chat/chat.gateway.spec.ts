import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Server } from 'socket.io';
import { SocketEvent } from '@munichat/shared';
import { ChatGateway } from './chat.gateway';
import { ChatAuthService } from './chat-auth.service';
import { PresenceService } from './presence.service';
import { ChannelsService } from '../channels/channels.service';
import { MessagesService } from '../messages/messages.service';

type FakeSocket = ReturnType<typeof fakeSocket>;
type GatewaySocket = Parameters<ChatGateway['handleConnection']>[0];

function fakeSocket(user: { id: string }) {
  const roomEmit = jest.fn();
  return {
    data: { user },
    join: jest.fn(),
    emit: jest.fn(),
    to: jest.fn().mockReturnValue({ emit: roomEmit }),
    __roomEmit: roomEmit,
  };
}

function asGatewaySocket(socket: FakeSocket): GatewaySocket {
  return socket as unknown as GatewaySocket;
}

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let channelsService: {
    listForUser: jest.Mock;
    isMember: jest.Mock;
    markRead: jest.Mock;
  };
  let messagesService: {
    create: jest.Mock;
    getById: jest.Mock;
    update: jest.Mock;
    softDelete: jest.Mock;
  };
  let presenceService: {
    markOnline: jest.Mock;
    markOffline: jest.Mock;
    listOnlineUsers: jest.Mock;
  };
  let server: { emit: jest.Mock; to: jest.Mock; __roomEmit: jest.Mock };

  const user = { id: 'user-1' };
  const author = {
    id: 'user-1',
    username: 'jsilva',
    displayName: 'Joao Silva',
    avatarUrl: null,
    isActive: true,
  };

  function buildMessage(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'm1',
      channelId: 'channel-1',
      authorId: 'user-1',
      content: 'hi',
      type: 'TEXT',
      replyToId: null,
      editedAt: null,
      deletedAt: null,
      createdAt: new Date('2026-07-10T00:00:00.000Z'),
      author,
      attachments: [],
      linkPreview: null,
      ticketRef: null,
      replyTo: null,
      ...overrides,
    };
  }

  beforeEach(async () => {
    channelsService = {
      listForUser: jest.fn(),
      isMember: jest.fn(),
      markRead: jest.fn(),
    };
    messagesService = {
      create: jest.fn(),
      getById: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    };
    presenceService = {
      markOnline: jest.fn(),
      markOffline: jest.fn(),
      listOnlineUsers: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatGateway,
        { provide: ChatAuthService, useValue: {} },
        { provide: ChannelsService, useValue: channelsService },
        { provide: MessagesService, useValue: messagesService },
        { provide: PresenceService, useValue: presenceService },
        {
          provide: ConfigService,
          useValue: { get: () => 'https://glpi.example.com' },
        },
      ],
    }).compile();

    gateway = module.get(ChatGateway);
    const roomEmit = jest.fn();
    server = {
      emit: jest.fn(),
      to: jest.fn().mockReturnValue({ emit: roomEmit }),
      __roomEmit: roomEmit,
    };
    gateway.server = server as unknown as Server;
  });

  describe('handleConnection', () => {
    it('joins a room per channel membership, syncs presence, and broadcasts only on the online transition', async () => {
      channelsService.listForUser.mockResolvedValue([
        { id: 'channel-1' },
        { id: 'channel-2' },
      ]);
      presenceService.markOnline.mockResolvedValue(true);
      presenceService.listOnlineUsers.mockResolvedValue(['user-1']);
      const socket = fakeSocket(user);

      await gateway.handleConnection(asGatewaySocket(socket));

      expect(socket.join).toHaveBeenCalledWith('channel:channel-1');
      expect(socket.join).toHaveBeenCalledWith('channel:channel-2');
      expect(server.emit).toHaveBeenCalledWith(SocketEvent.PRESENCE_UPDATE, {
        userId: 'user-1',
        online: true,
      });
      expect(socket.emit).toHaveBeenCalledWith(SocketEvent.PRESENCE_SYNC, {
        onlineUserIds: ['user-1'],
      });
    });

    it('does not broadcast presence:update when the user was already online (another tab)', async () => {
      channelsService.listForUser.mockResolvedValue([]);
      presenceService.markOnline.mockResolvedValue(false);
      presenceService.listOnlineUsers.mockResolvedValue(['user-1']);
      const socket = fakeSocket(user);

      await gateway.handleConnection(asGatewaySocket(socket));

      expect(server.emit).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith(SocketEvent.PRESENCE_SYNC, {
        onlineUserIds: ['user-1'],
      });
    });
  });

  describe('handleDisconnect', () => {
    it('broadcasts presence:update only on the offline transition', async () => {
      presenceService.markOffline.mockResolvedValue(true);
      const socket = fakeSocket(user);

      await gateway.handleDisconnect(asGatewaySocket(socket));

      expect(server.emit).toHaveBeenCalledWith(SocketEvent.PRESENCE_UPDATE, {
        userId: 'user-1',
        online: false,
      });
    });

    it('does not broadcast when other sockets for the user remain connected', async () => {
      presenceService.markOffline.mockResolvedValue(false);
      const socket = fakeSocket(user);

      await gateway.handleDisconnect(asGatewaySocket(socket));

      expect(server.emit).not.toHaveBeenCalled();
    });
  });

  describe('handleMessageSend', () => {
    it('returns an error ack for an invalid payload without touching Prisma', async () => {
      const socket = fakeSocket(user);

      const ack = await gateway.handleMessageSend(asGatewaySocket(socket), {
        channelId: 'channel-1',
        content: '',
      });

      expect(ack).toEqual({ error: 'Invalid message payload' });
      expect(messagesService.create).not.toHaveBeenCalled();
    });

    it('returns an error ack when the sender is not a member of the channel', async () => {
      channelsService.isMember.mockResolvedValue(false);
      const socket = fakeSocket(user);

      const ack = await gateway.handleMessageSend(asGatewaySocket(socket), {
        channelId: 'channel-1',
        content: 'hi',
      });

      expect(ack).toEqual({ error: 'You are not a member of this channel' });
      expect(messagesService.create).not.toHaveBeenCalled();
    });

    it('persists the message, relays to the room excluding the sender, and acks with the message', async () => {
      channelsService.isMember.mockResolvedValue(true);
      const created = buildMessage();
      messagesService.create.mockResolvedValue({ message: created });
      const socket = fakeSocket(user);

      const ack = await gateway.handleMessageSend(asGatewaySocket(socket), {
        channelId: 'channel-1',
        content: 'hi',
      });

      expect(messagesService.create).toHaveBeenCalledWith({
        channelId: 'channel-1',
        authorId: 'user-1',
        content: 'hi',
        replyToId: undefined,
        attachments: undefined,
      });
      expect(socket.to).toHaveBeenCalledWith('channel:channel-1');
      expect(socket.__roomEmit).toHaveBeenCalledWith(
        SocketEvent.MESSAGE_NEW,
        expect.objectContaining({ id: 'm1', content: 'hi' }),
      );
      expect(ack).toHaveProperty('message.id', 'm1');
    });

    it("marks the sender's own channel read at the message it just sent", async () => {
      channelsService.isMember.mockResolvedValue(true);
      const created = buildMessage();
      messagesService.create.mockResolvedValue({ message: created });
      const socket = fakeSocket(user);

      await gateway.handleMessageSend(asGatewaySocket(socket), {
        channelId: 'channel-1',
        content: 'hi',
      });

      expect(channelsService.markRead).toHaveBeenCalledWith(
        'user-1',
        'channel-1',
        'm1',
        created.createdAt,
      );
    });

    it('relays the error from MessagesService.create (e.g. attachment size mismatch) as the ack', async () => {
      channelsService.isMember.mockResolvedValue(true);
      messagesService.create.mockResolvedValue({
        error: 'Attachment size does not match the uploaded file',
      });
      const socket = fakeSocket(user);

      const ack = await gateway.handleMessageSend(asGatewaySocket(socket), {
        channelId: 'channel-1',
        content: '',
        attachments: [
          {
            objectKey: 'k',
            fileName: 'f',
            mimeType: 'image/png',
            sizeBytes: 1,
          },
        ],
      });

      expect(ack).toEqual({
        error: 'Attachment size does not match the uploaded file',
      });
      expect(socket.to).not.toHaveBeenCalled();
    });
  });

  describe('handleMessageEdit', () => {
    it('returns an error ack for an invalid payload', async () => {
      const socket = fakeSocket(user);

      const ack = await gateway.handleMessageEdit(asGatewaySocket(socket), {
        messageId: 'm1',
        content: '',
      });

      expect(ack).toEqual({ error: 'Invalid message payload' });
      expect(messagesService.getById).not.toHaveBeenCalled();
    });

    it('returns an error ack when the message does not exist', async () => {
      messagesService.getById.mockResolvedValue(null);
      const socket = fakeSocket(user);

      const ack = await gateway.handleMessageEdit(asGatewaySocket(socket), {
        messageId: 'm1',
        content: 'new',
      });

      expect(ack).toEqual({ error: 'Message not found' });
    });

    it('returns an error ack when the requester is not the author', async () => {
      messagesService.getById.mockResolvedValue(
        buildMessage({ authorId: 'user-2' }),
      );
      const socket = fakeSocket(user);

      const ack = await gateway.handleMessageEdit(asGatewaySocket(socket), {
        messageId: 'm1',
        content: 'new',
      });

      expect(ack).toEqual({ error: 'You can only edit your own messages' });
      expect(messagesService.update).not.toHaveBeenCalled();
    });

    it('returns an error ack when the message is already deleted', async () => {
      messagesService.getById.mockResolvedValue(
        buildMessage({ deletedAt: new Date() }),
      );
      const socket = fakeSocket(user);

      const ack = await gateway.handleMessageEdit(asGatewaySocket(socket), {
        messageId: 'm1',
        content: 'new',
      });

      expect(ack).toEqual({ error: 'Cannot edit a deleted message' });
      expect(messagesService.update).not.toHaveBeenCalled();
    });

    it('updates the message and broadcasts message:updated to the whole room, including the sender', async () => {
      messagesService.getById.mockResolvedValue(buildMessage());
      const updated = buildMessage({ content: 'new', editedAt: new Date() });
      messagesService.update.mockResolvedValue(updated);
      const socket = fakeSocket(user);

      const ack = await gateway.handleMessageEdit(asGatewaySocket(socket), {
        messageId: 'm1',
        content: 'new',
      });

      expect(messagesService.update).toHaveBeenCalledWith('m1', 'new');
      expect(server.to).toHaveBeenCalledWith('channel:channel-1');
      expect(server.__roomEmit).toHaveBeenCalledWith(
        SocketEvent.MESSAGE_UPDATED,
        expect.objectContaining({ id: 'm1', content: 'new' }),
      );
      expect(socket.to).not.toHaveBeenCalled();
      expect(ack).toHaveProperty('message.content', 'new');
    });
  });

  describe('handleMessageDelete', () => {
    it('returns an error ack when the requester is not the author', async () => {
      messagesService.getById.mockResolvedValue(
        buildMessage({ authorId: 'user-2' }),
      );
      const socket = fakeSocket(user);

      const ack = await gateway.handleMessageDelete(asGatewaySocket(socket), {
        messageId: 'm1',
      });

      expect(ack).toEqual({ error: 'You can only delete your own messages' });
      expect(messagesService.softDelete).not.toHaveBeenCalled();
    });

    it('soft-deletes and broadcasts message:updated to the whole room', async () => {
      messagesService.getById.mockResolvedValue(buildMessage());
      const deleted = buildMessage({ content: '', deletedAt: new Date() });
      messagesService.softDelete.mockResolvedValue(deleted);
      const socket = fakeSocket(user);

      const ack = await gateway.handleMessageDelete(asGatewaySocket(socket), {
        messageId: 'm1',
      });

      expect(messagesService.softDelete).toHaveBeenCalledWith('m1');
      expect(server.to).toHaveBeenCalledWith('channel:channel-1');
      expect(server.__roomEmit).toHaveBeenCalledWith(
        SocketEvent.MESSAGE_UPDATED,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() is typed `any` in @types/jest when nested this way
        expect.objectContaining({ id: 'm1', deletedAt: expect.any(String) }),
      );
      expect(ack).toHaveProperty('message.id', 'm1');
    });
  });

  describe('handleChannelRead', () => {
    it('returns an error ack for an invalid payload', async () => {
      const socket = fakeSocket(user);

      const ack = await gateway.handleChannelRead(asGatewaySocket(socket), {
        channelId: 'channel-1',
      });

      expect(ack).toEqual({ error: 'Invalid channel-read payload' });
      expect(channelsService.markRead).not.toHaveBeenCalled();
    });

    it('returns an error ack when the sender is not a member of the channel', async () => {
      channelsService.isMember.mockResolvedValue(false);
      const socket = fakeSocket(user);

      const ack = await gateway.handleChannelRead(asGatewaySocket(socket), {
        channelId: 'channel-1',
        messageId: 'm1',
      });

      expect(ack).toEqual({ error: 'You are not a member of this channel' });
      expect(channelsService.markRead).not.toHaveBeenCalled();
    });

    it('returns an error ack when the message does not belong to the channel', async () => {
      channelsService.isMember.mockResolvedValue(true);
      messagesService.getById.mockResolvedValue(
        buildMessage({ channelId: 'channel-2' }),
      );
      const socket = fakeSocket(user);

      const ack = await gateway.handleChannelRead(asGatewaySocket(socket), {
        channelId: 'channel-1',
        messageId: 'm1',
      });

      expect(ack).toEqual({ error: 'Message not found in this channel' });
      expect(channelsService.markRead).not.toHaveBeenCalled();
    });

    it('marks the channel read and acks, without broadcasting to the room', async () => {
      channelsService.isMember.mockResolvedValue(true);
      const message = buildMessage();
      messagesService.getById.mockResolvedValue(message);
      const socket = fakeSocket(user);

      const ack = await gateway.handleChannelRead(asGatewaySocket(socket), {
        channelId: 'channel-1',
        messageId: 'm1',
      });

      expect(channelsService.markRead).toHaveBeenCalledWith(
        'user-1',
        'channel-1',
        'm1',
        message.createdAt,
      );
      expect(ack).toEqual({ ok: true });
      expect(socket.to).not.toHaveBeenCalled();
      expect(server.to).not.toHaveBeenCalled();
    });
  });

  describe('typing relay', () => {
    it('relays typing:start to the room excluding the sender when the sender is a member', async () => {
      channelsService.isMember.mockResolvedValue(true);
      const socket = fakeSocket(user);

      await gateway.handleTypingStart(asGatewaySocket(socket), {
        channelId: 'channel-1',
      });

      expect(socket.to).toHaveBeenCalledWith('channel:channel-1');
      expect(socket.__roomEmit).toHaveBeenCalledWith(SocketEvent.TYPING_START, {
        channelId: 'channel-1',
        userId: 'user-1',
      });
    });

    it('does not relay typing:stop when the sender is not a member', async () => {
      channelsService.isMember.mockResolvedValue(false);
      const socket = fakeSocket(user);

      await gateway.handleTypingStop(asGatewaySocket(socket), {
        channelId: 'channel-1',
      });

      expect(socket.to).not.toHaveBeenCalled();
    });

    it('ignores a malformed typing payload', async () => {
      const socket = fakeSocket(user);

      await gateway.handleTypingStart(asGatewaySocket(socket), {});

      expect(channelsService.isMember).not.toHaveBeenCalled();
      expect(socket.to).not.toHaveBeenCalled();
    });
  });
});
