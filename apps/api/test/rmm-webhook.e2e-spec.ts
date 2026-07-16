import http from 'node:http';
import type { AddressInfo } from 'node:net';

// RmmWebhookController reads RMM_WEBHOOK_SECRET live via ConfigService, but
// this must still be set before AppModule compiles for consistency with the
// other e2e specs (see rich-content.e2e-spec.ts / glpi.e2e-spec.ts).
const RMM_WEBHOOK_SECRET = 'e2e-rmm-webhook-secret';
process.env.RMM_WEBHOOK_SECRET = RMM_WEBHOOK_SECRET;

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

function waitForEvent(
  socket: Socket,
  event: SocketEvent,
  predicate: (payload: Message) => boolean,
): Promise<Message> {
  return new Promise((resolve) => {
    const handler = (payload: Message) => {
      if (predicate(payload)) {
        socket.off(event, handler);
        resolve(payload);
      }
    };
    socket.on(event, handler);
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

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => resolve(raw ? JSON.parse(raw) : {}));
  });
}

describe('Tactical RMM alert webhook (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let redisIoAdapter: RedisIoAdapter;
  let baseUrl: string;
  let glpiFixtureServer: http.Server;
  let glpiFixtureUrl: string;
  let nextGlpiTicketId: number;

  async function loginAndGetCookie(username: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: 'devpassword123' })
      .expect(200);
    return extractCookie(res.headers['set-cookie'], 'access_token');
  }

  function postAlert(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/webhooks/rmm/alerts')
      .set('Authorization', `Bearer ${RMM_WEBHOOK_SECRET}`)
      .send(body);
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
          res.writeHead(201, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id }));
        });
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
    // Sanity check: the "ti" department channel (target of RMM_ALERT_CHANNEL_NAME)
    // must exist before any test posts a webhook against it.
    await prisma.channel.findUniqueOrThrow({
      where: { adGroupDn: 'cn=ti,ou=groups,dc=munichat,dc=local' },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
    await redisIoAdapter.disposeRedisClients();
    await new Promise<void>((resolve) =>
      glpiFixtureServer.close(() => resolve()),
    );
  });

  it('rejects a request with no bearer token when a secret is configured', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/rmm/alerts')
      .send({
        alertId: 'no-auth',
        hostname: 'PC-1',
        client: 'Prefeitura',
        site: 'Sede',
        severity: 'warning',
        message: 'test',
        resolved: false,
      })
      .expect(401);
  });

  it('rejects a request with the wrong bearer token', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/rmm/alerts')
      .set('Authorization', 'Bearer wrong-secret')
      .send({
        alertId: 'wrong-auth',
        hostname: 'PC-1',
        client: 'Prefeitura',
        site: 'Sede',
        severity: 'warning',
        message: 'test',
        resolved: false,
      })
      .expect(401);
  });

  it('rejects a malformed payload with 400', async () => {
    await postAlert({ hostname: 'PC-1' }).expect(400);
  });

  it('posts a SYSTEM message for a new warning alert and resolves it live over the socket', async () => {
    const jsilvaCookie = await loginAndGetCookie('jsilva');
    const socket = connectSocket(baseUrl, jsilvaCookie);

    try {
      await waitForConnect(socket);

      const newPromise = waitForEvent(socket, SocketEvent.MESSAGE_NEW, (m) =>
        m.content.includes('DISK-01'),
      );

      await postAlert({
        alertId: 'alert-warning-1',
        hostname: 'DISK-01',
        client: 'Prefeitura de Nova Serrana',
        site: 'Sede',
        severity: 'warning',
        message: 'disk usage above 90%',
        resolved: false,
      }).expect(200);

      const created = await newPromise;
      expect(created.type).toBe('SYSTEM');
      expect(created.author.displayName).toBe('Tactical RMM');
      expect(created.content).toContain('disk usage above 90%');

      const updatedPromise = waitForEvent(
        socket,
        SocketEvent.MESSAGE_UPDATED,
        (m) => m.id === created.id,
      );

      await postAlert({
        alertId: 'alert-warning-1',
        hostname: 'DISK-01',
        client: 'Prefeitura de Nova Serrana',
        site: 'Sede',
        severity: 'warning',
        message: 'disk usage above 90%',
        resolved: true,
      }).expect(200);

      const updated = await updatedPromise;
      expect(updated.id).toBe(created.id);

      const ref = await prisma.rmmAlertRef.findUnique({
        where: { rmmAlertId: 'alert-warning-1' },
      });
      expect(ref?.resolved).toBe(true);
    } finally {
      await disconnectAndWait(socket);
    }
  });

  it('auto-opens a GLPI ticket for an error-severity alert', async () => {
    const jsilvaCookie = await loginAndGetCookie('jsilva');
    const socket = connectSocket(baseUrl, jsilvaCookie);

    try {
      await waitForConnect(socket);

      const newPromise = waitForEvent(socket, SocketEvent.MESSAGE_NEW, (m) =>
        m.content.includes('SRV-DB-01'),
      );

      await postAlert({
        alertId: 'alert-error-1',
        hostname: 'SRV-DB-01',
        client: 'Prefeitura de Nova Serrana',
        site: 'Sede',
        severity: 'error',
        message: 'agent has not checked in for 30 minutes',
        resolved: false,
      }).expect(200);

      const created = await newPromise;
      expect(created.type).toBe('TICKET');
      expect(created.ticketRef).not.toBeNull();
      expect(created.ticketRef?.url).toContain(glpiFixtureUrl);
    } finally {
      await disconnectAndWait(socket);
    }
  });

  it('ignores a duplicate delivery of an already-tracked unresolved alert', async () => {
    await postAlert({
      alertId: 'alert-dup-1',
      hostname: 'PC-DUP',
      client: 'Prefeitura',
      site: 'Sede',
      severity: 'info',
      message: 'first delivery',
      resolved: false,
    }).expect(200);

    await postAlert({
      alertId: 'alert-dup-1',
      hostname: 'PC-DUP',
      client: 'Prefeitura',
      site: 'Sede',
      severity: 'info',
      message: 'retried delivery',
      resolved: false,
    }).expect(200);

    const refs = await prisma.rmmAlertRef.findMany({
      where: { rmmAlertId: 'alert-dup-1' },
    });
    expect(refs).toHaveLength(1);
  });
});
