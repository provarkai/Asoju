import { IsOptional, IsString } from 'class-validator';

/** Approve/reject a pending RefundRequest. `note` is optional on both —
 * the request's own `reason` already carries the "why," this is only for
 * the checker's own commentary if they have any. */
export class DecideRefundRequestDto {
  @IsOptional()
  @IsString()
  note?: string;
}
