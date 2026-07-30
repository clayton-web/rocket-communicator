import { test, expect, signInAsOwner } from '../support/fixtures';
import { seedCapabilityFixture } from '../support/capability-fixture';
import { readTaskNotes, readTaskState } from '../support/db-fixtures';
import type { Page } from '@playwright/test';

/**
 * Keyboard and focus behaviour of the Recipient confirmation dialogs (P1.5 / D119).
 *
 * D119 requires "explicit keyboard and focus-flow validation of both confirmation dialogs
 * including Escape and focus restoration". The Owner handoff dialog already met it. This
 * one, measured here before it was fixed, met none of it: focus stayed on the trigger behind
 * the backdrop so the first three Tab presses walked through the page's own action buttons,
 * Escape did nothing, and Cancel dropped focus onto `<body>`.
 *
 * This file exists because the component tests cannot settle those questions. jsdom does not
 * implement sequential focus navigation, so only a real browser can show where an ordinary
 * Tab press actually goes.
 *
 * Trace, screenshot, and video capture are disabled because the raw capability token appears
 * in the navigated URL and Playwright cannot redact it from a trace (D114).
 */
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

// Keyboard and focus semantics are viewport-independent; one project is sufficient evidence.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'keyboard contract: desktop only');
});

/**
 * Where focus is, relative to the dialog, plus enough to identify the control. Deliberately
 * not the element's text, which on this surface can carry Task content (D114).
 */
async function focusPosition(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { inDialog: false, tag: 'BODY', id: '' };
    return {
      inDialog: Boolean(el.closest('[role="dialog"]')),
      tag: el.tagName,
      id: el.id,
    };
  });
}

/** Whether the element with this id currently has focus. */
async function isFocused(page: Page, id: string) {
  return page.evaluate((value) => document.activeElement?.id === value, id);
}

/** Whether a paragraph carrying this text is the topmost node at its own centre. */
async function isReachable(page: Page, needle: string) {
  return page.evaluate((text) => {
    const node = [...document.querySelectorAll('p')].find((p) => p.textContent?.includes(text));
    if (!node) return false;
    const box = node.getBoundingClientRect();
    return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === node;
  }, needle);
}

/**
 * Give the trigger a stable id so focus restoration can be asserted against that exact
 * element rather than against "some button that looks right".
 */
async function tagTrigger(page: Page, name: string) {
  const id = `probe-trigger-${name.replaceAll(' ', '-')}`;
  await page.getByRole('button', { name, exact: true }).evaluate((el, value) => {
    el.id = value;
  }, id);
  return id;
}

/** Open a dialog the way a keyboard user does: focus the trigger, then press Enter. */
async function openWithKeyboard(page: Page, name: string) {
  const triggerId = await tagTrigger(page, name);
  await page.getByRole('button', { name, exact: true }).focus();
  expect(await isFocused(page, triggerId)).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  return triggerId;
}

test('every Recipient dialog opens from the keyboard onto a safe control', async ({
  page,
  browser,
}) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signInAsOwner(ownerPage);
  const fixture = await seedCapabilityFixture(ownerPage.request, 'cap-a11y-open');

  await page.goto(fixture.capability.capabilityPath);
  const dialog = page.getByRole('dialog');

  // Every action the panel offers, with the control focus must land on. `Return to owner`
  // is irreversible and still opens on its field, never on Confirm.
  const cases = [
    { trigger: 'Mark waiting', focusId: 'waiting-until' },
    { trigger: 'Complete', focusId: 'outcome-type' },
    { trigger: 'Add note', focusId: 'note-body' },
    { trigger: 'Request clarification', focusId: 'message-body' },
    { trigger: 'Return to owner', focusId: 'return-note' },
    { trigger: 'Submit work request', focusId: 'message-body' },
  ];

  for (const { trigger, focusId } of cases) {
    await openWithKeyboard(page, trigger);

    expect(await focusPosition(page), `${trigger}: focus should enter the dialog`).toMatchObject({
      inDialog: true,
      id: focusId,
    });

    // The dialog is named and described by copy the Recipient can also read.
    await expect(dialog).toHaveAccessibleName(trigger);
    await expect(dialog).toHaveAccessibleDescription(/\S/);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }

  await ownerContext.close();
});

test('Tab and Shift+Tab stay inside the dialog', async ({ page, browser }) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signInAsOwner(ownerPage);
  const fixture = await seedCapabilityFixture(ownerPage.request, 'cap-a11y-tab');

  await page.goto(fixture.capability.capabilityPath);
  await openWithKeyboard(page, 'Add note');

  // Ten presses is more than a full cycle of the dialog's three controls, so an escape
  // through the page behind it would be caught rather than merely not reached yet.
  const forward = [];
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.press('Tab');
    forward.push(await focusPosition(page));
  }
  expect(forward.every((position) => position.inDialog)).toBe(true);
  // It really is cycling, rather than parking on one control that swallows Tab.
  expect(new Set(forward.map((position) => `${position.tag}#${position.id}`)).size).toBeGreaterThan(
    1,
  );

  const backward = [];
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.press('Shift+Tab');
    backward.push(await focusPosition(page));
  }
  expect(backward.every((position) => position.inDialog)).toBe(true);

  await ownerContext.close();
});

test('Escape closes an idle dialog, sends nothing, and restores focus to the trigger', async ({
  page,
  browser,
}) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signInAsOwner(ownerPage);
  const fixture = await seedCapabilityFixture(ownerPage.request, 'cap-a11y-escape');

  const before = readTaskState(fixture.task.id);
  await page.goto(fixture.capability.capabilityPath);

  let mutations = 0;
  await page.route('**/api/v1/capabilities/**', (route) => {
    if (route.request().method() !== 'GET') {
      mutations += 1;
    }
    return route.continue();
  });

  const triggerId = await openWithKeyboard(page, 'Add note');
  await page.getByRole('dialog').getByLabel('Note', { exact: true }).fill('Typed then abandoned');

  await page.keyboard.press('Escape');

  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await isFocused(page, triggerId)).toBe(true);

  // Dismissing is not a submission, at the network and at the database.
  expect(mutations).toBe(0);
  expect(readTaskState(fixture.task.id)).toEqual(before);
  expect(readTaskNotes(fixture.task.id)).toEqual([]);

  await ownerContext.close();
});

test('Escape does not close a dialog whose request is still in flight', async ({
  page,
  browser,
}) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signInAsOwner(ownerPage);
  const fixture = await seedCapabilityFixture(ownerPage.request, 'cap-a11y-pending');

  await page.goto(fixture.capability.capabilityPath);

  // Hold the real mutation open. Nothing in the application is delayed; the request simply
  // is not answered while the assertions below run, which is what "pending" means here.
  let attempts = 0;
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/capabilities/**/notes', async (route) => {
    attempts += 1;
    await held;
    return route.continue();
  });

  await openWithKeyboard(page, 'Add note');
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Note', { exact: true }).fill('Held open');
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(dialog.getByRole('button', { name: 'Submitting…' })).toBeDisabled();

  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // An unresolved submission is never hidden behind a dialog that has closed itself.
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
  expect(attempts).toBe(1);

  release?.();
  await expect(dialog).toHaveCount(0);
  expect(attempts).toBe(1);

  await ownerContext.close();
});

test('an offline failure stays readable, keeps the draft, and then lets Escape close', async ({
  page,
  browser,
}) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signInAsOwner(ownerPage);
  const fixture = await seedCapabilityFixture(ownerPage.request, 'cap-a11y-offline');

  await page.goto(fixture.capability.capabilityPath);

  let attempts = 0;
  await page.route('**/api/v1/capabilities/**/notes', (route) => {
    attempts += 1;
    return route.abort('failed');
  });

  const triggerId = await openWithKeyboard(page, 'Add note');
  const dialog = page.getByRole('dialog');
  const note = dialog.getByLabel('Note', { exact: true });
  await note.fill('Offline draft');

  await page.context().setOffline(true);
  await dialog.getByRole('button', { name: 'Confirm' }).click();

  // Perceivable, not merely present: the backdrop used to cover this message entirely.
  await expect(dialog.getByText('was not sent')).toBeVisible();
  expect(await isReachable(page, 'was not sent')).toBe(true);
  expect(attempts).toBe(0);

  await expect(note).toHaveValue('Offline draft');
  await expect(dialog.getByRole('button', { name: 'Confirm' })).toBeEnabled();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await isFocused(page, triggerId)).toBe(true);

  await page.context().setOffline(false);
  await page.waitForTimeout(400);
  // Coming back online is not a submission, and nothing is replayed on its behalf.
  expect(attempts).toBe(0);
  expect(readTaskNotes(fixture.task.id)).toEqual([]);

  await ownerContext.close();
});

test('an ambiguous failure stays readable, keeps the draft, and then lets Escape close', async ({
  page,
  browser,
}) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signInAsOwner(ownerPage);
  const fixture = await seedCapabilityFixture(ownerPage.request, 'cap-a11y-ambiguous');

  await page.goto(fixture.capability.capabilityPath);
  await page.route('**/api/v1/capabilities/**/notes', (route) => route.abort('failed'));

  const triggerId = await openWithKeyboard(page, 'Add note');
  const dialog = page.getByRole('dialog');
  const note = dialog.getByLabel('Note', { exact: true });
  await note.fill('Ambiguous draft');
  await dialog.getByRole('button', { name: 'Confirm' }).click();

  await expect(dialog.getByText('may or may not have been saved')).toBeVisible();
  expect(await isReachable(page, 'may or may not have been saved')).toBe(true);

  await expect(note).toHaveValue('Ambiguous draft');

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await isFocused(page, triggerId)).toBe(true);

  // Closing does not resolve the uncertainty in either direction.
  await expect(page.getByText('may or may not have been saved')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /^Saved\.$/ })).toHaveCount(0);

  await ownerContext.close();
});

test('a confirmed action still succeeds, with focus left somewhere meaningful', async ({
  page,
  browser,
}) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signInAsOwner(ownerPage);
  const fixture = await seedCapabilityFixture(ownerPage.request, 'cap-a11y-success');

  await page.goto(fixture.capability.capabilityPath);

  let ownerAuth = 0;
  page.on('console', (message) => {
    if (message.text().includes('owner_authentication')) {
      ownerAuth += 1;
    }
  });

  const triggerId = await openWithKeyboard(page, 'Add note');
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Note', { exact: true }).fill('Confirmed note');
  await dialog.getByRole('button', { name: 'Confirm' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: /Saved/ })).toBeVisible();
  expect(readTaskNotes(fixture.task.id)).toHaveLength(1);

  // The trigger survives this action, so focus goes back to it rather than to `<body>`.
  expect(await isFocused(page, triggerId)).toBe(true);

  // Still the Recipient surface: no Owner chrome, no Owner identity work.
  await expect(page.locator('[data-owner-shell]')).toHaveCount(0);
  await expect(page.locator('nav[aria-label="Owner"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  expect(ownerAuth).toBe(0);

  await ownerContext.close();
});

test('reloading the capability page changes nothing', async ({ page, browser }) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signInAsOwner(ownerPage);
  const fixture = await seedCapabilityFixture(ownerPage.request, 'cap-a11y-get');

  const before = readTaskState(fixture.task.id);
  await page.goto(fixture.capability.capabilityPath);
  await expect(page.getByRole('heading', { level: 1, name: 'Assigned task' })).toBeVisible();

  // Opening and dismissing dialogs is a read-only exercise of the surface.
  await openWithKeyboard(page, 'Complete');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Assigned task' })).toBeVisible();

  expect(readTaskState(fixture.task.id)).toEqual(before);
  expect(readTaskNotes(fixture.task.id)).toEqual([]);

  await ownerContext.close();
});
