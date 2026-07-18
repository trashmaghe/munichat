process.env.LINK_PREVIEW_ALLOW_PRIVATE_HOSTS = 'true';

import http from 'node:http';
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
  messageHistoryResponseSchema,
  presignUploadResponseSchema,
  SocketEvent,
} from '@elyzian/shared';
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

describe('Rich content (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let redisIoAdapter: RedisIoAdapter;
  let baseUrl: string;
  let channelId: string;
  let ogFixtureServer: http.Server;
  let ogFixtureUrl: string;

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
    const channel = await prisma.channel.findUnique({
      where: { adGroupDn: 'cn=ti,ou=groups,dc=elyzian,dc=local' },
    });
    channelId = channel!.id;

    ogFixtureServer = http.createServer((req, res) => {
      if (req.url === '/ok') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(
          '<html><head><meta property="og:title" content="Fixture Page" />' +
            '<meta property="og:description" content="A fixture description" />' +
            '</head></html>',
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) =>
      ogFixtureServer.listen(0, '127.0.0.1', resolve),
    );
    const ogAddress = ogFixtureServer.address() as AddressInfo;
    ogFixtureUrl = `http://127.0.0.1:${ogAddress.port}`;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
    await redisIoAdapter.disposeRedisClients();
    await new Promise<void>((resolve) =>
      ogFixtureServer.close(() => resolve()),
    );
  });

  describe('message edit/delete/reply', () => {
    it('edits a message and broadcasts the update to every open session, including the editor', async () => {
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
          content: 'original text',
        });
        const messageId = (sendAck as { message: Message }).message.id;

        const updatedOnB = waitForEvent<Message>(
          socketB,
          SocketEvent.MESSAGE_UPDATED,
        );
        const updatedOnA = waitForEvent<Message>(
          socketA,
          SocketEvent.MESSAGE_UPDATED,
        );

        const editAck = await emitAck(socketA, SocketEvent.MESSAGE_EDIT, {
          messageId,
          content: 'edited text',
        });
        expect(editAck).toHaveProperty('message.content', 'edited text');

        const [receivedByB, receivedByA] = await Promise.all([
          updatedOnB,
          updatedOnA,
        ]);
        expect(receivedByB.content).toBe('edited text');
        expect(receivedByA.content).toBe('edited text');
        expect(receivedByB.editedAt).not.toBeNull();

        const historyRes = await request(app.getHttpServer())
          .get(`/channels/${channelId}/messages`)
          .set('Cookie', [jsilvaCookie])
          .expect(200);
        const history = messageHistoryResponseSchema.parse(historyRes.body);
        expect(history.messages.find((m) => m.id === messageId)?.content).toBe(
          'edited text',
        );
      } finally {
        await Promise.all([
          disconnectAndWait(socketA),
          disconnectAndWait(socketB),
        ]);
      }
    });

    it('rejects an edit from a non-author with an error ack', async () => {
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
          content: 'jsilva message',
        });
        const messageId = (sendAck as { message: Message }).message.id;

        const editAck = await emitAck(socketB, SocketEvent.MESSAGE_EDIT, {
          messageId,
          content: 'hijacked',
        });
        expect(editAck).toEqual({
          error: 'You can only edit your own messages',
        });
      } finally {
        await Promise.all([
          disconnectAndWait(socketA),
          disconnectAndWait(socketB),
        ]);
      }
    });

    it('soft-deletes a message: content is cleared and REST history no longer exposes it', async () => {
      const jsilvaCookie = await loginAndGetCookie('jsilva');
      const socketA = connectSocket(baseUrl, jsilvaCookie);

      try {
        await waitForConnect(socketA);

        const sendAck = await emitAck(socketA, SocketEvent.MESSAGE_SEND, {
          channelId,
          content: 'to be deleted',
        });
        const messageId = (sendAck as { message: Message }).message.id;

        const deleteAck = await emitAck(socketA, SocketEvent.MESSAGE_DELETE, {
          messageId,
        });
        expect(deleteAck).toHaveProperty('message.deletedAt');
        expect((deleteAck as { message: Message }).message.content).toBe('');

        const historyRes = await request(app.getHttpServer())
          .get(`/channels/${channelId}/messages`)
          .set('Cookie', [jsilvaCookie])
          .expect(200);
        const history = messageHistoryResponseSchema.parse(historyRes.body);
        const deleted = history.messages.find((m) => m.id === messageId);
        expect(deleted?.content).toBe('');
        expect(deleted?.deletedAt).not.toBeNull();
      } finally {
        await disconnectAndWait(socketA);
      }
    });

    it('sends a reply carrying a preview of the original message', async () => {
      const jsilvaCookie = await loginAndGetCookie('jsilva');
      const socketA = connectSocket(baseUrl, jsilvaCookie);

      try {
        await waitForConnect(socketA);

        const originalAck = await emitAck(socketA, SocketEvent.MESSAGE_SEND, {
          channelId,
          content: 'original message to reply to',
        });
        const originalId = (originalAck as { message: Message }).message.id;

        const replyAck = await emitAck(socketA, SocketEvent.MESSAGE_SEND, {
          channelId,
          content: 'this is a reply',
          replyToId: originalId,
        });
        const reply = (replyAck as { message: Message }).message;

        expect(reply.replyToId).toBe(originalId);
        expect(reply.replyTo?.id).toBe(originalId);
        expect(reply.replyTo?.contentPreview).toContain(
          'original message to reply to',
        );
      } finally {
        await disconnectAndWait(socketA);
      }
    });
  });

  describe('attachments', () => {
    it('uploads a file via presigned URL, sends it as a message attachment, and downloads it back', async () => {
      const jsilvaCookie = await loginAndGetCookie('jsilva');
      const socketA = connectSocket(baseUrl, jsilvaCookie);

      try {
        await waitForConnect(socketA);

        const fileContent = 'plain text attachment contents';
        const presignRes = await request(app.getHttpServer())
          .post('/files/presign')
          .set('Cookie', [jsilvaCookie])
          .send({
            channelId,
            fileName: 'notes.txt',
            mimeType: 'text/plain',
            sizeBytes: Buffer.byteLength(fileContent),
          })
          .expect(201);
        const presigned = presignUploadResponseSchema.parse(presignRes.body);

        const putRes = await fetch(presigned.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'text/plain' },
          body: fileContent,
        });
        expect(putRes.ok).toBe(true);

        const sendAck = await emitAck(socketA, SocketEvent.MESSAGE_SEND, {
          channelId,
          content: '',
          attachments: [
            {
              objectKey: presigned.objectKey,
              fileName: 'notes.txt',
              mimeType: 'text/plain',
              sizeBytes: Buffer.byteLength(fileContent),
            },
          ],
        });
        expect(sendAck).toHaveProperty('message.attachments');
        const sent = (sendAck as { message: Message }).message;
        expect(sent.attachments).toHaveLength(1);
        expect(sent.type).toBe('FILE');

        const attachmentId = sent.attachments[0].id;
        const downloadRes = await request(app.getHttpServer())
          .get(`/files/${attachmentId}`)
          .set('Cookie', [jsilvaCookie])
          .expect(200);
        expect(downloadRes.text).toBe(fileContent);
      } finally {
        await disconnectAndWait(socketA);
      }
    });

    it('returns 403 for a download attempt by a non-member of the channel', async () => {
      // mferreira is only ever a member of the "financas" channel, never "ti".
      const [jsilvaCookie, mferreiraCookie] = await Promise.all([
        loginAndGetCookie('jsilva'),
        loginAndGetCookie('mferreira'),
      ]);
      const socketA = connectSocket(baseUrl, jsilvaCookie);

      try {
        await waitForConnect(socketA);

        const fileContent = 'private contents';
        const presignRes = await request(app.getHttpServer())
          .post('/files/presign')
          .set('Cookie', [jsilvaCookie])
          .send({
            channelId,
            fileName: 'private.txt',
            mimeType: 'text/plain',
            sizeBytes: Buffer.byteLength(fileContent),
          })
          .expect(201);
        const presigned = presignUploadResponseSchema.parse(presignRes.body);
        await fetch(presigned.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'text/plain' },
          body: fileContent,
        });

        const sendAck = await emitAck(socketA, SocketEvent.MESSAGE_SEND, {
          channelId,
          content: '',
          attachments: [
            {
              objectKey: presigned.objectKey,
              fileName: 'private.txt',
              mimeType: 'text/plain',
              sizeBytes: Buffer.byteLength(fileContent),
            },
          ],
        });
        const attachmentId = (sendAck as { message: Message }).message
          .attachments[0].id;

        await request(app.getHttpServer())
          .get(`/files/${attachmentId}`)
          .set('Cookie', [mferreiraCookie])
          .expect(403);
      } finally {
        await disconnectAndWait(socketA);
      }
    });
  });

  describe('link previews', () => {
    it('fetches OG tags for a URL in a message and broadcasts the enriched message once ready', async () => {
      const jsilvaCookie = await loginAndGetCookie('jsilva');
      const socketA = connectSocket(baseUrl, jsilvaCookie);

      try {
        await waitForConnect(socketA);

        const url = `${ogFixtureUrl}/ok`;
        const updatedPromise = waitForEvent<Message>(
          socketA,
          SocketEvent.MESSAGE_UPDATED,
        );

        const sendAck = await emitAck(socketA, SocketEvent.MESSAGE_SEND, {
          channelId,
          content: `check this out ${url}`,
        });
        expect(sendAck).toHaveProperty('message.linkPreview', null);

        const updated = await updatedPromise;
        expect(updated.linkPreview?.status).toBe('READY');
        expect(updated.linkPreview?.title).toBe('Fixture Page');
        expect(updated.linkPreview?.description).toBe('A fixture description');
      } finally {
        await disconnectAndWait(socketA);
      }
    });

    it('marks the preview FAILED when the URL 404s', async () => {
      const jsilvaCookie = await loginAndGetCookie('jsilva');
      const socketA = connectSocket(baseUrl, jsilvaCookie);

      try {
        await waitForConnect(socketA);

        const url = `${ogFixtureUrl}/missing`;
        const updatedPromise = waitForEvent<Message>(
          socketA,
          SocketEvent.MESSAGE_UPDATED,
        );

        await emitAck(socketA, SocketEvent.MESSAGE_SEND, {
          channelId,
          content: `broken link ${url}`,
        });

        const updated = await updatedPromise;
        expect(updated.linkPreview?.status).toBe('FAILED');
      } finally {
        await disconnectAndWait(socketA);
      }
    });
  });
});
