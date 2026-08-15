export function naira(amount: number): string {
  return `₦${Math.round(amount).toLocaleString('en-NG')}`;
}
