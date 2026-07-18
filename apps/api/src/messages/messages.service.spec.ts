import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { MessagesService } from './messages.service';
import { PrismaService } from '../prisma/prisma.service';
import { FilesService } from '../files/files.service';
import { GlpiService, GlpiUnavailableError } from '../glpi/glpi.service';
import { QUEUE_NAMES } from '../queue/queue-names';
import { decodeCursor, encodeCursor } from './message-response.mapper';

const MESSAGE_INCLUDE = {
  author: true,
  attachments: true,
  linkPreview: true,
  ticketRef: true,
  replyTo: { include: { author: true, attachments: true } },
};

describe('MessagesService', () => {
  let service: MessagesService;
  let prisma: {
    message: {
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
    };
    user: {
      findUniqueOrThrow: jest.Mock;
    };
    $queryRaw: jest.Mock;
  };
  let filesService: { getRealObjectSize: jest.Mock };
  let glpiService: { createTicket: jest.Mock };
  let queue: { add: jest.Mock };

  const author = {
    id: 'user-1',
    adObjectGuid: 'uuid-1',
    username: 'jsilva',
    displayName: 'Joao Silva',
    email: null,
    department: 'TI',
    avatarUrl: null,
    isActive: true,
    tokenVersion: 0,
    lastLoginAt: null,
    lastSeenAt: null,
    createdAt: new Date('2026-07-10T00:00:00.000Z'),
  };

  function buildMessage(
    id: string,
    createdAt: string,
    overrides: Partial<Record<string, unknown>> = {},
  ) {
    return {
      id,
      channelId: 'channel-1',
      authorId: 'user-1',
      content: `message ${id}`,
      type: 'TEXT',
      replyToId: null,
      editedAt: null,
      deletedAt: null,
      createdAt: new Date(createdAt),
      author,
      attachments: [],
      linkPreview: null,
      replyTo: null,
      ...overrides,
    };
  }

  beforeEach(async () => {
    prisma = {
      message: {
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
      },
      user: {
        findUniqueOrThrow: jest.fn(),
      },
      $queryRaw: jest.fn(),
    };
    filesService = { getRealObjectSize: jest.fn() };
    glpiService = { createTicket: jest.fn() };
    queue = { add: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: PrismaService, useValue: prisma },
        { provide: FilesService, useValue: filesService },
        { provide: GlpiService, useValue: glpiService },
        { provide: getQueueToken(QUEUE_NAMES.LINK_PREVIEW), useValue: queue },
      ],
    }).compile();

    service = module.get(MessagesService);
  });

  describe('getHistory', () => {
    it('queries the first page with no cursor and no next page when under the limit', async () => {
      const rows = [
        buildMessage('m3', '2026-07-10T00:00:03.000Z'),
        buildMessage('m2', '2026-07-10T00:00:02.000Z'),
      ];
      prisma.message.findMany.mockResolvedValue(rows);

      const result = await service.getHistory('channel-1', { limit: 2 });

      expect(prisma.message.findMany).toHaveBeenCalledWith({
        where: { channelId: 'channel-1' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 3,
        include: MESSAGE_INCLUDE,
      });
      expect(result.nextCursor).toBeNull();
      expect(result.messages.map((m) => m.id)).toEqual(['m2', 'm3']);
    });

    it('sets nextCursor and drops the extra row when limit+1 rows come back', async () => {
      const rows = [
        buildMessage('m3', '2026-07-10T00:00:03.000Z'),
        buildMessage('m2', '2026-07-10T00:00:02.000Z'),
        buildMessage('m1', '2026-07-10T00:00:01.000Z'),
      ];
      prisma.message.findMany.mockResolvedValue(rows);

      const result = await service.getHistory('channel-1', { limit: 2 });

      expect(result.messages.map((m) => m.id)).toEqual(['m2', 'm3']);
      expect(result.nextCursor).toBe(
        encodeCursor({
          createdAt: new Date('2026-07-10T00:00:02.000Z'),
          id: 'm2',
        }),
      );
    });

    it('builds a keyset OR clause from a decoded cursor', async () => {
      prisma.message.findMany.mockResolvedValue([]);
      const cursor = encodeCursor({
        createdAt: new Date('2026-07-10T00:00:02.000Z'),
        id: 'm2',
      });

      await service.getHistory('channel-1', { cursor, limit: 2 });

      expect(prisma.message.findMany).toHaveBeenCalledWith({
        where: {
          channelId: 'channel-1',
          OR: [
            { createdAt: { lt: new Date('2026-07-10T00:00:02.000Z') } },
            {
              createdAt: new Date('2026-07-10T00:00:02.000Z'),
              id: { lt: 'm2' },
            },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 3,
        include: MESSAGE_INCLUDE,
      });
    });
  });

  describe('search', () => {
    it('returns an empty page without querying when channelIds is empty', async () => {
      const result = await service.search({
        query: 'crachá',
        channelIds: [],
        limit: 20,
      });

      expect(result).toEqual({ messages: [], nextCursor: null });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('hydrates matched ids through Prisma and preserves the raw query order', async () => {
      prisma.$queryRaw.mockResolvedValue([{ id: 'm2' }, { id: 'm1' }]);
      const rowM1 = buildMessage('m1', '2026-07-10T00:00:01.000Z');
      const rowM2 = buildMessage('m2', '2026-07-10T00:00:02.000Z');
      // findMany does not guarantee it echoes back the `IN (...)` order.
      prisma.message.findMany.mockResolvedValue([rowM1, rowM2]);

      const result = await service.search({
        query: 'crachá',
        channelIds: ['channel-1'],
        limit: 20,
      });

      expect(prisma.message.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['m2', 'm1'] } },
        include: MESSAGE_INCLUDE,
      });
      expect(result.messages.map((m) => m.id)).toEqual(['m2', 'm1']);
      expect(result.nextCursor).toBeNull();
    });

    it('sets nextCursor and drops the extra row when limit+1 matches come back', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: 'm3' },
        { id: 'm2' },
        { id: 'm1' },
      ]);
      const rows = [
        buildMessage('m1', '2026-07-10T00:00:01.000Z'),
        buildMessage('m2', '2026-07-10T00:00:02.000Z'),
        buildMessage('m3', '2026-07-10T00:00:03.000Z'),
      ];
      prisma.message.findMany.mockResolvedValue(rows);

      const result = await service.search({
        query: 'crachá',
        channelIds: ['channel-1'],
        limit: 2,
      });

      expect(prisma.message.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['m3', 'm2'] } },
        include: MESSAGE_INCLUDE,
      });
      expect(result.messages.map((m) => m.id)).toEqual(['m3', 'm2']);
      expect(result.nextCursor).toBe(
        encodeCursor({
          createdAt: new Date('2026-07-10T00:00:02.000Z'),
          id: 'm2',
        }),
      );
    });

    it('returns an empty page when no matches are found', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.search({
        query: 'nonexistent',
        channelIds: ['channel-1'],
        limit: 20,
      });

      expect(result).toEqual({ messages: [], nextCursor: null });
      expect(prisma.message.findMany).not.toHaveBeenCalled();
    });
  });

  describe('cursor round-trip', () => {
    it('decodes exactly what was encoded', () => {
      const key = { createdAt: new Date('2026-07-10T00:00:02.000Z'), id: 'm2' };
      const decoded = decodeCursor(encodeCursor(key));
      expect(decoded).toEqual(key);
    });
  });

  describe('create', () => {
    it('persists a TEXT message without checking membership, and does not enqueue a link-preview job when there is no URL', async () => {
      const created = buildMessage('m1', '2026-07-10T00:00:01.000Z');
      prisma.message.create.mockResolvedValue(created);

      const result = await service.create({
        channelId: 'channel-1',
        authorId: 'user-1',
        content: 'hi',
      });

      expect(result).toEqual({ message: created });
      expect(prisma.message.create).toHaveBeenCalledWith({
        data: {
          channelId: 'channel-1',
          authorId: 'user-1',
          content: 'hi',
          type: 'TEXT',
          replyToId: null,
          attachments: undefined,
        },
        include: MESSAGE_INCLUDE,
      });
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('enqueues a link-preview job when the content contains a URL', async () => {
      const created = buildMessage('m1', '2026-07-10T00:00:01.000Z', {
        content: 'check this out https://example.com/page',
      });
      prisma.message.create.mockResolvedValue(created);

      await service.create({
        channelId: 'channel-1',
        authorId: 'user-1',
        content: 'check this out https://example.com/page',
      });

      expect(queue.add).toHaveBeenCalledWith(
        'fetch-og-tags',
        {
          messageId: 'm1',
          channelId: 'channel-1',
          url: 'https://example.com/page',
        },
        expect.objectContaining({ attempts: 2 }),
      );
    });

    it('derives type FILE for an attachment-only message with empty content', async () => {
      filesService.getRealObjectSize.mockResolvedValue(100);
      const created = buildMessage('m1', '2026-07-10T00:00:01.000Z', {
        type: 'FILE',
        content: '',
      });
      prisma.message.create.mockResolvedValue(created);

      await service.create({
        channelId: 'channel-1',
        authorId: 'user-1',
        content: '',
        attachments: [
          {
            objectKey: 'attachments/channel-1/x-file.png',
            fileName: 'file.png',
            mimeType: 'image/png',
            sizeBytes: 100,
          },
        ],
      });

      expect(prisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining() nested this way is typed `any` in @types/jest
          data: expect.objectContaining({
            type: 'FILE',
            attachments: {
              create: [
                {
                  fileName: 'file.png',
                  mimeType: 'image/png',
                  sizeBytes: 100,
                  objectKey: 'attachments/channel-1/x-file.png',
                },
              ],
            },
          }),
        }),
      );
    });

    it('rejects with an error when the real object size does not match the declared size', async () => {
      filesService.getRealObjectSize.mockResolvedValue(999);

      const result = await service.create({
        channelId: 'channel-1',
        authorId: 'user-1',
        content: '',
        attachments: [
          {
            objectKey: 'attachments/channel-1/x-file.png',
            fileName: 'file.png',
            mimeType: 'image/png',
            sizeBytes: 100,
          },
        ],
      });

      expect(result).toEqual({
        error: 'Attachment size does not match the uploaded file',
      });
      expect(prisma.message.create).not.toHaveBeenCalled();
    });

    it('rejects with an error when the object is missing from storage', async () => {
      filesService.getRealObjectSize.mockResolvedValue(null);

      const result = await service.create({
        channelId: 'channel-1',
        authorId: 'user-1',
        content: '',
        attachments: [
          {
            objectKey: 'attachments/channel-1/x-file.png',
            fileName: 'file.png',
            mimeType: 'image/png',
            sizeBytes: 100,
          },
        ],
      });

      expect(result).toEqual({ error: 'Attachment was not found in storage' });
      expect(prisma.message.create).not.toHaveBeenCalled();
    });
  });

  describe('create /ticket', () => {
    it('creates a GLPI ticket and persists a TICKET message on success', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(author);
      glpiService.createTicket.mockResolvedValue({
        glpiTicketId: 42,
        status: 'New',
      });
      const created = buildMessage('m1', '2026-07-10T00:00:01.000Z', {
        type: 'TICKET',
        content: 'printer on 3rd floor is jammed',
      });
      prisma.message.create.mockResolvedValue(created);

      const result = await service.create({
        channelId: 'channel-1',
        authorId: 'user-1',
        content: '/ticket printer on 3rd floor is jammed',
      });

      expect(result).toEqual({ message: created });
      expect(glpiService.createTicket).toHaveBeenCalledWith({
        title: 'printer on 3rd floor is jammed',
        content: 'printer on 3rd floor is jammed',
        requesterLabel: 'Reported via Elyzian by Joao Silva (jsilva)',
      });
      expect(prisma.message.create).toHaveBeenCalledWith({
        data: {
          channelId: 'channel-1',
          authorId: 'user-1',
          content: 'printer on 3rd floor is jammed',
          type: 'TICKET',
          ticketRef: {
            create: {
              glpiTicketId: 42,
              status: 'New',
              createdById: 'user-1',
            },
          },
        },
        include: MESSAGE_INCLUDE,
      });
    });

    it('rejects a bare /ticket with no description without calling GLPI', async () => {
      const result = await service.create({
        channelId: 'channel-1',
        authorId: 'user-1',
        content: '/ticket',
      });

      expect(result).toEqual({ error: 'Ticket description cannot be empty' });
      expect(glpiService.createTicket).not.toHaveBeenCalled();
      expect(prisma.message.create).not.toHaveBeenCalled();
    });

    it('rejects /ticket with only whitespace after it', async () => {
      const result = await service.create({
        channelId: 'channel-1',
        authorId: 'user-1',
        content: '/ticket    ',
      });

      expect(result).toEqual({ error: 'Ticket description cannot be empty' });
      expect(glpiService.createTicket).not.toHaveBeenCalled();
      expect(prisma.message.create).not.toHaveBeenCalled();
    });

    it('persists nothing when GLPI is unreachable', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(author);
      glpiService.createTicket.mockRejectedValue(new GlpiUnavailableError());

      const result = await service.create({
        channelId: 'channel-1',
        authorId: 'user-1',
        content: '/ticket printer on 3rd floor is jammed',
      });

      expect(result).toEqual({
        error: 'GLPI is unreachable. Please try again later.',
      });
      expect(prisma.message.create).not.toHaveBeenCalled();
    });
  });

  describe('createSystemMessage', () => {
    it('persists a SYSTEM message authored by the given user', async () => {
      const created = buildMessage('m1', '2026-07-10T00:00:01.000Z', {
        type: 'SYSTEM',
        authorId: 'rmm-bot-1',
        content: 'PC-12 has not checked in for 30 minutes',
      });
      prisma.message.create.mockResolvedValue(created);

      const result = await service.createSystemMessage(
        'channel-1',
        'rmm-bot-1',
        'PC-12 has not checked in for 30 minutes',
      );

      expect(result).toBe(created);
      expect(prisma.message.create).toHaveBeenCalledWith({
        data: {
          channelId: 'channel-1',
          authorId: 'rmm-bot-1',
          content: 'PC-12 has not checked in for 30 minutes',
          type: 'SYSTEM',
        },
        include: MESSAGE_INCLUDE,
      });
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('sets content and editedAt', async () => {
      const updated = buildMessage('m1', '2026-07-10T00:00:01.000Z', {
        content: 'edited',
        editedAt: new Date(),
      });
      prisma.message.update.mockResolvedValue(updated);

      const result = await service.update('m1', 'edited');

      expect(result).toBe(updated);
      expect(prisma.message.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() is typed `any` in @types/jest when nested this way
        data: { content: 'edited', editedAt: expect.any(Date) },
        include: MESSAGE_INCLUDE,
      });
    });
  });

  describe('softDelete', () => {
    it('clears content and sets deletedAt', async () => {
      const deleted = buildMessage('m1', '2026-07-10T00:00:01.000Z', {
        content: '',
        deletedAt: new Date(),
      });
      prisma.message.update.mockResolvedValue(deleted);

      const result = await service.softDelete('m1');

      expect(result).toBe(deleted);
      expect(prisma.message.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() is typed `any` in @types/jest when nested this way
        data: { content: '', deletedAt: expect.any(Date) },
        include: MESSAGE_INCLUDE,
      });
    });
  });
});
