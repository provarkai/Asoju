import { Module } from '@nestjs/common';
import { PaystackService } from './paystack.service';
import { PaystackWebhookGuard } from './paystack-webhook.guard';

@Module({
  providers: [PaystackService, PaystackWebhookGuard],
  exports: [PaystackService, PaystackWebhookGuard],
})
export class PaymentsModule {}
