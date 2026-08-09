import { IsEnum, IsString } from 'class-validator';
import { CollaboratorRole } from '@prisma/client';

/** Section 5.3 — Operations Control Centre: assign staff onto a case. */
export class AddCollaboratorDto {
  @IsString()
  userId: string;

  @IsEnum(CollaboratorRole)
  role: CollaboratorRole;
}
