import { test, expect, uniqueLabel } from '../support/fixtures';
import { createTask } from '../support/owner-api';
import {
  REMINDER_STOP_EVENT_TYPE,
  clearOwnerNotifications,
  clearReminderSchedules,
  seedUndeliveredNotification,
} from '../support/db-fixtures';

/**
 * A8.6c `/attention` section two, in the browser (D112, D133–D135).
 *
 * The section answers one question the product has no other way to answer: what happened that
 * Rocket could not tell you about? These tests exercise the answer end to end — a real intent row,
 * the page's own query, the real projection — because the failure modes that matter are all about
 * what the rendered sentence says, and none of them are visible from a unit test of any single
 * layer.
 *
 * Every row is seeded, and has to be. Reaching a terminal undelivered state through the product
 * would require `ENABLE_OWNER_EVENT_CAPTURE`, `ENABLE_OWNER_EVENT_DELIVERY`, and a Gmail send that
 * fails. All three flags stay unset here; no worker runs, and no markup is injected.
 */

const SECTION_HEADING = 'Things Rocket could not tell you about';

test('an empty section says nothing went undelivered, and offers nothing to do about it', async ({
  ownerPage,
  diagnostics,
}) => {
  clearReminderSchedules();
  clearOwnerNotifications();

  // A Task exists, so an empty section cannot be explained away by an empty database.
  await createTask(ownerPage.request, 'Fixture point', uniqueLabel('missed-empty'));

  await ownerPage.goto('/attention');

  await expect(ownerPage.getByRole('heading', { level: 2, name: SECTION_HEADING })).toBeVisible();
  await expect(
    ownerPage
      .getByRole('status')
      .filter({ hasText: 'no undelivered notifications from the last 30 days' }),
  ).toBeVisible();

  /*
   * The retirement rule, stated rather than implied. Items leave only by ageing out, so an Owner
   * who returns to find one gone must not read that as having dealt with it.
   */
  const body = (await ownerPage.locator('main').innerText()).toLowerCase();
  expect(body).toContain('nothing to mark as read');
  expect(body).toContain('30 days');

  expect(diagnostics.consoleErrors).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
});

test('an undelivered notification names the event, the outcome, and the Task', async ({
  ownerPage,
  diagnostics,
}) => {
  clearReminderSchedules();
  clearOwnerNotifications();

  const summary = uniqueLabel('Confirm the caterer headcount');
  const task = await createTask(ownerPage.request, 'Fixture point', summary);
  seedUndeliveredNotification({
    taskId: task.id,
    eventType: 'task_completed_by_recipient',
    state: 'failed_permanent',
    actorKind: 'capability',
  });

  await ownerPage.goto('/attention');

  const item = ownerPage.getByRole('main').getByRole('listitem').filter({ hasText: summary });
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('This Task was marked complete.');
  await expect(item).toContainText('Not sent');
  await expect(item).toContainText('Rocket tried to email you about this');
  // The ratified actor mapping, not a Recipient's name or address.
  await expect(item).toContainText('Caused by: The Recipient');

  // The link goes to the authenticated Owner Task route and nowhere else.
  await item.getByRole('link').click();
  await expect(ownerPage).toHaveURL(new RegExp(`/tasks/${task.id}$`));

  expect(diagnostics.consoleErrors).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
});

test('a suppressed notification says Rocket chose not to send, not that sending failed', async ({
  ownerPage,
  diagnostics,
}) => {
  clearReminderSchedules();
  clearOwnerNotifications();

  const summary = uniqueLabel('Return the signed lease');
  const task = await createTask(ownerPage.request, 'Fixture point', summary);
  seedUndeliveredNotification({
    taskId: task.id,
    eventType: 'task_clarification_requested',
    state: 'suppressed',
    suppressionReason: 'channel_unavailable',
    actorKind: 'capability',
  });

  await ownerPage.goto('/attention');

  const item = ownerPage.getByRole('main').getByRole('listitem').filter({ hasText: summary });
  const text = (await item.innerText()).toLowerCase();
  expect(text).toContain('did not send');
  expect(text).toContain('no connected gmail account');
  // A suppression is a decision, not a failed attempt. Saying otherwise sends the Owner to fix
  // a mailbox that is working.
  for (const overclaim of ['tried to email', 'several times', 'could not confirm']) {
    expect(text).not.toContain(overclaim);
  }

  expect(diagnostics.consoleErrors).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
});

test('an ambiguous outcome refuses to claim the email did or did not arrive', async ({
  ownerPage,
  diagnostics,
}) => {
  clearReminderSchedules();
  clearOwnerNotifications();

  const summary = uniqueLabel('Chase the permit office');
  const task = await createTask(ownerPage.request, 'Fixture point', summary);
  seedUndeliveredNotification({
    taskId: task.id,
    eventType: 'task_returned_to_owner',
    state: 'ambiguous',
    actorKind: 'system',
  });

  await ownerPage.goto('/attention');

  const item = ownerPage.getByRole('main').getByRole('listitem').filter({ hasText: summary });
  await expect(item).toContainText('Delivery unknown');
  const text = (await item.innerText()).toLowerCase();
  expect(text).toContain('could not confirm whether this email was sent');
  expect(text).toContain('may have received it');
  for (const overclaim of ['was not sent', 'did not arrive', 'never sent']) {
    expect(text).not.toContain(overclaim);
  }
  // A system-attributed event is caused by Rocket, and the web surface says Rocket.
  await expect(item).toContainText('Caused by: Rocket');
  expect(text).not.toContain('your assistant');

  expect(diagnostics.consoleErrors).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
});

test('a delivered notification never appears, and neither does a reminder stop', async ({
  ownerPage,
  diagnostics,
}) => {
  clearReminderSchedules();
  clearOwnerNotifications();

  const deliveredSummary = uniqueLabel('Already emailed about');
  const delivered = await createTask(ownerPage.request, 'Fixture point', deliveredSummary);
  seedUndeliveredNotification({ taskId: delivered.id, state: 'sent' });

  const stopSummary = uniqueLabel('Reminders already on the list above');
  const stopped = await createTask(ownerPage.request, 'Fixture point', stopSummary);
  seedUndeliveredNotification({
    taskId: stopped.id,
    eventType: REMINDER_STOP_EVENT_TYPE,
    state: 'failed_permanent',
    actorKind: 'system',
  });

  await ownerPage.goto('/attention');

  /*
   * `sent` is excluded because the Owner already has that email; showing it would make this an
   * inbox. Reminder stops are excluded because section one already shows the condition and, unlike
   * a terminal intent, stops showing it once the Owner repairs the schedule — an unfiltered list
   * would keep announcing a stop that had already been fixed.
   */
  await expect(
    ownerPage.getByRole('main').getByRole('listitem').filter({ hasText: deliveredSummary }),
  ).toHaveCount(0);
  await expect(
    ownerPage.getByRole('main').getByRole('listitem').filter({ hasText: stopSummary }),
  ).toHaveCount(0);
  await expect(
    ownerPage
      .getByRole('status')
      .filter({ hasText: 'no undelivered notifications from the last 30 days' }),
  ).toBeVisible();

  expect(diagnostics.consoleErrors).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
});

test('an event older than the window is gone, which is the only way an item leaves', async ({
  ownerPage,
  diagnostics,
}) => {
  clearReminderSchedules();
  clearOwnerNotifications();

  const recentSummary = uniqueLabel('Inside the window');
  const recent = await createTask(ownerPage.request, 'Fixture point', recentSummary);
  seedUndeliveredNotification({
    taskId: recent.id,
    occurredAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const oldSummary = uniqueLabel('Outside the window');
  const old = await createTask(ownerPage.request, 'Fixture point', oldSummary);
  seedUndeliveredNotification({
    taskId: old.id,
    occurredAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
  });

  await ownerPage.goto('/attention');

  await expect(
    ownerPage.getByRole('main').getByRole('listitem').filter({ hasText: recentSummary }),
  ).toHaveCount(1);
  await expect(
    ownerPage.getByRole('main').getByRole('listitem').filter({ hasText: oldSummary }),
  ).toHaveCount(0);

  expect(diagnostics.consoleErrors).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
});

test('the section offers no resend, dismissal, or acknowledgement', async ({
  ownerPage,
  diagnostics,
}) => {
  clearReminderSchedules();
  clearOwnerNotifications();

  const summary = uniqueLabel('Nothing to do here');
  const task = await createTask(ownerPage.request, 'Fixture point', summary);
  seedUndeliveredNotification({ taskId: task.id, state: 'requires_owner_attention' });

  await ownerPage.goto('/attention');

  const item = ownerPage.getByRole('main').getByRole('listitem').filter({ hasText: summary });
  await expect(item).toHaveCount(1);
  // The only control on an item is the Task link. Rocket will not try again, and no ratified
  // policy would let it, so a control implying otherwise would be a promise it cannot keep.
  await expect(item.getByRole('button')).toHaveCount(0);
  await expect(item.getByRole('link')).toHaveCount(1);

  const body = (await ownerPage.locator('main').innerText()).toLowerCase();
  for (const control of ['resend', 'send again', 'try again', 'dismiss', 'mark as read']) {
    expect(body).not.toContain(control);
  }
  // No internal vocabulary and no Recipient identity reaches the Owner.
  for (const jargon of ['intent', 'claim', 'lease', 'occurrence', 'attempt', 'provider']) {
    expect(body).not.toContain(jargon);
  }
  expect(body).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/);

  expect(diagnostics.consoleErrors).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
});
