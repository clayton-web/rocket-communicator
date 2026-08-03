import { test, expect, signInAsOwner, uniqueLabel } from '../support/fixtures';
import { seedCapabilityFixture } from '../support/capability-fixture';
import { createRecipient, createTask, getTask } from '../support/owner-api';
import { clearReminderSchedules, stopReminderScheduleForAttention } from '../support/db-fixtures';
import { expectNoSeriousOrCriticalViolations } from '../support/accessibility';
import { E2E_WORKSPACE_DOMAIN } from '../config/e2e-env';
import type { Page } from '@playwright/test';

/**
 * The D119 automated accessibility gate: zero serious or critical findings on the current P1
 * routes and interaction states.
 *
 * Scope comes from MILESTONES.md, which names the Owner web routes (`/`, `/login`, `/tasks`,
 * `/tasks/{taskId}`, plus `/attention` added in P1.4) and the Recipient capability surface
 * (`/c/{token}`). The interaction states are the ones earlier P1.5 stages built and that
 * D119 calls out by name: both confirmation dialogs, the loading boundaries, and the
 * unavailable-link presentation.
 *
 * Every state below is reached through the ordinary user path. Nothing is scanned by
 * injecting markup, and no production hook, debug parameter, or artificial server delay was
 * added to make a state reachable.
 *
 * Trace, screenshot, and video capture are disabled because the raw capability token appears
 * in the navigated URL and Playwright cannot redact it from a trace (D114).
 */
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

/**
 * The authorized matrix, named so a failure says which surface it came from and so the
 * covered set is readable without running anything.
 */
export const SCANNED_STATES = [
  'Signed-out landing page',
  'Login page',
  'Owner task list',
  'Owner task list (loading)',
  'Owner task detail',
  'Owner reminder panel (no due date)',
  'Owner reminder panel (active schedule)',
  'Owner reminder panel (Waiting, suspended)',
  'Owner reminder panel (stopped, needs attention)',
  'Owner reminder panel (removal confirmation)',
  'Owner reminder panel (stale state resolved)',
  'Owner attention list (empty)',
  'Owner attention list (populated)',
  'Owner handoff dialog (open)',
  'Recipient capability panel',
  'Recipient capability panel (loading)',
  'Recipient link unavailable',
  'Recipient dialog with input (open)',
  'Recipient dialog without input (open)',
  'Recipient dialog showing a failure',
  'Recipient returned terminal state',
] as const;

/** Throttle the transport so a loading boundary paints, without delaying the application. */
async function throttle(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 700,
    downloadThroughput: (12 * 1024) / 8,
    uploadThroughput: (12 * 1024) / 8,
  });
  return async () => {
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await cdp.detach();
  };
}

test.describe('D119 accessibility gate — Owner surfaces', () => {
  test('signed-out landing page and login page', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoSeriousOrCriticalViolations(page, 'Signed-out landing page');

    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
    await expectNoSeriousOrCriticalViolations(page, 'Login page');
  });

  test('task list, task detail, and attention list', async ({ ownerPage }) => {
    // Otherwise a row left by another run would be scanned under the label "(empty)".
    clearReminderSchedules();

    const task = await createTask(
      ownerPage.request,
      uniqueLabel('a11y-owner'),
      'Confirm the site visit window.',
    );

    await ownerPage.goto('/tasks');
    await expect(ownerPage.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible();
    await expectNoSeriousOrCriticalViolations(ownerPage, 'Owner task list');

    await ownerPage.goto(`/tasks/${task.id}`);
    await expect(ownerPage.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoSeriousOrCriticalViolations(ownerPage, 'Owner task detail');

    await ownerPage.goto('/attention');
    await expect(ownerPage.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoSeriousOrCriticalViolations(ownerPage, 'Owner attention list (empty)');
  });

  /**
   * The populated attention list, scanned against real rows (A8.6a).
   *
   * Both states are scanned because they are structurally different pages: empty is a single
   * `role="status"` region, populated is a list of links carrying badges. An empty-only scan would
   * cover the state an Owner sees when nothing is wrong and skip the one they see when it is.
   *
   * Seeded through the database fixture rather than reached through the product, because there is
   * no product path to it: the attention flag is raised only by the reminder worker settling a real
   * delivery, which requires enabling `ENABLE_REMINDER_DELIVERY`. This stays within the spec's rule
   * that no state is scanned by injecting markup — the rows are real, the page renders its own
   * query, and no production hook or debug parameter was added to reach it.
   */
  test('attention list with an item needing attention', async ({ ownerPage }) => {
    clearReminderSchedules();

    const task = await createTask(
      ownerPage.request,
      uniqueLabel('a11y-attention'),
      'Confirm the delivery window.',
    );
    stopReminderScheduleForAttention({
      taskId: task.id,
      dueLocalDate: '2026-08-10',
      stopReason: 'permanent_delivery_failure',
    });

    await ownerPage.goto('/attention');
    await expect(ownerPage.getByRole('main').getByRole('listitem')).toHaveCount(1);
    await expectNoSeriousOrCriticalViolations(ownerPage, 'Owner attention list (populated)');
  });

  /**
   * The Task-level reminder panel in each state an Owner can land on (A8.6b).
   *
   * Scanned as separate states because they are structurally different: one has a form and no
   * data, one has a form and a description list, one replaces the form with an explanation, one
   * is a modal dialog, and one carries a live-region result. Scanning only the first would cover
   * the emptiest version of the panel and skip every state that has something to get wrong.
   *
   * All five are reached the way an Owner reaches them. The only fixture is the seeded stopped
   * schedule, which has no product path because the attention flag is raised by the reminder
   * worker settling a real delivery — and delivery is disabled.
   */
  test('reminder panel with no due date and with an active schedule', async ({ ownerPage }) => {
    const task = await createTask(
      ownerPage.request,
      'Accessibility fixture',
      uniqueLabel('Reminder panel scan'),
    );

    await ownerPage.goto(`/tasks/${task.id}`);
    const panel = ownerPage.getByRole('region', { name: 'Reminders' });
    await expect(panel.getByText('No reminders are scheduled for this Task.')).toBeVisible();
    await expectNoSeriousOrCriticalViolations(ownerPage, 'Owner reminder panel (no due date)');

    await panel.getByLabel(/set a reminder due date/i).fill('2026-09-15');
    await panel.getByRole('button', { name: 'Set reminder due date' }).click();
    await expect(panel.getByText(/Due date saved/)).toBeVisible();
    await expectNoSeriousOrCriticalViolations(ownerPage, 'Owner reminder panel (active schedule)');

    // The destructive confirmation, scanned open with focus inside it.
    await panel.getByRole('button', { name: 'Remove reminder due date' }).click();
    await expect(ownerPage.getByRole('dialog')).toBeVisible();
    await expectNoSeriousOrCriticalViolations(
      ownerPage,
      'Owner reminder panel (removal confirmation)',
    );
  });

  test('reminder panel while the Task is Waiting', async ({ ownerPage }) => {
    const task = await createTask(
      ownerPage.request,
      'Accessibility fixture',
      uniqueLabel('Reminder panel waiting scan'),
    );

    await ownerPage.goto(`/tasks/${task.id}`);
    const panel = ownerPage.getByRole('region', { name: 'Reminders' });
    await panel.getByLabel(/set a reminder due date/i).fill('2026-09-15');
    await panel.getByRole('button', { name: 'Set reminder due date' }).click();
    await expect(panel.getByText(/Due date saved/)).toBeVisible();

    const current = await getTask(ownerPage.request, task.id);
    const waiting = await ownerPage.request.post(`/api/v1/tasks/${task.id}/waiting`, {
      headers: { 'Content-Type': 'application/json', 'If-Match': current.etag },
      data: { waitingUntil: '2026-09-10T16:00:00.000Z' },
    });
    expect(waiting.ok()).toBe(true);

    await ownerPage.goto(`/tasks/${task.id}`);
    await expect(
      ownerPage
        .getByRole('region', { name: 'Reminders' })
        .getByText(/paused because this Task is Waiting/),
    ).toBeVisible();
    await expectNoSeriousOrCriticalViolations(
      ownerPage,
      'Owner reminder panel (Waiting, suspended)',
    );
  });

  test('reminder panel for a stopped schedule, and after a concurrent change', async ({
    ownerPage,
  }) => {
    clearReminderSchedules();

    const task = await createTask(
      ownerPage.request,
      'Accessibility fixture',
      uniqueLabel('Reminder panel stopped scan'),
    );
    stopReminderScheduleForAttention({
      taskId: task.id,
      dueLocalDate: '2026-08-10',
      stopReason: 'repeated_ambiguous_outcomes',
    });

    await ownerPage.goto(`/tasks/${task.id}`);
    const panel = ownerPage.getByRole('region', { name: 'Reminders' });
    await expect(
      panel.getByText(/could not confirm that recent reminders were delivered/),
    ).toBeVisible();
    await expectNoSeriousOrCriticalViolations(
      ownerPage,
      'Owner reminder panel (stopped, needs attention)',
    );

    /*
     * A real stale-ETag resolution, produced rather than simulated.
     *
     * The panel is holding the token it was rendered with. Changing the reminder out of band moves
     * the server's version, so the next submission from this page is refused by the real route with
     * a genuine `412` and the panel resolves it by re-reading. No response is intercepted and no
     * error is injected: the conflict is the one two clients would actually have.
     */
    const reminder = await ownerPage.request.get(`/api/v1/tasks/${task.id}/reminder`);
    const outOfBand = await ownerPage.request.put(`/api/v1/tasks/${task.id}/reminder`, {
      headers: {
        'Content-Type': 'application/json',
        'If-Match': String(reminder.headers()['etag']),
      },
      data: { dueLocalDate: '2026-10-05' },
    });
    expect(outOfBand.ok()).toBe(true);

    await panel.getByLabel(/reminder due date/i).fill('2026-11-01');
    await panel.getByRole('button', { name: 'Save reminder due date' }).click();
    await expect(panel.getByText(/changed somewhere else/)).toBeVisible();
    await expectNoSeriousOrCriticalViolations(
      ownerPage,
      'Owner reminder panel (stale state resolved)',
    );
  });

  /*
   * The Task list's loading boundary, held open by throttling the transport.
   *
   * This test used to install `page.route('**​/tasks')` and delay the response by two seconds. That
   * never delayed anything: a client-side navigation requests `/tasks?_rsc=<hash>`, which the glob
   * does not match, so the handler was never invoked. The boundary painted for an unrelated reason
   * — the click landed before hydration, so the browser performed a *document* navigation and the
   * server streamed the Suspense fallback ahead of the page. That made the test a race against
   * hydration, and A8.6a lost it: `/attention` now does real work, so by the time its heading is
   * visible the router has hydrated, the click resolves client-side, and no fallback is streamed.
   *
   * Throttling instead of intercepting removes the race. It is the technique the Recipient loading
   * state in this file already uses, it exercises the real streamed response, and it does not
   * depend on when hydration happens to finish. Verified stable across repeated runs on both
   * projects. Nothing in the application is delayed — the constraint is on the transport.
   */
  test('task list while its loading boundary is painted', async ({ ownerPage }) => {
    await ownerPage.goto('/attention');
    await expect(ownerPage.getByRole('heading', { level: 1 })).toBeVisible();

    const restore = await throttle(ownerPage);
    const navigation = ownerPage.goto('/tasks');

    // Scan the boundary itself, proven present rather than assumed.
    await expect(ownerPage.getByText('Loading Tasks…')).toBeVisible();
    await expectNoSeriousOrCriticalViolations(ownerPage, 'Owner task list (loading)');

    await restore();
    await navigation;
    await expect(ownerPage.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible();
  });

  test('handoff confirmation dialog while open', async ({ ownerPage }) => {
    const task = await createTask(
      ownerPage.request,
      uniqueLabel('a11y-handoff'),
      'Send the revised quote.',
    );
    await createRecipient(
      ownerPage.request,
      uniqueLabel('a11y-rcpt'),
      `${uniqueLabel('a11y-rcpt')}@${E2E_WORKSPACE_DOMAIN}`,
    );

    await ownerPage.goto(`/tasks/${task.id}`);
    const recipientSelect = ownerPage.getByLabel('Recipient');
    await expect(recipientSelect).toBeEnabled();
    const options = await recipientSelect.locator('option').all();
    // Skip the placeholder option; any seeded Recipient makes the action available.
    await recipientSelect.selectOption(await options[1]!.getAttribute('value'));

    const trigger = ownerPage.getByRole('button', { name: 'Hand off…' });
    await expect(trigger).toBeEnabled();
    await trigger.click();

    const dialog = ownerPage.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCount(1);
    await expect(dialog).toHaveAccessibleName('Confirm handoff');
    // Focus is inside before scanning, so modal-focus rules see the real state.
    expect(
      await ownerPage.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))),
    ).toBe(true);

    await expectNoSeriousOrCriticalViolations(ownerPage, 'Owner handoff dialog (open)');
  });
});

test.describe('D119 accessibility gate — Recipient capability surfaces', () => {
  test('valid panel, both dialog classes, and a failure state', async ({ page, browser }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await signInAsOwner(ownerPage);
    const fixture = await seedCapabilityFixture(ownerPage.request, 'a11y-gate');

    await page.goto(fixture.capability.capabilityPath);
    await expect(page.getByRole('heading', { level: 1, name: 'Assigned task' })).toBeVisible();
    await expectNoSeriousOrCriticalViolations(page, 'Recipient capability panel');

    // Dialog that collects input, opened the way a Recipient opens it.
    const addNote = page.getByRole('button', { name: 'Add note' });
    await addNote.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCount(1);
    await expect(dialog.getByLabel('Note', { exact: true })).toBeFocused();
    await expectNoSeriousOrCriticalViolations(page, 'Recipient dialog with input (open)');

    // Same dialog once an outcome message is showing, which adds a live region to the scan.
    await page.route('**/api/v1/capabilities/**/notes', (route) => route.abort('failed'));
    await dialog.getByLabel('Note', { exact: true }).fill('Synthetic note for the scan');
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await expect(dialog.getByText('may or may not have been saved')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Confirm' })).toBeEnabled();
    await expectNoSeriousOrCriticalViolations(page, 'Recipient dialog showing a failure');

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await ownerContext.close();
  });

  test('dialog without an input, on a waiting task', async ({ page, browser }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await signInAsOwner(ownerPage);
    const fixture = await seedCapabilityFixture(ownerPage.request, 'a11y-resume');

    await page.goto(fixture.capability.capabilityPath);

    // Reach the waiting status through the product's own action rather than by seeding it.
    await page.getByRole('button', { name: 'Mark waiting' }).click();
    const waitingDialog = page.getByRole('dialog');
    await waitingDialog.getByLabel('Waiting until').fill('2026-12-01T09:00');
    await waitingDialog.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const resume = page.getByRole('button', { name: 'Resume' });
    await resume.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCount(1);
    // No field, so Cancel is the safe landing control.
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();

    await expectNoSeriousOrCriticalViolations(page, 'Recipient dialog without input (open)');
    await ownerContext.close();
  });

  test('capability page while its loading boundary is painted', async ({ page, browser }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await signInAsOwner(ownerPage);
    const fixture = await seedCapabilityFixture(ownerPage.request, 'a11y-loading');

    const restore = await throttle(page);
    const navigation = page.goto(fixture.capability.capabilityPath);

    await expect(page.getByText('Loading task…')).toBeVisible();
    await expectNoSeriousOrCriticalViolations(page, 'Recipient capability panel (loading)');

    await restore();
    await navigation;
    await expect(page.getByRole('heading', { level: 1, name: 'Assigned task' })).toBeVisible();
    await ownerContext.close();
  });

  test('unavailable link', async ({ page }) => {
    /*
     * Built from a variable, following the existing invalid-token spec. A token-shaped
     * literal in the source would be copied into Playwright's `error-context.md` — which
     * embeds a snippet of the spec — and the capability-secret sweep would then flag this
     * file on any unrelated failure in it. The value is synthetic and authorizes nothing.
     */
    const unknownToken = `absent-${'x'.repeat(30)}`;
    await page.goto(`/c/${unknownToken}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Link unavailable' })).toBeVisible();
    await expectNoSeriousOrCriticalViolations(page, 'Recipient link unavailable');
  });

  test('returned terminal state', async ({ page, browser }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await signInAsOwner(ownerPage);
    const fixture = await seedCapabilityFixture(ownerPage.request, 'a11y-returned');

    await page.goto(fixture.capability.capabilityPath);
    await page.getByRole('button', { name: 'Return to owner' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Returned to owner' })).toBeVisible();
    await expectNoSeriousOrCriticalViolations(page, 'Recipient returned terminal state');
    await ownerContext.close();
  });
});
