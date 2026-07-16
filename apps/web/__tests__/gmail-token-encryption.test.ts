// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  CIPHERTEXT_PURPOSE,
  decryptToken,
  encryptToken,
  getEncryptionKeyMaterial,
  TokenEncryptionError,
} from '@/lib/gmail/token-encryption';
import { GmailConfigError } from '@/lib/gmail/config';

const material = {
  key: Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex'),
  version: '1',
};

describe('Gmail token encryption (AES-256-GCM, purpose-bound)', () => {
  it('round-trips plaintext through a purpose-bound versioned envelope', () => {
    const ciphertext = encryptToken(
      'refresh-secret',
      CIPHERTEXT_PURPOSE.GMAIL_REFRESH_TOKEN,
      material,
    );
    expect(ciphertext).not.toContain('refresh-secret');
    expect(JSON.parse(ciphertext)).toEqual(
      expect.objectContaining({
        v: 1,
        alg: 'AES-256-GCM',
        kv: '1',
        p: CIPHERTEXT_PURPOSE.GMAIL_REFRESH_TOKEN,
        iv: expect.any(String),
        ct: expect.any(String),
        tag: expect.any(String),
      }),
    );
    expect(decryptToken(ciphertext, CIPHERTEXT_PURPOSE.GMAIL_REFRESH_TOKEN, material)).toBe(
      'refresh-secret',
    );
  });

  it('uses a random IV per encryption', () => {
    const a = JSON.parse(encryptToken('same', CIPHERTEXT_PURPOSE.GMAIL_PKCE_VERIFIER, material));
    const b = JSON.parse(encryptToken('same', CIPHERTEXT_PURPOSE.GMAIL_PKCE_VERIFIER, material));
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it('rejects swapping refresh-token ciphertext for a PKCE purpose', () => {
    const refreshEnvelope = encryptToken(
      'refresh-secret',
      CIPHERTEXT_PURPOSE.GMAIL_REFRESH_TOKEN,
      material,
    );
    expect(() =>
      decryptToken(refreshEnvelope, CIPHERTEXT_PURPOSE.GMAIL_PKCE_VERIFIER, material),
    ).toThrow(TokenEncryptionError);
  });

  it('rejects swapping PKCE ciphertext for a refresh-token purpose', () => {
    const pkceEnvelope = encryptToken(
      'pkce-verifier-secret',
      CIPHERTEXT_PURPOSE.GMAIL_PKCE_VERIFIER,
      material,
    );
    expect(() =>
      decryptToken(pkceEnvelope, CIPHERTEXT_PURPOSE.GMAIL_REFRESH_TOKEN, material),
    ).toThrow(TokenEncryptionError);
  });

  it('detects ciphertext tampering', () => {
    const envelope = JSON.parse(
      encryptToken('secret', CIPHERTEXT_PURPOSE.GMAIL_REFRESH_TOKEN, material),
    );
    envelope.ct = Buffer.from('tampered').toString('base64url');
    expect(() =>
      decryptToken(JSON.stringify(envelope), CIPHERTEXT_PURPOSE.GMAIL_REFRESH_TOKEN, material),
    ).toThrow(TokenEncryptionError);
  });

  it('rejects the wrong key', () => {
    const ciphertext = encryptToken('secret', CIPHERTEXT_PURPOSE.GMAIL_REFRESH_TOKEN, material);
    const wrong = {
      key: Buffer.alloc(32, 7),
      version: '1',
    };
    expect(() => decryptToken(ciphertext, CIPHERTEXT_PURPOSE.GMAIL_REFRESH_TOKEN, wrong)).toThrow(
      TokenEncryptionError,
    );
  });

  it('rejects a mismatched key version', () => {
    const ciphertext = encryptToken('secret', CIPHERTEXT_PURPOSE.GMAIL_REFRESH_TOKEN, material);
    expect(() =>
      decryptToken(ciphertext, CIPHERTEXT_PURPOSE.GMAIL_REFRESH_TOKEN, {
        ...material,
        version: '2',
      }),
    ).toThrow(TokenEncryptionError);
  });

  it('rejects a malformed envelope', () => {
    expect(() =>
      decryptToken('not-json', CIPHERTEXT_PURPOSE.GMAIL_REFRESH_TOKEN, material),
    ).toThrow(TokenEncryptionError);
    expect(() =>
      decryptToken(JSON.stringify({ v: 99 }), CIPHERTEXT_PURPOSE.GMAIL_REFRESH_TOKEN, material),
    ).toThrow(TokenEncryptionError);
  });

  it('rejects an invalid key length at config time', () => {
    expect(() =>
      getEncryptionKeyMaterial({
        GMAIL_TOKEN_ENCRYPTION_KEY: 'too-short',
        GMAIL_TOKEN_ENCRYPTION_KEY_VERSION: '1',
      }),
    ).toThrow(GmailConfigError);
  });

  it('never embeds plaintext in the envelope serialization', () => {
    const plaintext = 'super-secret-refresh-token-value';
    const serialized = encryptToken(plaintext, CIPHERTEXT_PURPOSE.GMAIL_REFRESH_TOKEN, material);
    expect(serialized).not.toContain(plaintext);
    expect(serialized.toLowerCase()).not.toContain('super-secret');
  });
});
