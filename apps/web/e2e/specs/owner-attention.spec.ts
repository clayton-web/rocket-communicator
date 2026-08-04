import { test, expect, uniqueLabel } from '../support/fixtures';
import { createTask } from '../support/owner-api';
import {
  clearOwnerNotifications,
  clearReminderSchedules,
  stopReminderScheduleForAttention,
} from '../support/db-fixtures';

/**
 * A8.6a attention surface (D108, D112, D118).
 *
 * ## What replaced the P1.4 assertions
 *
 * This spec used to prove the page was *intentionally* empty: it read nothing, and its copy was
 * checked against a word list that included "reminder" and "scheduled", because in P1.4 any such
 * word would have been an invented claim about machinery that did not exist.
 *
 * A8.6a makes that page read, and the subject it reads about is reminders. So the old assertion
 * cannot simply be kept — its premise is gone — and it must not simply be deleted either, because
 * the thing it was protecting is still true and still worth protecting. The truth has narrowed
 * rather than disappeared:
 *
 *   - P1.4: the page claims nothing, because it does nothing.
 *   - A8.6a: the page reports what one bounded query returned, and claims nothing beyond that.
 *
 * What survives is every negative assertion about *ongoing* behaviour — no monitoring, no queue, no
 * alerting, no automatic refresh — because none of that was built and none of it is true. What is
 * dropped is the ban on reminder vocabulary, which now describes the page's actual subject.
 */

/** Affirmative operational claims the page must never make, in either state. */
const FORBIDDEN_CLAIMS = [
  'monitoring',
  'is monitored',
  'we watch',
  'watching',
  'alerts you',
  'we will alert',
  'notifies you',
  'we will notify',
  'we will let you know',
  'in the queue',
  'queued',
  'updates automatically',
  'automatically updates',
  'up to date',
  'checking',
  'syncing',
] as const;

test('an empty attention surface is truthful and claims no automation', async ({
  ownerPage,
  diagnostics,
}) => {
  clearReminderSchedules();
  // A8.6c added a second section to this page, and both of this test's whole-list assertions now
  // span it. A notification left by another spec would falsify them.
  clearOwnerNotifications();

  // A Task exists, so an empty page cannot be explained away by an empty database.
  await createTask(ownerPage.request, 'Fixture point', uniqueLabel('attention'));

  await ownerPage.goto('/attention');

  await expect(ownerPage.getByRole('heading', { level: 1, name: 'Attention' })).toBeVisible();
  await expect(
    ownerPage.getByRole('status').filter({ hasText: 'No reminder schedule needs your attention.' }),
  ).toBeVisible();

  const body = (await ownerPage.locator('main').innerText()).toLowerCase();
  for (const claim of FORBIDDEN_CLAIMS) {
    expect(body).not.toContain(claim);
  }

  // The page states its own limits rather than leaving them to be inferred.
  expect(body).toContain('does not monitor anything');

  /*
   * Scope honesty, moved rather than dropped.
   *
   * Until A8.6c this list owned the page and had to qualify its heading — "covers reminder
   * automation only" — because "Attention" over a reminder-only list implied the absence of
   * everything else. The page now has two sections, so the same requirement is met by each naming
   * its own subject in a heading, and the old sentence would have become false.
   */
  await expect(
    ownerPage.getByRole('heading', { level: 2, name: 'Reminder schedules that stopped' }),
  ).toBeVisible();

  // No list and no count while nothing needs attention. Scoped to `main`: the shell navigation is
  // itself a list, so an unscoped assertion would measure the chrome rather than the page.
  await expect(ownerPage.getByRole('main').getByRole('listitem')).toHaveCount(0);
  expect(body).not.toMatch(/\b\d+\s+(task|item|pending|due|overdue)/i);

  expect(diagnostics.consoleErrors).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
});

test('a stopped reminder schedule is discoverable without opening the Task', async ({
  ownerPage,
  diagnostics,
}) => {
  clearReminderSchedules();
  clearOwnerNotifications();

  const summary = uniqueLabel('Confirm the site visit window');
  const task = await createTask(ownerPage.request, 'Fixture point', summary);
  stopReminderScheduleForAttention({
    taskId: task.id,
    dueLocalDate: '2026-08-10',
    stopReason: 'repeated_ambiguous_outcomes',
  });

  await ownerPage.goto('/attention');

  // The whole point of the surface: the Owner learns this from the list, not from the Task.
  const item = ownerPage.getByRole('main').getByRole('listitem').filter({ hasText: summary });
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('Reminders stopped because delivery could not be confirmed.');
  await expect(item).toContainText('Aug 10, 2026');

  /*
   * D129's distinction, checked in the browser because this is the sentence an Owner acts on.
   * Rocket could not confirm delivery; it does not know the reminder was missed.
   */
  const itemText = (await item.innerText()).toLowerCase();
  expect(itemText).toContain('may or may not have received');
  for (const overclaim of ['did not receive', 'was not delivered', 'never received']) {
    expect(itemText).not.toContain(overclaim);
  }

  // The link goes to the authenticated Owner Task route and nowhere else.
  await item.getByRole('link').click();
  await expect(ownerPage).toHaveURL(new RegExp(`/tasks/${task.id}$`));

  // Still no operational claim, now that the page has something to report.
  await ownerPage.goto('/attention');
  const body = (await ownerPage.locator('main').innerText()).toLowerCase();
  for (const claim of FORBIDDEN_CLAIMS) {
    expect(body).not.toContain(claim);
  }

  // No internal vocabulary reaches the Owner.
  for (const jargon of ['generation', 'claim', 'lease', 'occurrence', 'etag', 'worker']) {
    expect(body).not.toContain(jargon);
  }

  expect(diagnostics.consoleErrors).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
});

test('the attention destination is authenticated like every other Owner route', async ({
  page,
}) => {
  await page.goto('/attention');

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { level: 1, name: 'Attention' })).toHaveCount(0);
});
