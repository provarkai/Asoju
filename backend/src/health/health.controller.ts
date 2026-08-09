import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Unauthenticated on purpose — a load balancer/host's health probe has no
 * session to send. Split liveness from readiness (standard practice for a
 * managed host, Section 11.2): a host should stop routing traffic to an
 * instance that's up but can't reach its database, not just one that's
 * fully crashed. Exempt from the global brute-force throttle — a host
 * polling every few seconds shouldn't compete with real traffic for that
 * budget.
 */
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness — the process is up. No dependencies checked. */
  @Get()
  live() {
    return { status: 'ok', env: process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development', time: new Date().toISOString() };
  }

  /** Readiness — the process is up AND can reach the database. */
  @Get('ready')
  @HttpCode(HttpStatus.OK)
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Database is not reachable');
    }
    return { status: 'ok' };
  }
}
