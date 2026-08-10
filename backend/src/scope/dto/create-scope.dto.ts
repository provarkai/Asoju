import { ArrayMinSize, IsArray, IsOptional, IsString, MinLength } from 'class-validator';

/** P0 Technical Build Spec Section 14 — objective + tasks are the minimum
 * a scope needs to mean anything; deliverables/exclusions/evidence
 * requirements are recommended but not force-required, since not every
 * service family needs all four to be meaningful (e.g. a simple check-in
 * may have no external deliverable beyond the report itself). */
export class CreateScopeDto {
  @IsString()
  @MinLength(5)
  objective: string;

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
