import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { GmailConfigError } from './config';

/**
 * Server-only Gmail ciphertext encryption (A5.3, D070).
 *
 * AES-256-GCM with a random 96-bit IV per encryption, a 128-bit authentication tag,
 * and purpose-bound AAD so a refresh-token envelope cannot be substituted for a PKCE
 * verifier envelope (and vice versa). Never import from client components.
 */

const ALGORITHM = 'aes-256-gcm';
const ALGORITHM_LABEL = 'AES-256-GCM';
const ENVELOPE_VERSION = 1;
const IV_BYTES = 12;
const KEY_BYTES = 32;
const AUTH_TAG_BYTES = 16;

/** Explicit ciphertext purpose identifiers. Stored in the envelope and bound via GCM AAD. */
export const CIPHERTEXT_PURPOSE = {
  GMAIL_REFRESH_TOKEN: 'gmail_refresh_token',
  GMAIL_PKCE_VERIFIER: 'gmail_pkce_verifier',
} as const;

export type CiphertextPurpose = (typeof CIPHERTEXT_PURPOSE)[keyof typeof CIPHERTEXT_PURPOSE];

/** Raised on tamper, wrong key, wrong purpose, wrong key version, or malformed envelope. */
export class TokenEncryptionError extends Error {
  constructor(message = 'Token cryptographic operation failed.') {
    super(message);
    this.name = 'TokenEncryptionError';
  }
}

export interface EncryptionKeyMaterial {
  key: Buffer;
  version: string;
}

export interface CiphertextEnvelope {
  /** Envelope format version. */
  v: number;
  /** Algorithm label for durability/audit; enforced on decrypt. */
  alg: string;
  /** Explicit key version used for this ciphertext. */
  kv: string;
  /** Purpose / domain of the plaintext (also bound as GCM AAD). */
  p: CiphertextPurpose;
  /** base64url IV/nonce. */
  iv: string;
  /** base64url ciphertext. */
  ct: string;
  /** base64url GCM authentication tag. */
  tag: string;
}

function decodeKeyBytes(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  return Buffer.from(trimmed, 'base64');
}

function aadForPurpose(purpose: CiphertextPurpose): Buffer {
  return Buffer.from(`aicaa:${purpose}`, 'utf8');
}

function isCiphertextPurpose(value: unknown): value is CiphertextPurpose {
  return (
    value === CIPHERTEXT_PURPOSE.GMAIL_REFRESH_TOKEN ||
    value === CIPHERTEXT_PURPOSE.GMAIL_PKCE_VERIFIER
  );
}

/**
 * Strict server-only key material. Enforces a 32-byte key and an explicit key version.
 * Failures never include the key value.
 */
export function getEncryptionKeyMaterial(
  env: NodeJS.ProcessEnv = process.env,
): EncryptionKeyMaterial {
  const rawKey = env.GMAIL_TOKEN_ENCRYPTION_KEY?.trim();
  if (!rawKey) {
    throw new GmailConfigError('GMAIL_TOKEN_ENCRYPTION_KEY is required.');
  }
  const version = env.GMAIL_TOKEN_ENCRYPTION_KEY_VERSION?.trim();
  if (!version) {
    throw new GmailConfigError('GMAIL_TOKEN_ENCRYPTION_KEY_VERSION is required.');
  }
  const key = decodeKeyBytes(rawKey);
  if (key.length !== KEY_BYTES) {
    throw new GmailConfigError('GMAIL_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  }
  return { key, version };
}

export function encryptToken(
  plaintext: string,
  purpose: CiphertextPurpose,
  material: EncryptionKeyMaterial = getEncryptionKeyMaterial(),
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, material.key, iv);
  cipher.setAAD(aadForPurpose(purpose));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const envelope: CiphertextEnvelope = {
    v: ENVELOPE_VERSION,
    alg: ALGORITHM_LABEL,
    kv: material.version,
    p: purpose,
    iv: iv.toString('base64url'),
    ct: ciphertext.toString('base64url'),
    tag: authTag.toString('base64url'),
  };
  return JSON.stringify(envelope);
}

function requireEnvelopeString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TokenEncryptionError('Malformed ciphertext envelope.');
  }
  return value;
}

function parseEnvelope(serialized: string): CiphertextEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new TokenEncryptionError('Malformed ciphertext envelope.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new TokenEncryptionError('Malformed ciphertext envelope.');
  }
  const candidate = parsed as Record<string, unknown>;
  if (candidate.v !== ENVELOPE_VERSION) {
    throw new TokenEncryptionError('Unsupported ciphertext envelope version.');
  }
  if (candidate.alg !== ALGORITHM_LABEL) {
    throw new TokenEncryptionError('Unsupported ciphertext algorithm.');
  }
  if (!isCiphertextPurpose(candidate.p)) {
    throw new TokenEncryptionError('Unsupported ciphertext purpose.');
  }
  return {
    v: ENVELOPE_VERSION,
    alg: ALGORITHM_LABEL,
    kv: requireEnvelopeString(candidate.kv),
    p: candidate.p,
    iv: requireEnvelopeString(candidate.iv),
    ct: requireEnvelopeString(candidate.ct),
    tag: requireEnvelopeString(candidate.tag),
  };
}

/**
 * Timing-safe equality for equal-length buffers. Returns false on length mismatch
 * without short-circuiting on content.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function decryptToken(
  serialized: string,
  purpose: CiphertextPurpose,
  material: EncryptionKeyMaterial = getEncryptionKeyMaterial(),
): string {
  const envelope = parseEnvelope(serialized);
  if (!timingSafeEqualString(envelope.p, purpose)) {
    throw new TokenEncryptionError('Ciphertext purpose mismatch.');
  }
  if (envelope.kv !== material.version) {
    throw new TokenEncryptionError('Unknown encryption key version.');
  }

  const iv = Buffer.from(envelope.iv, 'base64url');
  const ciphertext = Buffer.from(envelope.ct, 'base64url');
  const authTag = Buffer.from(envelope.tag, 'base64url');
  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
    throw new TokenEncryptionError('Malformed ciphertext envelope.');
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, material.key, iv);
    decipher.setAAD(aadForPurpose(purpose));
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    throw new TokenEncryptionError('Token decryption failed.');
  }
}
