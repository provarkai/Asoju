import { IsNumber, IsOptional, IsPositive, IsString, Length } from 'class-validator';

/**
 * Shape of a payment-provider webhook (Paystack/Flutterwave-style — see
 * PRD Section 11.2). This is the ONLY path that can mark a Payment as
 * verified (Non-Negotiable #4): no customer-facing endpoint may set
 * `providerWebhookVerifiedAt`.
 */
export class PaymentWebhookDto {
  @IsString()
  invoiceId: string;

  @IsString()
  provider: string;

  @IsString()
  providerReference: string;

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;
}
