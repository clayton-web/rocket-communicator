import type { Page, Request as PlaywrightRequest } from '@playwright/test';
import { test, expect, uniqueLabel } from '../support/fixtures';
import { createRecipient, createTask, type SeededTask } from '../support/owner-api';
import { E2E_WORKSPACE_DOMAIN } from '../config/e2e-env';
import { expectNoSeriousOrCriticalViolations } from '../support/accessibility';

/**
 * Owner handoff-confirmation critical journey (D119 browser verification).
 *
 * D119 requires browser coverage of the critical Owner journeys, of which handoff
 * confirmation was the last one uncovered. The gap was never the confirmation UI itself —
 * it was that a *completed* handoff performs a real Gmail send, which the harness excludes
 * by policy (P1_2_BROWSER_HARNESS.md). This spec closes the gap by driving the real
 * rendered confirmation interaction and stubbing only the single outbound mutation
 * (`POST /api/v1/tasks/{taskId}/handoff`) at the network boundary, which is the harness's
 * established interception approach.
 *
 * Scope, stated honestly: this proves the Owner-facing confirmation and request boundary —
 * what is shown, what is submitted, and what is shown back. It proves **nothing** about
 * Gmail delivery, which remains covered by integration and production evidence.
 *
 * The Task's own handoff eligibility, the Recipient list, the acknowledgement contract, the
 * `If-Match` version and the `Idempotency-Key` are all produced by the real application.
 */

const HANDOFF_ROUTE = '**/api/v1/tasks/*/handoff';

/** `uniqueLabel` is stable per run, so seeds are additionally numbered per test. */
let seedSequence = 0;

interface HandoffSurface {
  task: SeededTask;
  recipient: { id: string; displayName: string; email: string };
  /** Every handoff mutation the browser actually issued, in order. */
  submissions: PlaywrightRequest[];
}

/**
 * Seed an unassigned Task plus one Recipient through the real Owner API, open the Task, and
 * select the Recipient so the handoff action becomes available.
 *
 * No Gmail connection is created: the handoff action does not depend on one, so the
 * confirmation journey is reachable without touching Gmail at all.
 */
async function openHandoffSurface(page: Page): Promise<HandoffSurface> {
  const seed = ++seedSequence;
  const title = `${uniqueLabel('handoff-journey')}-${seed}`;
  const task = await createTask(page.request, 'Fixture point', title);
  const recipientName = `${uniqueLabel('handoff-rcpt')}-${seed}`;
  await createRecipient(page.request, recipientName, `${recipientName}@${E2E_WORKSPACE_DOMAIN}`);

  const submissions: PlaywrightRequest[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/api\/v1\/tasks\/[^/]+\/handoff$/.test(request.url())) {
      submissions.push(request);
    }
  });

  await page.goto(`/tasks/${task.id}`);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page.getByText('Unassigned')).toBeVisible();

  // Seeding guarantees the list is non-empty, but the Recipient list is a bounded page, so
  // take whichever Recipient the application actually offers first rather than assuming the
  // one just created is on it. Index 0 is the "Select a Recipient…" placeholder.
  const recipientSelect = page.getByLabel('Recipient');
  await expect(recipientSelect).toBeEnabled();
  const option = recipientSelect.locator('option').nth(1);
  const id = await option.getAttribute('value');
  const label = (await option.textContent()) ?? '';
  expect(id, 'a seeded Recipient must be selectable').toBeTruthy();

  const [displayName = '', email = ''] = label.split('—').map((part) => part.trim());
  await recipientSelect.selectOption(id);

  return { task, recipient: { id: id!, displayName, email }, submissions };
}

async function openDialog(page: Page) {
  const trigger = page.getByRole('button', { name: 'Hand off…' });
  await expect(trigger).toBeEnabled();
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Server-side truth: the Task carries no assignment. */
async function expectStillUnassigned(page: Page, taskId: string) {
  const response = await page.request.get(`/api/v1/tasks/${taskId}`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { assignment?: unknown };
  expect(body.assignment ?? null).toBeNull();
}

/** Contract-shaped success body, built from the real Task and Recipient records. */
async function successBody(page: Page, surface: HandoffSurface) {
  const response = await page.request.get(`/api/v1/tasks/${surface.task.id}`);
  const task = await response.json();
  return {
    task,
    deliveryPath: 'assignment_email',
    deliveryStatus: 'sent',
    recipient: surface.recipient,
    // An identifier, never a capability secret — routine handoff does not return a token.
    capabilityId: 'cap_e2e_handoff_journey_fixture',
    requiresSendReconsent: false,
    idempotentReplay: false,
  };
}

test.describe('Owner handoff confirmation journey', () => {
  test('the confirmation identifies the action and Recipient, and cancelling submits nothing', async ({
    ownerPage,
    diagnostics,
  }) => {
    const surface = await openHandoffSurface(ownerPage);

    // Nothing may be submitted before the Owner explicitly confirms.
    expect(surface.submissions).toHaveLength(0);

    const dialog = await openDialog(ownerPage);
    await expect(dialog).toHaveAccessibleName('Confirm handoff');

    // The confirmation names the action and the exact Recipient, not a vague "are you sure".
    await expect(dialog).toContainText('You are handing off this Task to');
    await expect(dialog).toContainText(surface.recipient.displayName);
    await expect(dialog).toContainText(surface.recipient.email);
    await expect(dialog).toContainText('The Recipient will receive a secure action link.');
    // D089: the confirmation must not imply reminders are scheduled.
    await expect(dialog).toContainText('Reminders are not scheduled by this confirmation.');

    // The persistent Owner shell stays mounted behind the modal.
    await expect(ownerPage.getByRole('banner')).toHaveCount(1);
    await expect(ownerPage.getByRole('navigation', { name: 'Owner' })).toHaveCount(1);

    await expectNoSeriousOrCriticalViolations(ownerPage, 'Owner handoff confirmation (open)');

    // Confirm stays disabled until the acknowledgement is ticked: no accidental mutation.
    const confirm = dialog.getByRole('button', { name: 'Confirm handoff' });
    await expect(confirm).toBeDisabled();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(ownerPage.getByRole('dialog')).toHaveCount(0);

    expect(surface.submissions).toHaveLength(0);
    await expectStillUnassigned(ownerPage, surface.task.id);
    await expect(ownerPage.getByText('Unassigned')).toBeVisible();

    expect(diagnostics.consoleErrors).toEqual([]);
    expect(diagnostics.pageErrors).toEqual([]);
  });

  test('Escape dismisses the confirmation without submitting', async ({ ownerPage }) => {
    const surface = await openHandoffSurface(ownerPage);
    await openDialog(ownerPage);

    await ownerPage.keyboard.press('Escape');
    await expect(ownerPage.getByRole('dialog')).toHaveCount(0);

    expect(surface.submissions).toHaveLength(0);
    await expectStillUnassigned(ownerPage, surface.task.id);
  });

  test('confirming submits the acknowledged request and shows the truthful success state', async ({
    ownerPage,
  }) => {
    const surface = await openHandoffSurface(ownerPage);
    const body = await successBody(ownerPage, surface);

    await ownerPage.route(HANDOFF_ROUTE, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      }),
    );

    const dialog = await openDialog(ownerPage);
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Confirm handoff' }).click();

    // The dialog closes only on a confirmed success.
    await expect(ownerPage.getByRole('dialog')).toHaveCount(0);

    // Success is reported for the Recipient the Owner actually chose.
    await expect(
      ownerPage.getByText(`Assignment sent to ${surface.recipient.displayName}.`),
    ).toBeVisible();
    await expect(ownerPage.getByText('Status: Sent')).toBeVisible();

    // Exactly one mutation, carrying the application's own version and idempotency values.
    expect(surface.submissions).toHaveLength(1);
    const submitted = surface.submissions[0]!;
    expect(submitted.method()).toBe('POST');
    expect(submitted.headers()['if-match']).toBe(surface.task.etag);
    expect(submitted.headers()['idempotency-key']).toBeTruthy();
    expect(submitted.postDataJSON()).toEqual({
      recipientId: surface.recipient.id,
      acknowledgement: 'handoff_confirmed_v1',
    });

    await ownerPage.unroute(HANDOFF_ROUTE);
  });

  test('a failed handoff reports the failure truthfully and never shows success', async ({
    ownerPage,
  }) => {
    const surface = await openHandoffSurface(ownerPage);

    await ownerPage.route(HANDOFF_ROUTE, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'HANDOFF_DELIVERY_FAILED',
            message: 'Delivery could not be completed.',
            requestId: '00000000-0000-4000-8000-0000000e2e01',
            correlationId: null,
          },
        }),
      }),
    );

    const dialog = await openDialog(ownerPage);
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Confirm handoff' }).click();

    await expect(
      ownerPage.getByText('Delivery could not be completed because of a temporary Gmail problem.'),
    ).toBeVisible();

    // A failure must never be dressed up as success, anywhere on the surface.
    await expect(ownerPage.getByText('Assignment sent')).toHaveCount(0);
    await expect(ownerPage.getByText('Status: Sent')).toHaveCount(0);
    await expect(ownerPage.getByText('Assigned to')).toHaveCount(0);

    // The retry affordance is offered because this failure is genuinely retryable.
    await expect(ownerPage.getByRole('button', { name: 'Retry handoff' })).toBeVisible();

    await expectStillUnassigned(ownerPage, surface.task.id);
    expect(surface.submissions).toHaveLength(1);

    await ownerPage.unroute(HANDOFF_ROUTE);
  });

  test('a pending handoff cannot be submitted twice', async ({ ownerPage }) => {
    const surface = await openHandoffSurface(ownerPage);
    const body = await successBody(ownerPage, surface);

    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    await ownerPage.route(HANDOFF_ROUTE, async (route) => {
      await held;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    });

    const dialog = await openDialog(ownerPage);
    await dialog.getByRole('checkbox').check();
    const confirm = dialog.getByRole('button', { name: 'Confirm handoff' });
    await confirm.click();

    // While the request is in flight the control is disabled and announces itself busy.
    await expect(confirm).toBeDisabled();
    await expect(confirm).toHaveAttribute('aria-busy', 'true');

    // Even a synthetic click that bypasses pointer actionability must not re-submit.
    await confirm.dispatchEvent('click');
    await dialog.getByRole('checkbox').press('Enter');

    // Give any second request a chance to appear before asserting that none did.
    await ownerPage.waitForTimeout(250);
    expect(surface.submissions).toHaveLength(1);

    release();
    await expect(ownerPage.getByRole('dialog')).toHaveCount(0);
    await expect(
      ownerPage.getByText(`Assignment sent to ${surface.recipient.displayName}.`),
    ).toBeVisible();

    // Still exactly one mutation after the operation settles.
    expect(surface.submissions).toHaveLength(1);

    await ownerPage.unroute(HANDOFF_ROUTE);
  });
});
