import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { User } from '@prisma/client';
import {
  Message,
  PresenceSyncPayload,
  PresenceUpdatePayload,
  SendMessageRequest,
  sendMessageRequestSchema,
  SocketEvent,
  TypingBroadcast,
  typingClientPayloadSchema,
} from '@munichat/shared';
import { Server, Socket } from 'socket.io';
import { ChannelsService } from '../channels/channels.service';
import { MessagesService } from '../messages/messages.service';
import { toMessageDto } from '../messages/message-response.mapper';
import { ChatAuthService } from './chat-auth.service';
import { PresenceService } from './presence.service';

type AuthenticatedSocket = Socket<any, any, any, { user: User }>;

type MessageSendAck = { message: Message } | { error: string };

@WebSocketGateway({
  cors: {
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  },
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly chatAuthService: ChatAuthService,
    private readonly channelsService: ChannelsService,
    private readonly messagesService: MessagesService,
    private readonly presenceService: PresenceService,
  ) {}

  afterInit(server: Server): void {
    server.use((socket, next) => {
      this.chatAuthService
        .authenticate(socket)
        .then((user) => {
          (socket as AuthenticatedSocket).data.user = user;
          next();
        })
        .catch((err: unknown) =>
          next(err instanceof Error ? err : new Error('Unauthorized')),
        );
    });
  }

  async handleConnection(socket: AuthenticatedSocket): Promise<void> {
    const user = socket.data.user;
    const channels = await this.channelsService.listForUser(user.id);
    for (const channel of channels) {
      await socket.join(this.channelRoom(channel.id));
    }

    const becameOnline = await this.presenceService.markOnline(user.id);
    if (becameOnline) {
      const payload: PresenceUpdatePayload = { userId: user.id, online: true };
      this.server.emit(SocketEvent.PRESENCE_UPDATE, payload);
    }

    const onlineUserIds = await this.presenceService.listOnlineUsers();
    const syncPayload: PresenceSyncPayload = { onlineUserIds };
    socket.emit(SocketEvent.PRESENCE_SYNC, syncPayload);
  }

  async handleDisconnect(socket: AuthenticatedSocket): Promise<void> {
    const user = socket.data.user;
    if (!user) {
      return;
    }
    const becameOffline = await this.presenceService.markOffline(user.id);
    if (becameOffline) {
      const payload: PresenceUpdatePayload = { userId: user.id, online: false };
      this.server.emit(SocketEvent.PRESENCE_UPDATE, payload);
    }
  }

  @SubscribeMessage(SocketEvent.MESSAGE_SEND)
  async handleMessageSend(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() body: unknown,
  ): Promise<MessageSendAck> {
    const user = socket.data.user;
    const parsed = sendMessageRequestSchema.safeParse(body);
    if (!parsed.success) {
      return { error: 'Invalid message payload' };
    }
    const request: SendMessageRequest = parsed.data;

    const isMember = await this.channelsService.isMember(
      user.id,
      request.channelId,
    );
    if (!isMember) {
      return { error: 'You are not a member of this channel' };
    }

    const created = await this.messagesService.create({
      channelId: request.channelId,
      authorId: user.id,
      content: request.content,
    });
    const dto = toMessageDto(created);

    socket
      .to(this.channelRoom(request.channelId))
      .emit(SocketEvent.MESSAGE_NEW, dto);

    return { message: dto };
  }

  @SubscribeMessage(SocketEvent.TYPING_START)
  async handleTypingStart(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    await this.relayTyping(socket, body, SocketEvent.TYPING_START);
  }

  @SubscribeMessage(SocketEvent.TYPING_STOP)
  async handleTypingStop(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    await this.relayTyping(socket, body, SocketEvent.TYPING_STOP);
  }

  private async relayTyping(
    socket: AuthenticatedSocket,
    body: unknown,
    event: SocketEvent,
  ): Promise<void> {
    const parsed = typingClientPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return;
    }

    const user = socket.data.user;
    const isMember = await this.channelsService.isMember(
      user.id,
      parsed.data.channelId,
    );
    if (!isMember) {
      return;
    }

    const payload: TypingBroadcast = {
      channelId: parsed.data.channelId,
      userId: user.id,
    };
    socket.to(this.channelRoom(parsed.data.channelId)).emit(event, payload);
  }

  private channelRoom(channelId: string): string {
    return `channel:${channelId}`;
  }
}
