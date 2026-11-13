import crypto from 'crypto';
import bcrypt from 'bcrypt';

/** Legacy HMAC-SHA256 hash — kept for backward-compatible login migration. */
export function legacyHashPassword(password: string, hmacKey: string): string {
  return crypto.createHmac('sha256', hmacKey).update(password).digest('base64');
}

/** Hash a password with bcrypt. */
export async function hashPassword(password: string, rounds = 12): Promise<string> {
  return bcrypt.hash(password, rounds);
}

/**
 * Verify a password against a stored hash.
 * Supports both bcrypt hashes and legacy HMAC-SHA256 hashes (for migration).
 *
 * @param password   The plaintext password to verify.
 * @param storedHash The hash stored in the database.
 * @param hmacKey    Required only for legacy HMAC hashes.
 * @returns `{ valid: boolean; needsRehash: boolean }` — needsRehash is true when the
 *          stored hash is a legacy HMAC that should be upgraded to bcrypt on next save.
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
  hmacKey?: string,
): Promise<{ valid: boolean; needsRehash: boolean }> {
  // bcrypt hashes always start with $2b$ or $2a$
  if (storedHash.startsWith('$2')) {
    const valid = await bcrypt.compare(password, storedHash);
    return { valid, needsRehash: false };
  }

  // Legacy HMAC-SHA256
  if (!hmacKey) {
    return { valid: false, needsRehash: false };
  }
  const computed = new Uint8Array(Buffer.from(legacyHashPassword(password, hmacKey), 'base64'));
  const stored = new Uint8Array(Buffer.from(storedHash, 'base64'));
  // timingSafeEqual throws on a length mismatch; a malformed stored value is simply "invalid".
  const valid = computed.length === stored.length && crypto.timingSafeEqual(computed, stored);
  return { valid, needsRehash: valid };
}
