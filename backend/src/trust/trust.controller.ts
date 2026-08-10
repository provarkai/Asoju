import { Controller, Get } from '@nestjs/common';
import { TrustService } from './trust.service';

/**
 * Deliberately unauthenticated — this is the whole point of a public
 * trust page (anyone considering ASOJU, not yet a customer, needs to
 * reach it with no login). No JwtAuthGuard, no case/customer scoping —
 * see TrustService for what actually gates what appears here.
 */
@Controller('trust')
export class TrustController {
  constructor(private readonly trustService: TrustService) {}

  @Get()
  getPublicStats() {
    return this.trustService.getPublicStats();
  }
}
