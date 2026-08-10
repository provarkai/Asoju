import { IsEnum, IsOptional } from 'class-validator';
import { MembershipPlan } from '@prisma/client';

export class SubscribeDto {
  @IsOptional()
  @IsEnum(MembershipPlan)
  plan?: MembershipPlan;
}
