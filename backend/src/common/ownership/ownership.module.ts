import { Global, Module } from '@nestjs/common';
import { OwnershipService } from './ownership.service';

// @Global for the same reason PrismaModule is: every feature module that
// resolves a field-agent-scoped :id should be able to inject
// OwnershipService without each one adding its own import line — that
// per-module friction is exactly what let three copies of the same
// ownership check drift in the first place.
@Global()
@Module({
  providers: [OwnershipService],
  exports: [OwnershipService],
})
export class OwnershipModule {}
