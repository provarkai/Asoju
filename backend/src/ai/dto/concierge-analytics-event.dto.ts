import { registerDecorator, ValidationOptions, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ConciergeAnalyticsEventName } from '@prisma/client';

const MAX_METADATA_KEYS = 5;
const MAX_STRING_VALUE_LENGTH = 40;

/** Enforces the "coarse only, never raw text" contract at the boundary,
 * not just by convention on the frontend: every value must be a string
 * (short — long enough for a status word like "homepage", nowhere near
 * long enough for a Concierge message), number, or boolean. A client bug
 * that tried to pass a real message or free-form text in `metadata`
 * fails validation here rather than silently landing in the analytics
 * table. See ConciergeAnalyticsEvent's own schema comment for the full
 * rationale (first-party only, bounded shape by design). */
function IsSafeAnalyticsMetadata(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isSafeAnalyticsMetadata',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (value === undefined) return true;
          if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
          const entries = Object.entries(value as Record<string, unknown>);
          if (entries.length > MAX_METADATA_KEYS) return false;
          return entries.every(([key, v]) => {
            if (typeof key !== 'string' || key.length > MAX_STRING_VALUE_LENGTH) return false;
            if (typeof v === 'number' || typeof v === 'boolean') return true;
            if (typeof v === 'string') return v.length <= MAX_STRING_VALUE_LENGTH;
            return false;
          });
        },
        defaultMessage(): string {
          return `metadata must be a flat object of at most ${MAX_METADATA_KEYS} string/number/boolean fields, each value at most ${MAX_STRING_VALUE_LENGTH} characters`;
        },
      },
    });
  };
}

/** First-party AI Concierge usage analytics (FRONTEND_HANDOFF_V1_GAP_MAP.md
 * §5/§8 — see ConciergeAnalyticsEvent's own schema comment for the
 * privacy-by-construction rationale). Public endpoint: most of these
 * fire from anonymous homepage/service-page visitors before any sign-in. */
export class ConciergeAnalyticsEventDto {
  @IsEnum(ConciergeAnalyticsEventName)
  name: ConciergeAnalyticsEventName;

  /** Client-generated, per-browser-tab id (sessionStorage) — never a
   * userId. Lets events from one visit be correlated without identifying
   * who the visitor is. */
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sessionId: string;

  @IsOptional()
  @IsSafeAnalyticsMetadata()
  metadata?: Record<string, string | number | boolean>;
}
