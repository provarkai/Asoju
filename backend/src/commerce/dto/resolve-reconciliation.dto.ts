import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';
import { ReconciliationStatus } from '@prisma/client';

/** Database Schema & ERD Design v1.0 Section 17 "Finance Schema" —
 * `reconciliations`. Finance's decision on a RECONCILIATION_REQUIRED
 * payment. `notes` is always required — same discipline as
 * RefundPaymentDto's `reason`, never a silent resolution. `resolvedAmount`
 * only applies to MATCHED (the amount Paystack actually reports having
 * received, if different from what the invoice expected); it's ignored for
 * REJECTED. */
export class ResolveReconciliationDto {
  @IsEnum(ReconciliationStatus)
  status: ReconciliationStatus;

  @IsString()
  @IsNotEmpty()
  notes: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  resolvedAmount?: number;
}
