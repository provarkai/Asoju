/** Shared across the field earnings/wallet views and anywhere else a Naira
 * amount needs a human label — every backend amount is a Prisma Decimal
 * serialized as a string over JSON, so this accepts either. */
export function formatNaira(amount: number | string): string {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (Number.isNaN(value)) return '₦0';
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(value);
}
