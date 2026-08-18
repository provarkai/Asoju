import { IsEnum, IsInt, IsObject, IsOptional, Min } from 'class-validator';
import { AutomationRuleKind } from '@prisma/client';

export class CreateAutomationRuleDto {
  @IsEnum(AutomationRuleKind)
  kind: AutomationRuleKind;

  // Shape depends on `kind` — { fields: string[] } for REQUIRED_FIELDS,
  // { keywords: string[] } for BLOCKED_KEYWORDS. Validated against that
  // shape in AutomationAdminService, not here (class-validator has no
  // clean way to express a kind-conditional shape without a much heavier
  // DTO split).
  @IsObject()
  config: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
