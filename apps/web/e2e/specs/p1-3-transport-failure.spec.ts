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

/**
 * Recipient connectivity feedback (P1.5 / D112 clause 5).
 *
 * The spec above proves the ambiguous *wording*. What it could not prove is that anyone sees
 * it: `toBeVisible()` does not test occlusion, and the message used to render underneath the
 * confirmation dialog's backdrop. These add the reachability check and the case the ambiguous
 * path was previously swallowing — a browser that is definitely offline, where nothing is
 * dispatched and the outcome is a fact rather than a possibility.
 */
test.describe('Recipient connectivity feedback', () => {
  /** The outcome message must be the topmost element at its own centre, not behind the modal. */
  async function outcomeIsReachable(page: import('@playwright/test').Page, needle: string) {
    return page.evaluate((text) => {
      const node = [...document.querySelectorAll('p')].find((p) => p.textContent?.includes(text));
      if (!node) return false;
      const box = node.getBoundingClientRect();
      return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === node;
    }, needle);
  }

  test('an offline submission is never dispatched and never called uncertain', async ({
    page,
    browser,
  }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await signInAsOwner(ownerPage);
    const fixture = await seedCapabilityFixture(ownerPage.request, 'cap-offline');

    const before = readTaskState(fixture.task.id);
    await page.goto(fixture.capability.capabilityPath);

    let attempts = 0;
    await page.route('**/api/v1/capabilities/**/notes', (route) => {
      attempts += 1;
      return route.continue();
    });

    const dialog = page.getByRole('dialog');
    await page.getByRole('button', { name: 'Add note' }).click();
    await dialog.getByLabel('Note', { exact: true }).fill(`${fixture.taskTitle} offline note`);

    await page.context().setOffline(true);
    await dialog.getByRole('button', { name: 'Confirm' }).click();

    await expect(page.getByText(/offline, so this was not sent/i)).toBeVisible();
    // Nothing left the browser, which is what makes "was not sent" a fact.
    expect(attempts).toBe(0);
    await expect(page.getByText('may or may not have been saved')).toHaveCount(0);

    // Readable rather than merely present: this is the assertion the earlier spec lacked.
    expect(await outcomeIsReachable(page, 'was not sent')).toBe(true);

    // The draft survives and the control is usable for a deliberate later attempt.
    await expect(dialog.getByLabel('Note', { exact: true })).toHaveValue(
      `${fixture.taskTitle} offline note`,
    );
    await expect(dialog.getByRole('button', { name: 'Confirm' })).toBeEnabled();

    // Returning online is not a submission, and nothing is replayed on its behalf.
    await page.context().setOffline(false);
    await page.waitForTimeout(500);
    expect(attempts).toBe(0);
    await expect(page.getByText(/offline, so this was not sent/i)).toBeVisible();

    expect(readTaskState(fixture.task.id)).toEqual(before);
    expect(readTaskNotes(fixture.task.id)).toEqual([]);

    await ownerContext.close();
  });

  test('an unconfirmed submission reports where the Recipient can actually read it', async ({
    page,
    browser,
  }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await signInAsOwner(ownerPage);
    const fixture = await seedCapabilityFixture(ownerPage.request, 'cap-ambiguous-visible');

    await page.goto(fixture.capability.capabilityPath);
    await page.route('**/api/v1/capabilities/**/notes', (route) => route.abort('failed'));

    const dialog = page.getByRole('dialog');
    await page.getByRole('button', { name: 'Add note' }).click();
    await dialog.getByLabel('Note', { exact: true }).fill(`${fixture.taskTitle} unreadable`);
    await dialog.getByRole('button', { name: 'Confirm' }).click();

    await expect(page.getByText('may or may not have been saved')).toBeVisible();
    expect(await outcomeIsReachable(page, 'may or may not have been saved')).toBe(true);

    /*
     * Aborting after dispatch is indistinguishable, from the browser, from a response lost on
     * the way back — which is the point. The harness cannot establish whether the server
     * committed, and neither can the client; that is precisely why the copy claims neither.
     * Here the route was aborted before reaching the server, so the note is in fact absent,
     * but nothing in the UI is permitted to depend on knowing that.
     */
    await expect(dialog.getByRole('button', { name: 'Confirm' })).toBeEnabled();
    await expect(page.getByRole('button', { name: /retry|resend/i })).toHaveCount(0);
    expect(readTaskNotes(fixture.task.id)).toEqual([]);

    await ownerContext.close();
  });

  test('a confirmed action still succeeds and leaves the surface chrome-free', async ({
    page,
    browser,
  }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await signInAsOwner(ownerPage);
    const fixture = await seedCapabilityFixture(ownerPage.request, 'cap-online-success');
    const noteBody = `${fixture.taskTitle} confirmed note`;

    await page.goto(fixture.capability.capabilityPath);
    const dialog = page.getByRole('dialog');
    await page.getByRole('button', { name: 'Add note' }).click();
    await dialog.getByLabel('Note', { exact: true }).fill(noteBody);
    await dialog.getByRole('button', { name: 'Confirm' }).click();

    await expect(page.getByRole('status').filter({ hasText: /^Saved\.$/ })).toBeVisible();
    await expect(page.getByText(noteBody)).toBeVisible();
    expect(readTaskNotes(fixture.task.id).filter((note) => note.body === noteBody)).toHaveLength(1);

    // Still the Recipient surface: no Owner chrome arrived with the connectivity handling.
    await expect(page.locator('[data-owner-shell]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);

    await ownerContext.close();
  });
});
