import { IsString } from 'class-validator';

/** P0 Tech Platform §9 "Case Control Requirements" — the single
 * accountable owner, distinct from the broader CaseCollaborator list. */
export class AssignOwnerDto {
  @IsString()
  ownerUserId: string;
}
