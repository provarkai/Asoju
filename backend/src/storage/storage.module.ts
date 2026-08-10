import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/** Global, like NotificationsService — every module that accepts an upload
 * (Evidence, Documents) needs this without a per-module import. */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
