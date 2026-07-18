import { Controller, Get } from '@nestjs/common';
import { HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { HealthResponse } from '@elyzian/shared';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async check(): Promise<HealthResponse> {
    try {
      await this.health.check([
        () => this.prismaIndicator.pingCheck('database', this.prisma),
      ]);
      return {
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      };
    } catch {
      return {
        status: 'error',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      };
    }
  }
}
