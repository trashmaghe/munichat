import type { AddressInfo } from 'node:net';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import { io, Socket } from 'socket.io-client';
import {
  Message,
  messageSearchResponseSchema,
  SocketEvent,
} from '@elyzian/shared';
import { AppModule } from './../src/app.module';
import { RedisIoAdapter } from '../src/chat/redis-io.adapter';

const FINANCAS_GROUP_DN = 'cn=financas,ou=groups,dc=elyzian,dc=local';

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

async function disconnectAndWait(socket: Socket): Promise<void> {
  if (!socket.disconnected) {
    await new Promise<void>((resolve) => {
      socket.once('disconnect', () => resolve());
      socket.disconnect();
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
}

type SendAck = { message: Message } | { error: string };

function emitAck(
  socket: Socket,
  event: string,
  payload: unknown,
): Promise<SendAck> {
  return new Promise((resolve) => {
    socket.emit(event, payload, resolve);
  });
}

describe('Message search (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let redisIoAdapter: RedisIoAdapter;
  let baseUrl: string;
  let tiChannelId: string;
  let financasChannelId: string;

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

    await loginAndGetCookie('jsilva');
    await loginAndGetCookie('mferreira');

    const tiChannel = await prisma.channel.findUnique({
      where: { adGroupDn: 'cn=ti,ou=groups,dc=elyzian,dc=local' },
    });
    tiChannelId = tiChannel!.id;

    const financasChannel = await prisma.channel.findUnique({
      where: { adGroupDn: FINANCAS_GROUP_DN },
    });
    financasChannelId = financasChannel!.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
    await redisIoAdapter.disposeRedisClients();
  });

  it('finds a message by content within a channel the user is a member of', async () => {
    const jsilvaCookie = await loginAndGetCookie('jsilva');
    const socket = connectSocket(baseUrl, jsilvaCookie);

    try {
      await waitForConnect(socket);
      await emitAck(socket, SocketEvent.MESSAGE_SEND, {
        channelId: tiChannelId,
        content: 'O leitor de crachá da recepção parou de responder',
      });

      const res = await request(app.getHttpServer())
        .get('/messages/search')
        .query({ q: 'crachá' })
        .set('Cookie', [jsilvaCookie])
        .expect(200);

      const body = messageSearchResponseSchema.parse(res.body);
      expect(body.messages.some((m) => m.content.includes('crachá'))).toBe(
        true,
      );
    } finally {
      await disconnectAndWait(socket);
    }
  });

  it('returns 403 when searching a specific channel the user is not a member of', async () => {
    const mferreiraCookie = await loginAndGetCookie('mferreira');

    // mferreira is only ever a member of "financas", never "ti".
    await request(app.getHttpServer())
      .get('/messages/search')
      .query({ q: 'crachá', channelId: tiChannelId })
      .set('Cookie', [mferreiraCookie])
      .expect(403);
  });

  it('never returns matches from channels the user is not a member of, even without a channelId filter', async () => {
    const mferreiraCookie = await loginAndGetCookie('mferreira');

    const res = await request(app.getHttpServer())
      .get('/messages/search')
      .query({ q: 'crachá' })
      .set('Cookie', [mferreiraCookie])
      .expect(200);

    const body = messageSearchResponseSchema.parse(res.body);
    expect(body.messages.every((m) => m.channelId === financasChannelId)).toBe(
      true,
    );
    expect(body.messages.some((m) => m.channelId === tiChannelId)).toBe(false);
  });

  it('excludes a soft-deleted message from results', async () => {
    const jsilvaCookie = await loginAndGetCookie('jsilva');
    const socket = connectSocket(baseUrl, jsilvaCookie);

    try {
      await waitForConnect(socket);
      const sendAck = await emitAck(socket, SocketEvent.MESSAGE_SEND, {
        channelId: tiChannelId,
        content: 'termo-exclusivo-para-apagar',
      });
      const messageId = (sendAck as { message: Message }).message.id;

      await emitAck(socket, SocketEvent.MESSAGE_DELETE, { messageId });

      const res = await request(app.getHttpServer())
        .get('/messages/search')
        .query({ q: 'termo-exclusivo-para-apagar' })
        .set('Cookie', [jsilvaCookie])
        .expect(200);

      const body = messageSearchResponseSchema.parse(res.body);
      expect(body.messages.some((m) => m.id === messageId)).toBe(false);
    } finally {
      await disconnectAndWait(socket);
    }
  });
});
