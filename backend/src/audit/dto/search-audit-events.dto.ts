import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Admin Console & Platform Admin Architecture v1.0 Section 26 "Audit Log"
 * / API Specification Section 28 — GET /admin/audit-events search/filter.
 * All filters are optional and combine with AND. */
export class SearchAuditEventsDto {
  @IsOptional()
  @IsString()
  actorId?: string;

  @IsOptional()
  @IsIn(['user', 'ai', 'system'])
  actorType?: 'user' | 'ai' | 'system';

  @IsOptional()
  @IsString()
  caseId?: string;

  /** Substring match against the action string (e.g. "payment" matches
   * payment.initiated / payment.refunded / payment.expired). */
  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;
}
