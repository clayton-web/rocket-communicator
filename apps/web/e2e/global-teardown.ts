import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * Capability-secret gate (D114, D119).
 *
 * Wired as Playwright's `globalTeardown` so the sweep runs whether the suite passed or
 * failed, and whichever script started it. A failing suite is exactly when screenshots and
 * error context are retained, so a sweep chained with `&&` after the run would skip the
 * highest-risk case.
 *
 * Throwing here fails the run, so an unsafe artifact cannot be quietly left on disk.
 */
export default function globalTeardown(): void {
  const webDir = path.resolve(__dirname, '..');
  try {
    const output = execFileSync('node', ['./e2e/scripts/verify-artifact-safety.mjs'], {
      cwd: webDir,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    process.stdout.write(output);
  } catch (error) {
    const detail =
      error && typeof error === 'object' && 'stderr' in error
        ? String((error as { stderr?: string }).stderr ?? '')
        : String(error);
    process.stderr.write(detail);
    throw new Error('Capability-secret sweep failed; see the offending artifacts above.');
  }
}
