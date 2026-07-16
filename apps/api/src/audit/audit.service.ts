import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditLogInput {
  userId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}

// Best-effort by design: an audit-write failure must never block the action
// being audited. `AuditLog.userId` has no FK relation (loose reference), so
// this never fails on a foreign-key mismatch either.
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(action: string, input: AuditLogInput = {}): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action,
          userId: input.userId,
          metadata: input.metadata,
          ip: input.ip,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write audit log for action "${action}"`, err);
    }
  }
}
