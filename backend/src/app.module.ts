import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CasesModule } from './cases/cases.module';
import { AiModule } from './ai/ai.module';
import { CommerceModule } from './commerce/commerce.module';
import { AssignmentsModule } from './assignments/assignments.module';
import { EvidenceModule } from './evidence/evidence.module';
import { AgentsModule } from './agents/agents.module';
import { ProvidersModule } from './providers/providers.module';
import { ProfileModule } from './profile/profile.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RatingsModule } from './ratings/ratings.module';
import { DocumentsModule } from './documents/documents.module';
import { ConciergeModule } from './concierge/concierge.module';
import { RecurringModule } from './recurring/recurring.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { AccountsModule } from './accounts/accounts.module';
import { RiskEngineModule } from './risk/risk-engine.module';
import { PartnersModule } from './partners/partners.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    StorageModule,
    AuditModule,
    NotificationsModule,
    AuthModule,
    CasesModule,
    AiModule,
    CommerceModule,
    AssignmentsModule,
    EvidenceModule,
    AgentsModule,
    ProvidersModule,
    ProfileModule,
    RatingsModule,
    DocumentsModule,
    ConciergeModule,
    RecurringModule,
    AnalyticsModule,
    WhatsappModule,
    AccountsModule,
    RiskEngineModule,
    PartnersModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
