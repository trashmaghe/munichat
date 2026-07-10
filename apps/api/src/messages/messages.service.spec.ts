import { Test, TestingModule } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { PrismaService } from '../prisma/prisma.service';
import { decodeCursor, encodeCursor } from './message-response.mapper';

describe('MessagesService', () => {
  let service: MessagesService;
  let prisma: { message: { findMany: jest.Mock; create: jest.Mock } };

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

  function buildMessage(id: string, createdAt: string) {
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
    };
  }

  beforeEach(async () => {
    prisma = { message: { findMany: jest.fn(), create: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: PrismaService, useValue: prisma },
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
        include: { author: true },
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
        include: { author: true },
      });
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
    it('persists a TEXT message without checking membership', async () => {
      const created = buildMessage('m1', '2026-07-10T00:00:01.000Z');
      prisma.message.create.mockResolvedValue(created);

      const result = await service.create({
        channelId: 'channel-1',
        authorId: 'user-1',
        content: 'hi',
      });

      expect(result).toBe(created);
      expect(prisma.message.create).toHaveBeenCalledWith({
        data: {
          channelId: 'channel-1',
          authorId: 'user-1',
          content: 'hi',
          type: 'TEXT',
        },
        include: { author: true },
      });
    });
  });
});
