import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GMAIL_POLL_INTERVAL_MINUTES,
  DomainError,
  GMAIL_INBOX_LABEL_ID,
  GMAIL_READONLY_SCOPE,
  MAX_GMAIL_EXCERPT_BYTES,
  assertExcerptWithinCap,
  assertGmailMailboxMatchesWorkspaceDomain,
  buildGmailDedupeKey,
  isGmailInboxEligible,
  isSystem,
  measureExcerptByteLength,
  systemActor,
  truncateGmailSnippet,
  truncateGmailSubject,
} from '../src/index.js';

describe('A5 Gmail domain invariants', () => {
  it('uses five-minute default poll interval (D065)', () => {
    expect(DEFAULT_GMAIL_POLL_INTERVAL_MINUTES).toBe(5);
  });

  it('documents gmail.readonly scope constant (D070)', () => {
    expect(GMAIL_READONLY_SCOPE).toContain('gmail.readonly');
  });

  it('requires Workspace-domain mailbox match (D069)', () => {
    expect(() =>
      assertGmailMailboxMatchesWorkspaceDomain('owner@acme.example', 'acme.example'),
    ).not.toThrow();
    expect(() =>
      assertGmailMailboxMatchesWorkspaceDomain('owner@other.example', 'acme.example'),
    ).toThrow(DomainError);
  });

  it('treats only INBOX-labelled messages as eligible (D068)', () => {
    expect(isGmailInboxEligible([GMAIL_INBOX_LABEL_ID, 'UNREAD'])).toBe(true);
    expect(isGmailInboxEligible(['SENT'])).toBe(false);
    expect(isGmailInboxEligible([])).toBe(false);
  });

  it('enforces excerpt byte cap (D072)', () => {
    const ok = 'a'.repeat(100);
    expect(() => assertExcerptWithinCap(ok)).not.toThrow();
    const tooBig = 'b'.repeat(MAX_GMAIL_EXCERPT_BYTES + 1);
    expect(measureExcerptByteLength(tooBig)).toBe(MAX_GMAIL_EXCERPT_BYTES + 1);
    expect(() => assertExcerptWithinCap(tooBig)).toThrow(DomainError);
  });

  it('truncates subject and snippet to documented caps', () => {
    expect(truncateGmailSubject('x'.repeat(300))?.length).toBe(256);
    expect(truncateGmailSnippet('y'.repeat(600))?.length).toBe(512);
    expect(truncateGmailSubject('   ')).toBeNull();
  });

  it('builds stable gmail dedupe keys', () => {
    expect(buildGmailDedupeKey('msg_1')).toBe('gmail:msg_1');
  });

  it('supports truthful system audit actor (D074)', () => {
    const actor = systemActor('gmail_poll');
    expect(isSystem(actor)).toBe(true);
    expect(actor.kind).toBe('system');
    expect(actor.systemId).toBe('gmail_poll');
  });
});
