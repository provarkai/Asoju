import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { AiKnowledgeCategory } from '@prisma/client';

// Every field optional — a partial update (e.g. just flipping isActive off)
// is the common case, same PATCH-partial convention as
// UpdateAutomationCapabilityDto's sibling DTOs elsewhere in this module.
export class UpdateAiKnowledgeEntryDto {
  @IsOptional()
  @IsEnum(AiKnowledgeCategory)
  category?: AiKnowledgeCategory;

  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  content?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
