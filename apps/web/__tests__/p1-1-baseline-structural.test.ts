// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The two performance items P1.1 recorded as baseline debt (docs/P1_1_BASELINE.md §7)
 * were closed by P1.3. The baseline document keeps the historical measurement; these
 * assertions guard the current state so the debt cannot silently return.
 *
 * Behavioural proof lives in `p1-3-performance-structural.test.ts`, `proxy.test.ts`, and
 * `owner-auth-call-count.test.ts`; these are the source-level guards only.
 */
describe('P1.1 baseline debt closed by P1.3 (structural)', () => {
  const root = join(__dirname, '..');

  /** Comments legitimately name the calls being reasoned about; only code counts here. */
  function withoutComments(source: string): string {
    return source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/\/\/.*$/gm, '');
  }

  it('no longer performs a verified getUser in the proxy', () => {
    const proxy = withoutComments(readFileSync(join(root, 'proxy.ts'), 'utf8'));
    const requireOwner = withoutComments(
      readFileSync(join(root, 'lib/auth/require-owner.ts'), 'utf8'),
    );

    // The proxy refreshes cookies only; it must not call the verifying endpoint.
    expect(proxy).not.toMatch(/auth\.getUser\(\)/);
    expect(proxy).toMatch(/auth\.getSession\(\)/);

    // Route/RSC authorization remains the single server-verified identity call, and it
    // must stay a real getUser rather than a trusted cookie read.
    expect(requireOwner).toMatch(/auth\.getUser\(\)/);
    expect(requireOwner).not.toMatch(/auth\.getSession\(/);
  });

  it('Owner task list repository no longer loads the note relation', () => {
    const repo = readFileSync(
      join(root, '../../packages/db/src/repositories/task-repository.ts'),
      'utf8',
    );
    const listTasks = repo.slice(
      repo.indexOf('export async function listTasks'),
      repo.indexOf('type TaskListCursor'),
    );

    expect(listTasks).not.toMatch(/notes:/);
    expect(listTasks).toMatch(/mapTask\(row, row\.assignments\[0\] \?\? null, \[\]\)/);
  });
});
