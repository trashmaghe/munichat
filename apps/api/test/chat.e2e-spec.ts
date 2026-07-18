import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import { io, Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import {
  ChannelSummary,
  channelSummarySchema,
  Message,
  messageHistoryResponseSchema,
  PresenceSyncPayload,
  PresenceUpdatePayload,
  SocketEvent,
  TypingBroadcast,
} from '@elyzian/shared';
import { z } from 'zod';
import { AppModule } from './../src/app.module';
import { RedisIoAdapter } from '../src/chat/redis-io.adapter';

function extractCookie(
  setCookieHeader: string | string[] | undefined,
  name: string,
): string {
  const cookies = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : [];
  const cookie = cookies.find((c) => c.startsWith(`${name}=`));
  if (!cookie) {
    throw new Error(`Expected a ${name} cookie to be set`);
  }
  return cookie.split(';')[0];
}

function waitForEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => {
    socket.once(event, (payload: T) => resolve(payload));
  });
}

function connectSocket(baseUrl: string, accessTokenCookie: string): Socket {
  return io(baseUrl, {
    transports: ['websocket'],
    autoConnect: false,
    extraHeaders: { Cookie: accessTokenCookie },
  });
}

async function waitForConnect(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve());
    socket.on('connect_error', (err) => reject(err));
    socket.connect();
  });
}

// Waits for the client-side disconnect confirmation, then gives the server a
// brief grace period to finish processing handleDisconnect (presence count
// decrement) so the next test starts from a clean online-count baseline.
async function disconnectAndWait(socket: Socket): Promise<void> {
  if (!socket.disconnected) {
    await new Promise<void>((resolve) => {
      socket.once('disconnect', () => resolve());
      socket.disconnect();
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe('Chat (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let redisIoAdapter: RedisIoAdapter;
  let baseUrl: string;
  let channelId: string;

  async function loginAndGetCookie(username: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: 'devpassword123' })
      .expect(200);
    return extractCookie(res.headers['set-cookie'], 'access_token');
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );

    redisIoAdapter = new RedisIoAdapter(app);
    await redisIoAdapter.connectToRedis();
    app.useWebSocketAdapter(redisIoAdapter);

    await app.init();
    await app.listen(0);

    const address = (
      app.getHttpServer() as { address(): AddressInfo }
    ).address();
    baseUrl = `http://localhost:${address.port}`;

    prisma = new PrismaClient();

    // Log in once up front so the AD-group sync has created the "ti" channel
    // before we look it up.
    await loginAndGetCookie('jsilva');
    const channel = await prisma.channel.findUnique({
      where: { adGroupDn: 'cn=ti,ou=groups,dc=elyzian,dc=local' },
    });
    channelId = channel!.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
    await redisIoAdapter.disposeRedisClients();
  });

  it('sends a message over the socket, relays it to other members, and persists it to REST history', async () => {
    const [jsilvaCookie, adossantosCookie] = await Promise.all([
      loginAndGetCookie('jsilva'),
      loginAndGetCookie('adossantos'),
    ]);

    const socketA = connectSocket(baseUrl, jsilvaCookie);
    const socketB = connectSocket(baseUrl, adossantosCookie);

    try {
      await Promise.all([waitForConnect(socketA), waitForConnect(socketB)]);

      const messageNewPromise = waitForEvent<Message>(
        socketB,
        SocketEvent.MESSAGE_NEW,
      );

      const ack = await new Promise<{ message: Message } | { error: string }>(
        (resolve) => {
          socketA.emit(
            SocketEvent.MESSAGE_SEND,
            { channelId, content: 'hello from jsilva' },
            resolve,
          );
        },
      );

      expect(ack).toHaveProperty('message');
      const sent = (ack as { message: Message }).message;
      expect(sent.content).toBe('hello from jsilva');
      expect(sent.author.username).toBe('jsilva');

      const received = await messageNewPromise;
      expect(received.id).toBe(sent.id);
      expect(received.content).toBe('hello from jsilva');

      const historyRes = await request(app.getHttpServer())
        .get(`/channels/${channelId}/messages`)
        .set('Cookie', [jsilvaCookie])
        .expect(200);
      const history = messageHistoryResponseSchema.parse(historyRes.body);
      expect(history.messages.some((m) => m.id === sent.id)).toBe(true);
    } finally {
      await Promise.all([
        disconnectAndWait(socketA),
        disconnectAndWait(socketB),
      ]);
    }
  });

  it('relays typing:start and typing:stop to other members of the channel', async () => {
    const [jsilvaCookie, adossantosCookie] = await Promise.all([
      loginAndGetCookie('jsilva'),
      loginAndGetCookie('adossantos'),
    ]);

    const socketA = connectSocket(baseUrl, jsilvaCookie);
    const socketB = connectSocket(baseUrl, adossantosCookie);

    try {
      await Promise.all([waitForConnect(socketA), waitForConnect(socketB)]);

      const typingStartPromise = waitForEvent<TypingBroadcast>(
        socketB,
        SocketEvent.TYPING_START,
      );
      socketA.emit(SocketEvent.TYPING_START, { channelId });
      const startPayload = await typingStartPromise;
      expect(startPayload.channelId).toBe(channelId);
      expect(typeof startPayload.userId).toBe('string');

      const typingStopPromise = waitForEvent<TypingBroadcast>(
        socketB,
        SocketEvent.TYPING_STOP,
      );
      socketA.emit(SocketEvent.TYPING_STOP, { channelId });
      const stopPayload = await typingStopPromise;
      expect(stopPayload.channelId).toBe(channelId);
    } finally {
      await Promise.all([
        disconnectAndWait(socketA),
        disconnectAndWait(socketB),
      ]);
    }
  });

  it('syncs presence on connect and broadcasts an update on disconnect', async () => {
    const [jsilvaCookie, adossantosCookie] = await Promise.all([
      loginAndGetCookie('jsilva'),
      loginAndGetCookie('adossantos'),
    ]);

    const socketA = connectSocket(baseUrl, jsilvaCookie);
    await waitForConnect(socketA);
    const socketAId = await new Promise<string>((resolve) => {
      socketA.emit(
        SocketEvent.MESSAGE_SEND,
        { channelId, content: 'marker' },
        (ack: { message: Message }) => resolve(ack.message.authorId),
      );
    });

    const socketB = connectSocket(baseUrl, adossantosCookie);
    const presenceSyncPromise = waitForEvent<PresenceSyncPayload>(
      socketB,
      SocketEvent.PRESENCE_SYNC,
    );
    await waitForConnect(socketB);
    const syncPayload = await presenceSyncPromise;
    expect(syncPayload.onlineUserIds).toContain(socketAId);

    const presenceUpdatePromise = waitForEvent<PresenceUpdatePayload>(
      socketB,
      SocketEvent.PRESENCE_UPDATE,
    );
    socketA.disconnect();
    const updatePayload = await presenceUpdatePromise;
    expect(updatePayload).toEqual({ userId: socketAId, online: false });

    socketB.disconnect();
  });

  it('tracks unread counts per channel and clears them on channel:read', async () => {
    const [jsilvaCookie, adossantosCookie] = await Promise.all([
      loginAndGetCookie('jsilva'),
      loginAndGetCookie('adossantos'),
    ]);

    async function fetchChannel(cookie: string): Promise<ChannelSummary> {
      const res = await request(app.getHttpServer())
        .get('/channels')
        .set('Cookie', cookie)
        .expect(200);
      const channels = z.array(channelSummarySchema).parse(res.body);
      return channels.find((c) => c.id === channelId)!;
    }

    const socketA = connectSocket(baseUrl, jsilvaCookie);
    const socketB = connectSocket(baseUrl, adossantosCookie);

    try {
      await Promise.all([waitForConnect(socketA), waitForConnect(socketB)]);

      // Baseline: adossantos may already be caught up from earlier tests in
      // this suite sharing the same seeded channel, so read the count before
      // sending rather than assuming 0.
      const before = await fetchChannel(adossantosCookie);

      const messageNewPromise = waitForEvent<Message>(
        socketB,
        SocketEvent.MESSAGE_NEW,
      );
      const ack = await new Promise<{ message: Message } | { error: string }>(
        (resolve) => {
          socketA.emit(
            SocketEvent.MESSAGE_SEND,
            { channelId, content: 'unread-tracking probe' },
            resolve,
          );
        },
      );
      expect(ack).toHaveProperty('message');
      const sent = (ack as { message: Message }).message;
      await messageNewPromise;

      const afterSend = await fetchChannel(adossantosCookie);
      expect(afterSend.unreadCount).toBe(before.unreadCount + 1);

      // The sender's own unread count must not include the message they
      // just sent themselves.
      const senderChannel = await fetchChannel(jsilvaCookie);
      expect(senderChannel.unreadCount).toBe(0);

      const readAck = await new Promise<{ ok: true } | { error: string }>(
        (resolve) => {
          socketB.emit(
            SocketEvent.CHANNEL_READ,
            { channelId, messageId: sent.id },
            resolve,
          );
        },
      );
      expect(readAck).toEqual({ ok: true });

      const afterRead = await fetchChannel(adossantosCookie);
      expect(afterRead.unreadCount).toBe(0);
    } finally {
      await Promise.all([
        disconnectAndWait(socketA),
        disconnectAndWait(socketB),
      ]);
    }
  });

  it('rejects a socket connection without a valid access token cookie', async () => {
    const socket = io(baseUrl, {
      transports: ['websocket'],
      autoConnect: false,
      extraHeaders: { Cookie: 'access_token=not-a-real-token' },
    });

    await expect(
      new Promise<void>((resolve, reject) => {
        socket.on('connect', () => reject(new Error('should not connect')));
        socket.on('connect_error', () => resolve());
        socket.connect();
      }),
    ).resolves.toBeUndefined();

    socket.disconnect();
  });
});
