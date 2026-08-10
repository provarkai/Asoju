import { IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

/** P0 Technical Build Spec Section 20/21 "Payment Architecture / Payment
 * States". `amount` is optional — omit it for a full refund of whatever's
 * still refundable; provide it for a partial refund. `reason` is always
 * required, same discipline as ScAdjustmentDto — never a silent reversal. */
export class RefundPaymentDto {
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  @IsString()
  @IsNotEmpty()
  reason: string;
}
