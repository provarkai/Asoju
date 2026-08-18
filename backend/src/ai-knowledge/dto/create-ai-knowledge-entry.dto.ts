import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { AiKnowledgeCategory } from '@prisma/client';

export class CreateAiKnowledgeEntryDto {
  @IsEnum(AiKnowledgeCategory)
  category: AiKnowledgeCategory;

  @IsString()
  @MinLength(1)
  title: string;

  @IsString()
  @MinLength(1)
  content: string;

  // Defaults to true server-side — an entry is written to be used
  // immediately; staff explicitly flip it off to retire one, same
  // soft-disable convention as AutomationCapability.enabled.
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
