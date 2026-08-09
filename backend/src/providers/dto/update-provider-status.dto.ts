import { IsEnum } from 'class-validator';
import { ProviderStatus } from '@prisma/client';

export class UpdateProviderStatusDto {
  @IsEnum(ProviderStatus)
  status: ProviderStatus;
}
