import { test, expect, signInAsOwner } from '../support/fixtures';
import { seedCapabilityFixture } from '../support/capability-fixture';
import { readCapabilityState, readTaskNotes, readTaskState } from '../support/db-fixtures';
import { structuredEventLines } from '../support/server-log';

/**
 * Valid Recipient capability journey.
 *
 * Trace, screenshot, and video capture are disabled for this file because the raw capability
 * token appears in the navigated URL, and Playwright cannot redact it from a trace (D114).
 */
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('valid capability link renders Task context and does not mutate on GET', async ({
  page,
  browser,
  diagnostics,
}) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signInAsOwner(ownerPage);
  const fixture = await seedCapabilityFixture(ownerPage.request, 'cap-valid');

  const taskBefore = readTaskState(fixture.task.id);
  const capabilityBefore = readCapabilityState(fixture.capability.capabilityId);
  const notesBefore = readTaskNotes(fixture.task.id);

  const response = await page.goto(fixture.capability.capabilityPath);
  expect(response?.status()).toBe(200);

  // Intended Task context and truthful Recipient label.
  await expect(page.getByRole('heading', { level: 1, name: 'Assigned task' })).toBeVisible();
  await expect(page.getByText(fixture.taskTitle)).toBeVisible();
  await expect(page.getByText(fixture.recipientEmail)).toBeVisible();
  await expect(page.getByText('it does not verify who is using it')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Instructions' })).toBeVisible();

  // Permitted actions match the current capability scope and Task state.
  await expect(page.getByRole('heading', { level: 2, name: 'Actions' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Complete' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add note' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Return to owner' })).toBeVisible();

  // GET is non-mutating, asserted against authoritative persisted state rather than the UI
  // (D056). Covers Task status/version/outcome, notes, and capability plus assignment
  // consumption state. `lastUsedAt` is intentionally excluded: the schema defines it as an
  // access stamp that does not imply consumption, so asserting on it would flag a legitimate
  // access record instead of a prohibited business mutation.
  expect(readTaskState(fixture.task.id)).toEqual(taskBefore);
  expect(readCapabilityState(fixture.capability.capabilityId)).toEqual(capabilityBefore);
  expect(readTaskNotes(fixture.task.id)).toEqual(notesBefore);

  // Capability security posture on the response.
  const headers = response?.headers() ?? {};
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['x-robots-tag']).toContain('noindex');
  expect(headers['x-robots-tag']).toContain('nofollow');
  // Non-cacheable, recorded truthfully as LOCAL DEV behaviour only. `proxy.ts` sets
  // `private, no-store, no-cache, must-revalidate` on `/c/*`, but the dev server normalises
  // this HTML document response to `no-cache, must-revalidate`, so the browser cannot prove
  // the `no-store` invariant here. That invariant is proven where it is constructed, by
  // __tests__/proxy.test.ts; production/preview confirmation is a documented later gap.
  expect(headers['cache-control']).toMatch(/no-store|no-cache/);

  expect(diagnostics.consoleErrors).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.failedRequests).toEqual([]);

  await ownerContext.close();
});

test('authorized Recipient action requires confirmation, succeeds, and is visible to the Owner', async ({
  page,
  browser,
}) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signInAsOwner(ownerPage);
  const fixture = await seedCapabilityFixture(ownerPage.request, 'cap-action');
  const noteBody = `${fixture.taskTitle} recipient note`;

  await page.goto(fixture.capability.capabilityPath);

  // Confirmation is currently required before any Recipient mutation.
  await page.getByRole('button', { name: 'Add note' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog).toContainText('Confirm to submit this update.');

  await dialog.getByLabel('Note', { exact: true }).fill(noteBody);
  await dialog.getByRole('button', { name: 'Confirm' }).click();

  // Truthful success state.
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 2, name: 'Notes' })).toBeVisible();
  await expect(page.getByText(noteBody)).toBeVisible();

  // Controlled server assertion: exactly one persisted note, no duplicate side effect.
  const notes = readTaskNotes(fixture.task.id);
  expect(notes.filter((note) => note.body === noteBody)).toHaveLength(1);

  // The resulting state is visible to the Owner with privacy-safe attribution.
  await ownerPage.goto(`/tasks/${fixture.task.id}`);
  await expect(ownerPage.getByText(noteBody)).toBeVisible();
  // Boolean comparison: a raw token passed to `toContain` would land in Playwright's
  // failure message and therefore in `error-context.md`.
  const ownerVisible = await ownerPage.locator('body').innerText();
  expect(ownerVisible.includes(fixture.capability.token)).toBe(false);

  await ownerContext.close();
});

test('capability page diagnostics record a route template and never the raw token', async ({
  page,
  browser,
}) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signInAsOwner(ownerPage);
  const fixture = await seedCapabilityFixture(ownerPage.request, 'cap-diagnostics');

  await page.goto(fixture.capability.capabilityPath);
  await expect(page.getByRole('heading', { level: 1, name: 'Assigned task' })).toBeVisible();

  const structured = structuredEventLines();
  expect(structured.some((line) => line.includes('"routeTemplate":"/c/[token]"'))).toBe(true);
  // Boolean comparison keeps the raw token out of any failure message.
  expect(structured.some((line) => line.includes(fixture.capability.token))).toBe(false);

  await ownerContext.close();
});

/**
 * Recipient timestamps render in the organization timezone (P1.5, D117/D122).
 *
 * The unit suite proves the formatter under a foreign process `TZ`; this proves the browser
 * cannot override it either. That was the actual defect: the panel is a client component, so
 * the removed `toLocaleString` call resolved against whatever zone and locale the Recipient's
 * device happened to report.
 */
test.describe('Recipient timestamps ignore the browser timezone', () => {
  // Pinned far from the organization zone and off the application's locale. A browser-local
  // formatter would render this instant on a different clock, frequently a different calendar
  // day, and in Japanese date order.
  test.use({ timezoneId: 'Asia/Tokyo', locale: 'ja-JP' });

  test('capability expiry renders in the organization timezone', async ({ page, browser }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await signInAsOwner(ownerPage);
    const fixture = await seedCapabilityFixture(ownerPage.request, 'cap-timezone');

    // Built here from the format D117/D122 describe rather than imported from the application,
    // so this cannot pass merely because the application agrees with itself.
    const expected = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Vancouver',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(new Date(fixture.capability.expiresAt));

    await page.goto(fixture.capability.capabilityPath);
    await expect(page.getByRole('heading', { level: 1, name: 'Assigned task' })).toBeVisible();

    const meta = page.locator('p', { hasText: 'Status:' }).first();
    await expect(meta).toContainText(`Link available until ${expected}`);
    // The Pacific zone label is the part a Tokyo-local render could not produce at all.
    await expect(meta).toContainText(/P[SD]T/);

    await ownerContext.close();
  });
});

test('cancelling the confirmation dialog leaves the Task unchanged', async ({ page, browser }) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signInAsOwner(ownerPage);
  const fixture = await seedCapabilityFixture(ownerPage.request, 'cap-cancel');

  const before = readTaskState(fixture.task.id);
  await page.goto(fixture.capability.capabilityPath);

  await page.getByRole('button', { name: 'Complete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(readTaskState(fixture.task.id)).toEqual(before);

  await ownerContext.close();
});
