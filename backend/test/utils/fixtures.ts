import { randomBytes } from 'crypto';
import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { generateUniqueReferralCode } from '../../src/common/referral-code';
import type { PrismaService } from '../../src/prisma/prisma.service';

export const prisma = new PrismaClient();

export const DEFAULT_PASSWORD = 'Passw0rd!23';

/** Every fixture email is unique per test run so re-running the suite
 * against a non-empty database never collides — see test/README.md. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString('hex')}@e2e.test`;
}

async function createUser(email: string, role: Role) {
  const passwordHash = await argon2.hash(DEFAULT_PASSWORD);
  return prisma.user.create({ data: { email, passwordHash, role } });
}

export async function createCustomer(prefix: string) {
  const email = uniqueEmail(prefix);
  const referralCode = await generateUniqueReferralCode(prisma as unknown as PrismaService);
  const user = await createUser(email, Role.CUSTOMER);
  const customer = await prisma.customer.create({
    data: { userId: user.id, fullName: `${prefix} Customer`, referralCode },
  });
  return { user, customer, email };
}

export async function createStaff(prefix: string, role: Role) {
  const email = uniqueEmail(prefix);
  const user = await createUser(email, role);
  return { user, email };
}

export async function createAgent(prefix: string) {
  const email = uniqueEmail(prefix);
  const user = await createUser(email, Role.FIELD_AGENT);
  const agent = await prisma.agent.create({ data: { userId: user.id, fullName: `${prefix} Agent`, isActive: true } });
  return { user, agent, email };
}

export async function createProvider(prefix: string) {
  const email = uniqueEmail(prefix);
  const user = await createUser(email, Role.PROVIDER);
  const provider = await prisma.provider.create({
    data: { userId: user.id, fullName: `${prefix} Provider`, serviceCategory: 'surveyor', status: 'ACTIVE' },
  });
  return { user, provider, email };
}

export async function createPartnerContact(prefix: string) {
  const email = uniqueEmail(prefix);
  const user = await createUser(email, Role.PARTNER);
  const partner = await prisma.partner.create({
    data: { name: `${prefix} Partner Org`, code: randomBytes(4).toString('hex').toUpperCase(), type: 'AGENT' },
  });
  await prisma.partnerContact.create({ data: { userId: user.id, partnerId: partner.id } });
  return { user, partner, email };
}
