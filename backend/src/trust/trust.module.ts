import { Module } from '@nestjs/common';
import { TrustService } from './trust.service';
import { TrustController } from './trust.controller';

@Module({
  providers: [TrustService],
  controllers: [TrustController],
})
export class TrustModule {}
