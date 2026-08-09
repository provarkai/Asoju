import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

// No 0/O/1/I — avoids read-aloud ambiguity (Section 12 P1 referral system).
const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export async function generateUniqueReferralCode(prisma: PrismaService): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const bytes = randomBytes(6);
    let code = '';
    for (const byte of bytes) code += REFERRAL_CODE_ALPHABET[byte % REFERRAL_CODE_ALPHABET.length];

    const existing = await prisma.customer.findUnique({ where: { referralCode: code } });
    if (!existing) return code;
  }
  // Astronomically unlikely to ever reach this with a 6-char, 32-symbol
  // alphabet, but fail loudly rather than silently reusing a code.
  throw new Error('Failed to generate a unique referral code');
}
