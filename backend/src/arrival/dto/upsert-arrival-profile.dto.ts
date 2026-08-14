import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

const ACCOMMODATION_TYPES = ['hotel', 'short_let', 'family_home', 'other'] as const;

/** Phase 2 "ASOJU Arrival" — the structured pre-arrival detail an
 * ARRIVAL_SUPPORT case's Job Card checklist checks against. Every field
 * optional: a customer may not have flight details yet at intake, and
 * this can be filled in progressively before the case moves past
 * scoping (same "progressive disclosure" philosophy as onboarding). */
export class UpsertArrivalProfileDto {
  @IsOptional()
  @IsDateString()
  arrivalDate?: string;

  @IsOptional()
  @IsString()
  flightNumber?: string;

  @IsOptional()
  @IsString()
  departureAirport?: string;

  @IsOptional()
  @IsString()
  arrivalAirport?: string;

  @IsOptional()
  @IsString()
  accommodationAddress?: string;

  @IsOptional()
  @IsIn(ACCOMMODATION_TYPES)
  accommodationType?: (typeof ACCOMMODATION_TYPES)[number];

  @IsOptional()
  @IsInt()
  @IsPositive()
  numberOfTravelers?: number;

  @IsOptional()
  @IsBoolean()
  pickupRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  groceriesRequired?: boolean;

  @IsOptional()
  @IsString()
  specialRequests?: string;
}
