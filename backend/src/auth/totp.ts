import { createHmac, randomBytes } from 'crypto';

/**
 * Self-rolled TOTP (RFC 6238, on top of RFC 4226 HOTP) — same house style
 * as the self-rolled JWT auth (Section 11.2: "swap for managed provider
 * later"). No new dependency for something Node's built-in `crypto`
 * already covers.
 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TIME_STEP_SECONDS = 30;
const CODE_DIGITS = 6;

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(encoded: string): Buffer {
  const clean = encoded.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 10 ** CODE_DIGITS).toString().padStart(CODE_DIGITS, '0');
}

export function generateTotpSecret(): string {
  // 20 random bytes is RFC 4226's recommended HMAC-SHA1 key length.
  return base32Encode(randomBytes(20));
}

export function generateTotpCode(base32Secret: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / TIME_STEP_SECONDS);
  return hotp(base32Decode(base32Secret), counter);
}

/** Accepts the current 30s window and one step of clock drift either side. */
export function verifyTotpCode(base32Secret: string, code: string, atMs: number = Date.now()): boolean {
  const normalized = code.replace(/\s/g, '');
  for (const drift of [0, -1, 1]) {
    if (generateTotpCode(base32Secret, atMs + drift * TIME_STEP_SECONDS * 1000) === normalized) return true;
  }
  return false;
}

export function otpAuthUrl(accountLabel: string, base32Secret: string, issuer = 'ASOJU'): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  return `otpauth://totp/${label}?secret=${base32Secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${CODE_DIGITS}&period=${TIME_STEP_SECONDS}`;
}
