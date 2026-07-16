import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
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

describe('RMM agents + remote control (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let redisIoAdapter: RedisIoAdapter;
  let rmmFixtureServer: http.Server;
  let channelId: string;

  async function loginAndGetCookie(username: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: 'devpassword123' })
      .expect(200);
    return extractCookie(res.headers['set-cookie'], 'access_token');
  }

  beforeAll(async () => {
    rmmFixtureServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? '', 'http://localhost');

      if (url.pathname === '/agents/' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify([
            {
              agent_id: 'a1',
              hostname: 'PC-12',
              site_name: 'Sede',
              client_name: 'Prefeitura',
              plat: 'windows',
              status: 'online',
            },
          ]),
        );
        return;
      }

      const meshMatch = /^\/agents\/([^/]+)\/meshcentral\/$/.exec(
        url.pathname,
      );
      if (meshMatch && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            control: `https://mesh.example.org/control?agent=${meshMatch[1]}`,
            terminal: `https://mesh.example.org/terminal?agent=${meshMatch[1]}`,
            file: `https://mesh.example.org/files?agent=${meshMatch[1]}`,
          }),
        );
        return;
      }

      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) =>
      rmmFixtureServer.listen(0, '127.0.0.1', resolve),
    );
    const rmmAddress = rmmFixtureServer.address() as AddressInfo;
    process.env.RMM_URL = `http://127.0.0.1:${rmmAddress.port}`;
    process.env.RMM_API_KEY = 'e2e-rmm-api-key';

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

    prisma = new PrismaClient();

    // jsilva and adossantos are both members of "ti" via AD sync (see
    // docker/ldap/bootstrap.ldif); mferreira is only in "financas". There is
    // no promotion endpoint yet (see apps/api/src/rmm/README.md), so this
    // test promotes jsilva to channel ADMIN directly, the same way a real
    // deployment would need to bootstrap its first RMM operator today.
    await loginAndGetCookie('jsilva');
    const channel = await prisma.channel.findUniqueOrThrow({
      where: { adGroupDn: 'cn=ti,ou=groups,dc=munichat,dc=local' },
    });
    channelId = channel.id;
    const jsilva = await prisma.user.findUniqueOrThrow({
      where: { username: 'jsilva' },
    });
    await prisma.channelMember.update({
      where: { userId_channelId: { userId: jsilva.id, channelId } },
      data: { role: 'ADMIN' },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
    await redisIoAdapter.disposeRedisClients();
    await new Promise<void>((resolve) =>
      rmmFixtureServer.close(() => resolve()),
    );
  });

  describe('GET /rmm/agents', () => {
    it('returns the device list for a plain member of the alert channel', async () => {
      const adossantosCookie = await loginAndGetCookie('adossantos');

      const res = await request(app.getHttpServer())
        .get('/rmm/agents')
        .set('Cookie', adossantosCookie)
        .expect(200);

      expect(res.body).toEqual([
        {
          agentId: 'a1',
          hostname: 'PC-12',
          siteName: 'Sede',
          clientName: 'Prefeitura',
          platform: 'windows',
          status: 'online',
        },
      ]);
    });

    it('rejects a user who is not a member of the alert channel', async () => {
      const mferreiraCookie = await loginAndGetCookie('mferreira');

      await request(app.getHttpServer())
        .get('/rmm/agents')
        .set('Cookie', mferreiraCookie)
        .expect(403);
    });
  });

  describe('GET /rmm/agents/:agentId/remote-control', () => {
    it('returns MeshCentral control URLs and writes an audit log entry for a channel admin', async () => {
      const jsilvaCookie = await loginAndGetCookie('jsilva');

      const res = await request(app.getHttpServer())
        .get('/rmm/agents/a1/remote-control')
        .set('Cookie', jsilvaCookie)
        .expect(200);

      expect(res.body).toEqual({
        desktopUrl: 'https://mesh.example.org/control?agent=a1',
        terminalUrl: 'https://mesh.example.org/terminal?agent=a1',
        fileUrl: 'https://mesh.example.org/files?agent=a1',
      });

      const auditRows = await prisma.auditLog.findMany({
        where: { action: 'rmm.remote_control.requested' },
      });
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].metadata).toEqual({ agentId: 'a1' });
    });

    it('rejects a plain member of the alert channel (not an admin)', async () => {
      const adossantosCookie = await loginAndGetCookie('adossantos');

      await request(app.getHttpServer())
        .get('/rmm/agents/a1/remote-control')
        .set('Cookie', adossantosCookie)
        .expect(403);
    });

    it('rejects a user who is not a member of the alert channel at all', async () => {
      const mferreiraCookie = await loginAndGetCookie('mferreira');

      await request(app.getHttpServer())
        .get('/rmm/agents/a1/remote-control')
        .set('Cookie', mferreiraCookie)
        .expect(403);
    });
  });
});
