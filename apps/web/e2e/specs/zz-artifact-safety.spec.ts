import { test, expect, signInAsOwner } from '../support/fixtures';
import { seedCapabilityFixture } from '../support/capability-fixture';
import {
  REDACTED_CAPABILITY,
  assertTokenAbsentFromArtifacts,
  redactCapabilityPaths,
} from '../support/artifact-safety';
import { readServerLog } from '../support/server-log';

/**
 * Capability-secret protection for retained artifacts (D114).
 *
 * Sorts last so it sees the artifacts produced by earlier specs, but it does not depend on
 * them: it seeds its own capability and passes when run alone. The authoritative run-wide gate
 * is the `globalTeardown` sweep, which also covers artifacts written after this spec finishes —
 * including those from a failing test.
 */
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'one artifact sweep per run is enough');
});

test('raw capability tokens do not enter retained browser artifacts', async ({ page, browser }) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signInAsOwner(ownerPage);
  const fixture = await seedCapabilityFixture(ownerPage.request, 'artifact');

  // Exercise a real capability page load so any artifact leak would be realistic.
  await page.goto(fixture.capability.capabilityPath);
  await expect(page.getByRole('heading', { level: 1, name: 'Assigned task' })).toBeVisible();

  const scan = assertTokenAbsentFromArtifacts(fixture.capability.token);
  expect(scan.offenders).toEqual([]);
  expect(scan.scannedFiles).toBeGreaterThan(0);

  // The captured application log kept the request, but only in redacted form.
  expect(readServerLog()).toContain('/c/[redacted]');

  // The token is never displayed to the Recipient. It does exist in the page's own client
  // payload, because the panel is authorized by that token and needs it to call the API —
  // which is precisely why no HTML snapshot, trace, or screenshot is retained for this route.
  //
  // Compared as a boolean on purpose: passing the raw token to `toContain` would put the
  // secret into Playwright's failure message, which is written to `error-context.md`.
  const visible = await page.locator('body').innerText();
  expect(visible.includes(fixture.capability.token)).toBe(false);

  await ownerContext.close();
});

test('redaction helper removes capability paths from any diagnostic string', async () => {
  const sample = `GET /c/${'C'.repeat(43)} failed`;

  const redacted = redactCapabilityPaths(sample);

  expect(redacted).toBe(`GET ${REDACTED_CAPABILITY} failed`);
  expect(redacted).not.toContain('C'.repeat(43));
});
