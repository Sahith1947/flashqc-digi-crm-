import 'server-only';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { serverEnv } from '@/server/env';

// AES-256-GCM for secrets stored in the database (provider OAuth tokens).
// Format: v1.<iv b64url>.<tag b64url>.<ciphertext b64url>

function key(): Buffer {
  const raw = serverEnv.integrationEncryptionKey;
  if (!raw) {
    // Hosted deploys without an explicit key derive one from a server-only Supabase secret.
    const base = serverEnv.supabaseJwtSecret || serverEnv.supabaseSecretKey;
    if (!base) throw new Error('INTEGRATION_ENCRYPTION_KEY is not set on the server.');
    return Buffer.from(hkdfSync('sha256', base, 'flashqc-crm', 'integration-credentials-v1', 32));
  }
  const k = Buffer.from(raw, 'base64');
  if (k.length !== 32) throw new Error('INTEGRATION_ENCRYPTION_KEY must be 32 bytes, base64-encoded.');
  return k;
}

export function encryptSecret(plain: string, aad: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptSecret(blob: string, aad: string): string {
  const [v, iv, tag, ct] = blob.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unrecognised secret format');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

/** True when secrets can be encrypted (explicit key or a derivable server secret). */
export function encryptionAvailable(): boolean {
  return Boolean(serverEnv.integrationEncryptionKey || serverEnv.supabaseJwtSecret || serverEnv.supabaseSecretKey);
}

/** Shared secret the CRM gives Sarvam in webhook metadata; Sarvam echoes it back on every delivery. */
export function sarvamWebhookSecret(): string {
  const base = serverEnv.integrationEncryptionKey || serverEnv.supabaseJwtSecret || serverEnv.supabaseSecretKey;
  if (!base) throw new Error('No server secret available to derive the webhook secret.');
  return Buffer.from(hkdfSync('sha256', base, 'flashqc-crm', 'sarvam-webhook-v1', 32)).toString('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
