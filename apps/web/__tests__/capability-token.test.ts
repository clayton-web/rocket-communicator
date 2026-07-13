// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_TOKEN_BYTES,
  CAPABILITY_TOKEN_HASH_HEX_LENGTH,
  capabilitySecretsEqual,
  generateCapabilityToken,
  hashCapabilityToken,
  redactCapabilitySecrets,
  buildCapabilityUrl,
} from '@/lib/capability';

describe('capability token primitives', () => {
  it('generates URL-safe opaque tokens with sufficient entropy', () => {
    const token = generateCapabilityToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url without padding
    expect(Buffer.from(token, 'base64url').length).toBe(CAPABILITY_TOKEN_BYTES);
    expect(token).not.toMatch(/[@.]/);
    expect(token.toLowerCase()).not.toContain('task');
    expect(token.toLowerCase()).not.toContain('scope');
    expect(token).not.toContain('2026');
  });

  it('produces distinct tokens across repeated issuance', () => {
    const tokens = new Set(Array.from({ length: 20 }, () => generateCapabilityToken()));
    expect(tokens.size).toBe(20);
  });

  it('hashes deterministically and changes with token or pepper', () => {
    const token = generateCapabilityToken();
    const pepper = 'p'.repeat(32);
    const otherPepper = 'q'.repeat(32);
    const hash = hashCapabilityToken(token, pepper);
    expect(hash).toBe(hashCapabilityToken(token, pepper));
    expect(hash).toHaveLength(CAPABILITY_TOKEN_HASH_HEX_LENGTH);
    expect(hash).toMatch(/^[a-f0-9]+$/);
    expect(hash).not.toBe(hashCapabilityToken(generateCapabilityToken(), pepper));
    expect(hash).not.toBe(hashCapabilityToken(token, otherPepper));
    expect(capabilitySecretsEqual(hash, hashCapabilityToken(token, pepper))).toBe(true);
  });

  it('redacts capability URLs and does not embed claims in token itself', () => {
    const token = generateCapabilityToken();
    const url = buildCapabilityUrl('https://app.example.com', token);
    expect(url).toBe(`https://app.example.com/c/${token}`);
    expect(redactCapabilitySecrets(url)).toBe('https://app.example.com/c/[redacted]');
    expect(redactCapabilitySecrets(`token=${token}`)).toContain('[redacted]');
    expect(redactCapabilitySecrets(`token=${token}`)).not.toContain(token);
  });
});
