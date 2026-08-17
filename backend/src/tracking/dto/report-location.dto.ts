import { IsDateString, IsNumber, IsOptional, IsString } from 'class-validator';

export class ReportLocationDto {
  @IsNumber()
  lat: number;

  @IsNumber()
  lng: number;

  @IsOptional()
  @IsNumber()
  accuracy?: number;

  @IsOptional()
  @IsDateString()
  capturedAt?: string;

  /** #53 — offline support (frontend/src/lib/offlineQueue.ts). Optional
   * and client-generated: a ping sent live (online) has no queue to
   * replay from and doesn't need one. A ping the client queued while
   * offline carries the same key on every replay, so a dropped response
   * after the server already recorded it doesn't create a second
   * LocationPing when the queue retries. */
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
