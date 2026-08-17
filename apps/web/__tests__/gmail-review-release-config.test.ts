// @vitest-environment node
/**
 * S7 Gmail Review release-gate predicate.
 *
 * Exact-string opt-in, matching ENABLE_REMINDER_DELIVERY / ENABLE_OWNER_EVENT_CAPTURE.
 */
import { describe, expect, it } from 'vitest';
import { ENABLE_GMAIL_REVIEW_ENV, isGmailReviewEnabled } from '@/lib/gmail/review-release-config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('ENABLE_GMAIL_REVIEW is opt-in by exact string', () => {
  it('enables Gmail Review only for "true"', () => {
    expect(isGmailReviewEnabled({ [ENABLE_GMAIL_REVIEW_ENV]: 'true' })).toBe(true);
  });

  it.each(['1', 'TRUE', 'True', 'yes', 'on', ' true', 'true ', '"true"', 'false', ''])(
    'leaves Gmail Review disabled for %o',
    (value) => {
      expect(isGmailReviewEnabled({ [ENABLE_GMAIL_REVIEW_ENV]: value })).toBe(false);
    },
  );

  it('leaves Gmail Review disabled when the variable is absent', () => {
    expect(isGmailReviewEnabled({})).toBe(false);
  });

  it('imports nothing from A5 Gmail configuration or OAuth', () => {
    const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const source = readFileSync(path.join(webRoot, 'lib/gmail/review-release-config.ts'), 'utf8');
    expect(source).not.toMatch(/from '\.\/config'/);
    expect(source).not.toMatch(/from '\.\/oauth-client'/);
    expect(source).not.toMatch(/from '\.\/sync-service'/);
    expect(source).not.toMatch(/from '\.\/sync-engine'/);
    expect(source).not.toMatch(/from '\.\/service'/);
    expect(source).not.toMatch(/from '\.\/token-encryption'/);
    expect(source).not.toMatch(/getGmailOAuthConfig/);
    expect(source).not.toMatch(/GOOGLE_GMAIL_/);
    expect(source).not.toMatch(/GMAIL_TOKEN_ENCRYPTION/);
    expect(source).not.toMatch(/from '@\/lib\/db/);
    expect(source).not.toMatch(/from '@aicaa\/db/);
  });
});
