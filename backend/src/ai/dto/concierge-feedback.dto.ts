import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { ConciergeFeedbackRating } from '@prisma/client';

/** Section 7 — thumbs up/down on one AI Concierge reply, so the team can
 * review real conversations and iterate on the prompt (system-prompt.ts). */
export class ConciergeFeedbackDto {
  @IsEnum(ConciergeFeedbackRating)
  rating: ConciergeFeedbackRating;

  @IsString()
  @MinLength(1)
  userMessage: string;

  @IsString()
  @MinLength(1)
  aiReply: string;

  @IsOptional()
  @IsBoolean()
  hadQuote?: boolean;
}
