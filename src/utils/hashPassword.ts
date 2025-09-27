import crypto from 'crypto';

export function hashPassword(password: string, hmacKey: string): string {
  return crypto.createHmac('sha256', hmacKey).update(password).digest('base64');
}
