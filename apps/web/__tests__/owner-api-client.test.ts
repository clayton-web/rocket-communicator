// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startGmailOAuthNavigation } from '@/lib/owner/api-client';

describe('A7.8 Owner API client OAuth navigation', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('uses a top-level HTML form POST rather than a background fetch', () => {
    const submit = vi.fn();
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreate(tag);
      if (tag === 'form') {
        Object.defineProperty(el, 'submit', { value: submit });
      }
      return el;
    });

    startGmailOAuthNavigation('/tasks/task_abc');

    expect(submit).toHaveBeenCalledTimes(1);
    const form = document.body.querySelector('form');
    expect(form?.method.toLowerCase()).toBe('post');
    expect(form?.action).toContain('/api/v1/gmail/oauth/start');
    expect(form?.action).toContain('returnPath=%2Ftasks%2Ftask_abc');
    expect(form?.action).not.toContain('Idempotency');
    expect(form?.action).not.toContain('recipient');
  });
});
