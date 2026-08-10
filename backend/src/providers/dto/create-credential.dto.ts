import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateCredentialDto {
  @IsString()
  @MinLength(2)
  type: string; // license | certification | reference

  @IsOptional()
  @IsString()
  issuer?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  documentUrl?: string;
}
