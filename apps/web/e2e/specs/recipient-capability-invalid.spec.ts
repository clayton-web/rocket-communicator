import { test, expect, signInAsOwner } from '../support/fixtures';
import { seedCapabilityFixture } from '../support/capability-fixture';
import { recordCapabilityTokenFingerprint } from '../support/artifact-safety';
import { expireCapability } from '../support/db-fixtures';

/**
 * Invalid, malformed, and expired capability journeys.
 *
 * Trace, screenshot, and video capture are disabled: raw capability tokens appear in the
 * navigated URL and Playwright cannot redact them from a trace (D114).
 *
 * Visible-content assertions use innerText, which reflects rendered output only. The
 * dev-server HTML also carries an RSC payload containing the requested path; that is inherent
 * to the token being the URL and is why capability artifacts are never retained.
 */
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

const UNAVAILABLE_COPY =
  'This link is invalid or no longer available. If you still need access, ask the owner for a new link.';

test('unknown capability token yields the truthful unavailable state and leaks no Task content', async ({
  page,
  diagnostics,
}) => {
  // Well-formed but never issued: exercises hash lookup failure, not a length rejection.
  const unknownToken = 'A'.repeat(43);
  // Fingerprint even synthetic tokens so a bare leak into an artifact cannot evade the sweep.
  recordCapabilityTokenFingerprint(unknownToken);

  await page.goto(`/c/${unknownToken}`);

  await expect(page.getByRole('heading', { level: 1, name: 'Link unavailable' })).toBeVisible();
  await expect(page.getByText(UNAVAILABLE_COPY)).toBeVisible();

  // Unauthorized is distinguishable from empty, and no protected content is rendered.
  const visible = await page.locator('body').innerText();
  expect(visible).not.toContain('Assigned task');
  expect(visible).not.toContain('Instructions');
  await expect(page.getByRole('button', { name: 'Complete' })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 2, name: 'Actions' })).toHaveCount(0);

  expect(diagnostics.pageErrors).toEqual([]);
});

test('malformed capability token yields the same unavailable state', async ({ page }) => {
  await page.goto('/c/short');

  await expect(page.getByRole('heading', { level: 1, name: 'Link unavailable' })).toBeVisible();
  const visible = await page.locator('body').innerText();
  expect(visible).not.toContain('Instructions');
});

test('expired capability leaks no protected Task content', async ({ page, browser }) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signInAsOwner(ownerPage);
  const fixture = await seedCapabilityFixture(ownerPage.request, 'cap-expired');

  // Age the capability so the application's real expiry branch runs.
  expireCapability(fixture.capability.capabilityId);

  await page.goto(fixture.capability.capabilityPath);

  await expect(page.getByRole('heading', { level: 1, name: 'Link unavailable' })).toBeVisible();
  const visible = await page.locator('body').innerText();
  expect(visible).not.toContain(fixture.taskTitle);
  expect(visible).not.toContain(fixture.recipientEmail);
  expect(visible).not.toContain('Instructions');

  await ownerContext.close();
});

test('capability mutation with an unknown token is refused without disclosing the Task', async ({
  request,
}) => {
  const unknownToken = 'B'.repeat(43);
  recordCapabilityTokenFingerprint(unknownToken);
  const taskId = '00000000-0000-4000-8000-0000000000fd';

  const response = await request.post(
    `/api/v1/capabilities/${unknownToken}/tasks/${taskId}/notes`,
    {
      headers: {
        'Content-Type': 'application/json',
        // Canonical strong ETag so the request reaches capability authorization.
        'If-Match': `"task-${taskId}-v1"`,
      },
      data: { confirmation: 'confirmed', body: 'should never persist' },
    },
  );

  expect(response.status()).toBe(401);
  const envelope = (await response.json()) as {
    error: { code: string; message: string; requestId: string };
  };
  expect(envelope.error.code).toBe('UNAUTHORIZED');
  // Boolean comparisons: a raw token passed to `toContain` lands in Playwright failure output.
  const envelopeText = JSON.stringify(envelope);
  expect(envelopeText.includes(unknownToken)).toBe(false);
  expect(envelope.error.message.includes(taskId)).toBe(false);
});

test('malformed If-Match is refused before capability authorization is attempted', async ({
  request,
}) => {
  const unknownToken = 'D'.repeat(43);
  recordCapabilityTokenFingerprint(unknownToken);

  const response = await request.post(
    `/api/v1/capabilities/${unknownToken}/tasks/00000000-0000-4000-8000-0000000000fd/notes`,
    {
      headers: { 'Content-Type': 'application/json', 'If-Match': 'not-a-strong-etag' },
      data: { confirmation: 'confirmed', body: 'should never persist' },
    },
  );

  // Transport precondition is evaluated first; the response still discloses nothing.
  expect(response.status()).toBe(412);
  const envelope = (await response.json()) as { error: { code: string } };
  expect(envelope.error.code).toBe('PRECONDITION_FAILED');
  expect(JSON.stringify(envelope).includes(unknownToken)).toBe(false);
});
