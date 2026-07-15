import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHmac } from 'node:crypto';

// The fixture GLPI server's port is only known once it's listening, and
// GlpiService reads GLPI_URL live via ConfigService (no caching) — but we
// still set this before AppModule compiles, mirroring the
// LINK_PREVIEW_ALLOW_PRIVATE_HOSTS override in rich-content.e2e-spec.ts,
// so there's no ambiguity about ordering.
const GLPI_WEBHOOK_SECRET = 'e2e-glpi-webhook-secret';
process.env.GLPI_WEBHOOK_SECRET = GLPI_WEBHOOK_SECRET;

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import { io, Socket } from 'socket.io-client';
import { Message, SocketEvent } from '@munichat/shared';
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

// Wait for the message:updated event for a specific message id, ignoring any
// updates for other messages. Even with --runInBand this makes the assertion
// robust against stray broadcasts (e.g. other channel activity).
function waitForMessageUpdate(
  socket: Socket,
  messageId: string,
): Promise<Message> {
  return new Promise((resolve) => {
    const handler = (payload: Message) => {
      if (payload.id === messageId) {
        socket.off(SocketEvent.MESSAGE_UPDATED, handler);
        resolve(payload);
      }
    };
    socket.on(SocketEvent.MESSAGE_UPDATED, handler);
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

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => resolve(raw ? JSON.parse(raw) : {}));
  });
}

describe('GLPI ticketing (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let redisIoAdapter: RedisIoAdapter;
  let baseUrl: string;
  let channelId: string;
  let glpiFixtureServer: http.Server;
  let glpiFixtureUrl: string;
  let nextGlpiTicketId: number;
  const ticketStatusByGlpiId = new Map<number, number>();

  async function loginAndGetCookie(username: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: 'devpassword123' })
      .expect(200);
    return extractCookie(res.headers['set-cookie'], 'access_token');
  }

  beforeAll(async () => {
    nextGlpiTicketId = 1;

    glpiFixtureServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? '', 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/apirest.php/initSession') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ session_token: 'fixture-session-token' }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/apirest.php/Ticket/') {
        void readJsonBody(req).then(() => {
          const id = nextGlpiTicketId++;
          ticketStatusByGlpiId.set(id, 1);
          res.writeHead(201, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id }));
        });
        return;
      }

      const ticketMatch = /^\/apirest\.php\/Ticket\/(\d+)$/.exec(url.pathname);
      if (req.method === 'GET' && ticketMatch) {
        const id = Number(ticketMatch[1]);
        const status = ticketStatusByGlpiId.get(id);
        if (status === undefined) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status }));
        return;
      }

      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) =>
      glpiFixtureServer.listen(0, '127.0.0.1', resolve),
    );
    const glpiAddress = glpiFixtureServer.address() as AddressInfo;
    glpiFixtureUrl = `http://127.0.0.1:${glpiAddress.port}`;
    process.env.GLPI_URL = glpiFixtureUrl;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
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
    const channel = await prisma.channel.findUnique({
      where: { adGroupDn: 'cn=ti,ou=groups,dc=munichat,dc=local' },
    });
    channelId = channel!.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
    await redisIoAdapter.disposeRedisClients();
    await new Promise<void>((resolve) =>
      glpiFixtureServer.close(() => resolve()),
    );
  });

  function signWebhookBody(body: Record<string, unknown>): string {
    const hmac = createHmac('sha256', GLPI_WEBHOOK_SECRET)
      .update(JSON.stringify(body))
      .digest('hex');
    return `sha256=${hmac}`;
  }

  it('creates a GLPI ticket from a /ticket message and returns a populated ticketRef', async () => {
    const jsilvaCookie = await loginAndGetCookie('jsilva');
    const socketA = connectSocket(baseUrl, jsilvaCookie);

    try {
      await waitForConnect(socketA);

      const sendAck = await emitAck(socketA, SocketEvent.MESSAGE_SEND, {
        channelId,
        content: '/ticket printer on 3rd floor is jammed',
      });

      expect(sendAck).toHaveProperty('message.type', 'TICKET');
      const sent = (sendAck as { message: Message }).message;
      expect(sent.ticketRef).not.toBeNull();
      expect(sent.ticketRef?.status).toBe('New');
      expect(sent.ticketRef?.url).toContain(glpiFixtureUrl);
      expect(sent.content).toBe('printer on 3rd floor is jammed');
    } finally {
      await disconnectAndWait(socketA);
    }
  });

  it('rejects a bare /ticket with no description via an error ack', async () => {
    const jsilvaCookie = await loginAndGetCookie('jsilva');
    const socketA = connectSocket(baseUrl, jsilvaCookie);

    try {
      await waitForConnect(socketA);

      const sendAck = await emitAck(socketA, SocketEvent.MESSAGE_SEND, {
        channelId,
        content: '/ticket',
      });

      expect(sendAck).toEqual({ error: 'Ticket description cannot be empty' });
    } finally {
      await disconnectAndWait(socketA);
    }
  });

  it('delivers a signed webhook status update to a live socket via message:updated', async () => {
    const [jsilvaCookie, adossantosCookie] = await Promise.all([
      loginAndGetCookie('jsilva'),
      loginAndGetCookie('adossantos'),
    ]);
    const socketA = connectSocket(baseUrl, jsilvaCookie);
    const socketB = connectSocket(baseUrl, adossantosCookie);

    try {
      await Promise.all([waitForConnect(socketA), waitForConnect(socketB)]);

      const sendAck = await emitAck(socketA, SocketEvent.MESSAGE_SEND, {
        channelId,
        content: '/ticket broken elevator on the 2nd floor',
      });
      const sent = (sendAck as { message: Message }).message;
      const glpiTicketId = sent.ticketRef!.glpiTicketId;

      // Simulate the ticket being closed on the GLPI side; the webhook must
      // re-fetch this via GlpiService rather than trust the payload's status.
      ticketStatusByGlpiId.set(glpiTicketId, 6);

      const updatedPromise = waitForMessageUpdate(socketB, sent.id);

      const webhookBody = { id: glpiTicketId };
      await request(app.getHttpServer())
        .post('/webhooks/glpi/tickets')
        .set('x-glpi-signature', signWebhookBody(webhookBody))
        .send(webhookBody)
        .expect(200);

      const updated = await updatedPromise;
      expect(updated.id).toBe(sent.id);
      expect(updated.ticketRef?.status).toBe('Closed');
    } finally {
      await Promise.all([
        disconnectAndWait(socketA),
        disconnectAndWait(socketB),
      ]);
    }
  });

  it('rejects an unsigned webhook with 401 when a secret is configured', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/glpi/tickets')
      .send({ id: 1 })
      .expect(401);
  });
});
