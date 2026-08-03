import { test, expect, uniqueLabel } from '../support/fixtures';
import { completeTask, createTask, getTask } from '../support/owner-api';
import { clearReminderSchedules, stopReminderScheduleForAttention } from '../support/db-fixtures';

/**
 * A8.6b Task-level reminder status and repair (D104, D107, D108, D129).
 *
 * The unit suite proves each state and each mutation outcome in isolation against a mocked client.
 * What only a browser can prove is that the pieces meet: the panel is server-rendered with real
 * reminder state, a real `PUT` reaches the real route with the reminder ETag, the authoritative
 * response replaces the panel, and the Owner arriving from `/attention` finds an explanation that
 * matches the one that sent them there.
 *
 * Every schedule here is created through the panel or seeded directly. No reminder is ever
 * delivered: `ENABLE_REMINDER_DELIVERY` is unset, there is no cron, and nothing in this file
 * contacts a mail provider.
 */

/** Internal vocabulary that must never reach an Owner, checked against the rendered panel. */
const FORBIDDEN_JARGON = [
  'generation',
  'claimedby',
  'lease',
  'fencing',
  'reminderversion',
  'etag',
  'prisma',
  'scheduler',
] as const;

/** Controls that would conflict with D129 or promise an action no endpoint performs. */
const FORBIDDEN_CONTROLS = [/resend/i, /send now/i, /send again/i, /retry/i, /force/i] as const;

async function panelOf(page: import('@playwright/test').Page) {
  return page.getByRole('region', { name: 'Reminders' });
}

test('an Owner sets a first due date and the panel adopts the server’s state', async ({
  ownerPage,
  diagnostics,
}) => {
  const task = await createTask(
    ownerPage.request,
    'Fixture point',
    uniqueLabel('Book the inspection'),
  );

  await ownerPage.goto(`/tasks/${task.id}`);

  const panel = await panelOf(ownerPage);
  await expect(panel.getByText('No reminders are scheduled for this Task.')).toBeVisible();

  // A first due date is not a restart, so nothing is disclosed.
  await panel.getByLabel(/set a reminder due date/i).fill('2026-09-15');
  await expect(panel.getByText(/starts a new reminder cycle/)).toHaveCount(0);

  await panel.getByRole('button', { name: 'Set reminder due date' }).click();

  await expect(panel.getByText(/Due date saved/)).toBeVisible();
  await expect(panel.getByText('Sep 15, 2026')).toBeVisible();
  await expect(panel.getByText('Reminders are scheduled for this Task.')).toBeVisible();

  /*
   * The claim the panel must never make. Saving a schedule is not sending a reminder, and with
   * delivery disabled nothing has been sent at all.
   */
  await expect(panel.getByText(/no reminder has been sent by saving it/)).toBeVisible();

  // The state survives a reload, which proves the server holds it rather than the browser.
  await ownerPage.reload();
  await expect((await panelOf(ownerPage)).getByText('Sep 15, 2026')).toBeVisible();

  expect(diagnostics.consoleErrors).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
});

test('changing an existing due date discloses the cycle restart before it is saved', async ({
  ownerPage,
  diagnostics,
}) => {
  const task = await createTask(
    ownerPage.request,
    'Fixture point',
    uniqueLabel('Chase the permit'),
  );

  await ownerPage.goto(`/tasks/${task.id}`);
  const panel = await panelOf(ownerPage);

  await panel.getByLabel(/set a reminder due date/i).fill('2026-09-15');
  await panel.getByRole('button', { name: 'Set reminder due date' }).click();
  await expect(panel.getByText(/Due date saved/)).toBeVisible();

  // Same date again: the server treats it as a no-op, so no restart may be promised.
  await panel.getByRole('button', { name: 'Save reminder due date' }).click();
  await expect(panel.getByText(/already this Task’s due date, so nothing changed/)).toBeVisible();

  // A different date is a material change (D104), disclosed before submission.
  await panel.getByLabel(/reminder due date/i).fill('2026-10-01');
  const disclosure = panel.getByText(/Saving this starts a new reminder cycle/);
  await expect(disclosure).toBeVisible();
  await expect(disclosure).toContainText('back to zero');
  await expect(disclosure).toContainText('worked out again from the new date');

  await panel.getByRole('button', { name: 'Save reminder due date' }).click();
  await expect(panel.getByText(/Due date saved/)).toBeVisible();
  await expect(panel.getByText('Oct 1, 2026')).toBeVisible();

  expect(diagnostics.consoleErrors).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
});

test('removing a due date requires confirmation and stops the schedule', async ({
  ownerPage,
  diagnostics,
}) => {
  const task = await createTask(ownerPage.request, 'Fixture point', uniqueLabel('Return the keys'));

  await ownerPage.goto(`/tasks/${task.id}`);
  const panel = await panelOf(ownerPage);
  await panel.getByLabel(/set a reminder due date/i).fill('2026-09-15');
  await panel.getByRole('button', { name: 'Set reminder due date' }).click();
  await expect(panel.getByText(/Due date saved/)).toBeVisible();

  await panel.getByRole('button', { name: 'Remove reminder due date' }).click();

  const dialog = ownerPage.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('current reminder cycle will stop');
  await expect(dialog).toContainText('cannot recall an email');

  // Gated until the Owner confirms explicitly.
  const confirm = dialog.getByRole('button', { name: 'Remove reminder due date' });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await confirm.click();

  await expect(ownerPage.getByRole('dialog')).toHaveCount(0);
  await expect(panel.getByText(/Due date removed/)).toBeVisible();

  /*
   * Removal *stops* the schedule; it does not erase it. The domain keeps the row with stop reason
   * `due_date_removed` so the reminder history stays inspectable, so the truthful end state is
   * "reminders ended", not "no reminders are scheduled". Asserting the latter would have quietly
   * required the panel to invent a state the server never returned.
   */
  await expect(panel.getByText('Reminders ended when the due date was removed.')).toBeVisible();
  await expect(panel.getByText(/Set a due date again to start a new reminder cycle/)).toBeVisible();

  // Durable, not just a client-side banner.
  await ownerPage.reload();
  await expect(
    (await panelOf(ownerPage)).getByText('Reminders ended when the due date was removed.'),
  ).toBeVisible();

  expect(diagnostics.consoleErrors).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
});

/*
 * The repair journey the milestone exists for: discover on `/attention`, understand on the Task,
 * act, and see the durable condition clear from a fresh read of the list.
 */
test('an Owner repairs a stopped schedule discovered on the attention surface', async ({
  ownerPage,
  diagnostics,
}) => {
  clearReminderSchedules();

  const summary = uniqueLabel('Confirm the delivery window');
  const task = await createTask(ownerPage.request, 'Fixture point', summary);
  stopReminderScheduleForAttention({
    taskId: task.id,
    dueLocalDate: '2026-08-10',
    stopReason: 'repeated_ambiguous_outcomes',
  });

  await ownerPage.goto('/attention');
  const item = ownerPage.getByRole('main').getByRole('listitem').filter({ hasText: summary });
  const listExplanation = 'Reminders stopped because delivery could not be confirmed.';
  await expect(item).toContainText(listExplanation);

  await item.getByRole('link').click();
  await expect(ownerPage).toHaveURL(new RegExp(`/tasks/${task.id}$`));

  /*
   * The Task must explain the same condition in the same words. Two different sentences for one
   * stop would read as two different problems.
   */
  const panel = await panelOf(ownerPage);
  await expect(panel.getByText(listExplanation)).toBeVisible();
  await expect(panel.getByText(/may or may not have received/)).toBeVisible();
  await expect(panel.getByText(/Setting a due date starts a new reminder cycle/)).toBeVisible();

  // Repair is a due-date change, and it is disclosed as a restart even for the same date (D109).
  await panel.getByLabel(/reminder due date/i).fill('2026-09-20');
  await expect(panel.getByText(/Saving this starts a new reminder cycle/)).toBeVisible();
  await panel.getByRole('button', { name: 'Save reminder due date' }).click();
  await expect(panel.getByText(/Due date saved/)).toBeVisible();
  await expect(panel.getByText('Reminders are scheduled for this Task.')).toBeVisible();

  /*
   * The condition clears from a fresh read of durable state, not from client state carried across
   * pages. This navigation re-runs the server query that built the list.
   */
  await ownerPage.goto('/attention');
  await expect(
    ownerPage.getByRole('main').getByRole('listitem').filter({ hasText: summary }),
  ).toHaveCount(0);

  expect(diagnostics.consoleErrors).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
});

test('a completed Task explains why its due date is locked instead of offering a dead control', async ({
  ownerPage,
  diagnostics,
}) => {
  const task = await createTask(
    ownerPage.request,
    'Fixture point',
    uniqueLabel('File the closing report'),
  );

  await ownerPage.goto(`/tasks/${task.id}`);
  const panel = await panelOf(ownerPage);
  await panel.getByLabel(/set a reminder due date/i).fill('2026-09-15');
  await panel.getByRole('button', { name: 'Set reminder due date' }).click();
  await expect(panel.getByText(/Due date saved/)).toBeVisible();

  /*
   * Re-read before completing. Setting the due date through the panel did not bump `Task.version`
   * — that is exactly why reminders carry their own ETag — but the Task fixture is stale for other
   * reasons, and completion needs the current Task token.
   */
  const current = await getTask(ownerPage.request, task.id);
  await completeTask(ownerPage.request, current, 'completed');

  await ownerPage.goto(`/tasks/${task.id}`);
  const locked = await panelOf(ownerPage);

  await expect(
    locked.getByText(/This Task is completed, so its due date can no longer be changed/),
  ).toBeVisible();
  await expect(locked.getByLabel(/reminder due date/i)).toHaveCount(0);
  // Removal survives, because the server permits it on any status.
  await expect(locked.getByRole('button', { name: 'Remove reminder due date' })).toBeVisible();

  expect(diagnostics.consoleErrors).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
});

test('the panel offers no resend control and no internal vocabulary in any state', async ({
  ownerPage,
}) => {
  clearReminderSchedules();

  const task = await createTask(
    ownerPage.request,
    'Fixture point',
    uniqueLabel('Vocabulary check'),
  );
  stopReminderScheduleForAttention({
    taskId: task.id,
    dueLocalDate: '2026-08-10',
    stopReason: 'overdue_ceiling_reached',
  });

  await ownerPage.goto(`/tasks/${task.id}`);
  const panel = await panelOf(ownerPage);
  const text = (await panel.innerText()).toLowerCase();

  for (const jargon of FORBIDDEN_JARGON) {
    expect(text, `"${jargon}" reached the Owner`).not.toContain(jargon);
  }
  for (const control of FORBIDDEN_CONTROLS) {
    await expect(panel.getByRole('button', { name: control })).toHaveCount(0);
  }
});
