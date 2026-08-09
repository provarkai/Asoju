import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

// No 0/O/1/I — avoids read-aloud ambiguity (Section 12 P1 referral system).
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

async function generateUniqueCode(exists: (code: string) => Promise<boolean>, label: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const bytes = randomBytes(6);
    let code = '';
    for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];

    if (!(await exists(code))) return code;
  }
  // Astronomically unlikely to ever reach this with a 6-char, 32-symbol
  // alphabet, but fail loudly rather than silently reusing a code.
  throw new Error(`Failed to generate a unique ${label} code`);
}

export async function generateUniqueReferralCode(prisma: PrismaService): Promise<string> {
  return generateUniqueCode(
    async (code) => !!(await prisma.customer.findUnique({ where: { referralCode: code } })),
    'referral',
  );
}

/** Section 12 P2 "partner portal" — same collision-resistant pattern as the
 * customer referral code, applied to Partner.code. */
export async function generateUniquePartnerCode(prisma: PrismaService): Promise<string> {
  return generateUniqueCode(
    async (code) => !!(await prisma.partner.findUnique({ where: { code } })),
    'partner',
  );
}
