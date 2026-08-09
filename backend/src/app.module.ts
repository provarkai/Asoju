import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CasesModule } from './cases/cases.module';
import { AiModule } from './ai/ai.module';
import { CommerceModule } from './commerce/commerce.module';
import { AssignmentsModule } from './assignments/assignments.module';
import { EvidenceModule } from './evidence/evidence.module';
import { AgentsModule } from './agents/agents.module';
import { ProvidersModule } from './providers/providers.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    AuditModule,
    AuthModule,
    CasesModule,
    AiModule,
    CommerceModule,
    AssignmentsModule,
    EvidenceModule,
    AgentsModule,
    ProvidersModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
