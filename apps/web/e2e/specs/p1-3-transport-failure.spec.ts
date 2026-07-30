import { test, expect, signInAsOwner } from '../support/fixtures';
import { seedCapabilityFixture } from '../support/capability-fixture';
import { readTaskNotes, readTaskState } from '../support/db-fixtures';

/**
 * Narrow P1.3 assertion (D112): a browser mutation that gets no server response is
 * presented as genuinely uncertain — never as success, and never as a confirmed 412.
 *
 * Trace, screenshot, and video capture are disabled because the raw capability token
 * appears in the navigated URL and Playwright cannot redact it from a trace (D114).
 */
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

// Transport-level contract; one viewport is sufficient evidence.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'transport contract: desktop only');
});

test('an unanswered mutation is reported as uncertain, not as success or a stale-version conflict', async ({
  page,
  browser,
}) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signInAsOwner(ownerPage);
  const fixture = await seedCapabilityFixture(ownerPage.request, 'cap-transport');

  const before = readTaskState(fixture.task.id);
  await page.goto(fixture.capability.capabilityPath);

  // Fail the mutation at the transport layer: the browser gets no response at all, which
  // is the outcome D112 requires to be presented as ambiguous rather than resolved.
  await page.route('**/api/v1/capabilities/**/notes', (route) => route.abort('failed'));

  const dialog = page.getByRole('dialog');
  await page.getByRole('button', { name: 'Add note' }).click();
  await dialog.getByLabel('Note', { exact: true }).fill(`${fixture.taskTitle} unreachable`);
  await dialog.getByRole('button', { name: 'Confirm' }).click();

  // Honest about the uncertainty, and explicit that the update may in fact have applied.
  await expect(page.getByText('may or may not have been saved')).toBeVisible();

  // Not success, and not the confirmed-412 recovery message. The success banner is matched
  // exactly: `hasText` with a string is a case-insensitive substring match, so a loose
  // 'Saved.' would also match "…may or may not have been saved." and pass vacuously.
  await expect(page.getByRole('status').filter({ hasText: /^Saved\.$/ })).toHaveCount(0);
  await expect(page.getByText('The task was updated.')).toHaveCount(0);

  // Nothing was invented on the client and no replacement mutation was issued.
  expect(readTaskState(fixture.task.id)).toEqual(before);
  expect(readTaskNotes(fixture.task.id)).toEqual([]);

  await ownerContext.close();
});
