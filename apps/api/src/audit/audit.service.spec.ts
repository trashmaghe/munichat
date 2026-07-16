import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: { auditLog: { create: jest.Mock } };

  beforeEach(async () => {
    prisma = { auditLog: { create: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(AuditService);
  });

  it('writes an audit log row with the given action, user, metadata, and ip', async () => {
    prisma.auditLog.create.mockResolvedValue({});

    await service.log('rmm.remote_control.requested', {
      userId: 'user-1',
      metadata: { agentId: 'a1' },
      ip: '10.0.0.5',
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        action: 'rmm.remote_control.requested',
        userId: 'user-1',
        metadata: { agentId: 'a1' },
        ip: '10.0.0.5',
      },
    });
  });

  it('does not throw when the write fails', async () => {
    prisma.auditLog.create.mockRejectedValue(new Error('db unavailable'));

    await expect(
      service.log('rmm.remote_control.requested', { userId: 'user-1' }),
    ).resolves.toBeUndefined();
  });

  it('writes with undefined userId/metadata/ip when none are given', async () => {
    prisma.auditLog.create.mockResolvedValue({});

    await service.log('some.action');

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        action: 'some.action',
        userId: undefined,
        metadata: undefined,
        ip: undefined,
      },
    });
  });
});
