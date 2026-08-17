import { ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { PricingZone } from '@prisma/client';

/** P0 Technical Build Spec Section 14 — objective + tasks are the minimum
 * a scope needs to mean anything; deliverables/exclusions/evidence
 * requirements are recommended but not force-required, since not every
 * service family needs all four to be meaningful (e.g. a simple check-in
 * may have no external deliverable beyond the report itself). */
export class CreateScopeDto {
  @IsString()
  @MinLength(5)
  objective: string;

  /** Platform Expansion PRD §2.2 — omit to let ScopeService derive it
   * from the case's location (pricing-zone.ts's classifyZone); set it
   * explicitly when the classifier can't know (a bare LGA name, a
   * landmark) or gets it wrong. */
  @IsOptional()
  @IsEnum(PricingZone)
  zone?: PricingZone;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  tasks: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deliverables?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  exclusions?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenceRequirements?: string[];
}
