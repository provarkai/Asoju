import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';

/** Global, like StorageModule/NotificationsModule — any module that needs
 * to deliver a real email (starting with AuthModule's password reset)
 * gets this without a per-module import. */
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
