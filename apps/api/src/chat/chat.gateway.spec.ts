import { Test, TestingModule } from '@nestjs/testing';
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
  let channelsService: { listForUser: jest.Mock; isMember: jest.Mock };
  let messagesService: { create: jest.Mock };
  let presenceService: {
    markOnline: jest.Mock;
    markOffline: jest.Mock;
    listOnlineUsers: jest.Mock;
  };
  let server: { emit: jest.Mock };

  const user = { id: 'user-1' };
  const author = {
    id: 'user-1',
    username: 'jsilva',
    displayName: 'Joao Silva',
    avatarUrl: null,
    isActive: true,
  };

  beforeEach(async () => {
    channelsService = { listForUser: jest.fn(), isMember: jest.fn() };
    messagesService = { create: jest.fn() };
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
      ],
    }).compile();

    gateway = module.get(ChatGateway);
    server = { emit: jest.fn() };
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
      const created = {
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
      };
      messagesService.create.mockResolvedValue(created);
      const socket = fakeSocket(user);

      const ack = await gateway.handleMessageSend(asGatewaySocket(socket), {
        channelId: 'channel-1',
        content: 'hi',
      });

      expect(messagesService.create).toHaveBeenCalledWith({
        channelId: 'channel-1',
        authorId: 'user-1',
        content: 'hi',
      });
      expect(socket.to).toHaveBeenCalledWith('channel:channel-1');
      expect(socket.__roomEmit).toHaveBeenCalledWith(
        SocketEvent.MESSAGE_NEW,
        expect.objectContaining({ id: 'm1', content: 'hi' }),
      );
      expect(ack).toHaveProperty('message.id', 'm1');
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
