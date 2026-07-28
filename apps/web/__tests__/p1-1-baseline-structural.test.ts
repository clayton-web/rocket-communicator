// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * P1.1 baseline evidence (structural): Owner page requests currently call
 * supabase.auth.getUser() twice — once in proxy session refresh and once in
 * getAuthenticatedOwner. Deduplication is deferred to P1.3 (D119).
 */
describe('P1.1 auth-call baseline (structural; not optimized)', () => {
  const root = join(__dirname, '..');

  it('documents two getUser call sites on the Owner page path', () => {
    const proxy = readFileSync(join(root, 'proxy.ts'), 'utf8');
    const requireOwner = readFileSync(join(root, 'lib/auth/require-owner.ts'), 'utf8');

    expect(proxy).toMatch(/auth\.getUser\(\)/);
    expect(requireOwner).toMatch(/auth\.getUser\(\)/);

    // No request-scoped memoization exists yet (P1.3 work).
    expect(requireOwner).not.toMatch(/AsyncLocalStorage/);
    expect(requireOwner).not.toMatch(/memoiz|cache\(.*getUser/i);
  });

  it('Owner task list repository still includes unbounded notes (P1.3 debt)', () => {
    const repo = readFileSync(
      join(root, '../../packages/db/src/repositories/task-repository.ts'),
      'utf8',
    );
    // listTasks include block still loads notes without take — baseline observation.
    expect(repo).toMatch(/notes:\s*\{\s*orderBy:\s*\{\s*createdAt:\s*'asc'\s*\}\s*\}/);
  });
});
