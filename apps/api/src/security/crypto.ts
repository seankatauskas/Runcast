import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { config } from '../config';

export function opaqueToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', config.credentialEncryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptSecret(envelope: string): string {
  const [version, ivValue, tagValue, encryptedValue] = envelope.split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue)
    throw new Error('Invalid credential envelope');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    config.credentialEncryptionKey,
    Buffer.from(ivValue, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function coordinateHash(points: { lat: number; lon: number }[]): string {
  const hash = createHash('sha256');
  for (const point of points) hash.update(`${point.lat.toFixed(5)},${point.lon.toFixed(5)};`);
  return hash.digest('base64url');
}
