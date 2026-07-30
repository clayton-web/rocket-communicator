import { test, expect, uniqueLabel } from '../support/fixtures';
import { createTask } from '../support/owner-api';
import { structuredEventLines, waitForStructuredLines } from '../support/server-log';

/**
 * P1.1 correlation verification through the browser (D113/D114).
 *
 * Uses the existing structured diagnostic seam captured from the local application's stdout.
 * No new telemetry system, and no assertion against platform-specific production logs.
 */

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'diagnostics contract: desktop only');
});

test('expected domain rejection correlates by requestId and emits no operational failure', async ({
  ownerPage,
}) => {
  const unknownTaskId = '00000000-0000-4000-8000-0000000000fc';

  const response = await ownerPage.request.get(`/api/v1/tasks/${unknownTaskId}`);
  expect(response.status()).toBe(404);

  const envelope = (await response.json()) as {
    error: { code: string; requestId: string; correlationId: string | null };
  };
  expect(envelope.error.code).toBe('NOT_FOUND');

  // The public error reference is a usable correlation identifier.
  const requestId = envelope.error.requestId;
  expect(requestId).toMatch(/^[0-9a-f-]{36}$/i);

  // The same requestId appears in the captured structured server diagnostic. The log is
  // truncated by global setup, so a match cannot come from an earlier run.
  const lines = await waitForStructuredLines(requestId);
  expect(lines.length).toBeGreaterThan(0);
  expect(lines.some((line) => line.includes('operation_timing'))).toBe(true);

  // Correlation is exact, not incidental: every matched record carries this request id.
  for (const line of lines) {
    expect(line).toContain(`"requestId":"${requestId}"`);
    // A safe route template, never the raw Task identifier.
    expect(line).toContain('"routeTemplate":"/api/v1/tasks/[taskId]"');
    expect(line).not.toContain(unknownTaskId);
  }

  // Level and failure classification are separate axes in P1.1, and this pins both.
  //
  // Per docs/P1_1_BASELINE.md §6, a domain 4xx thrown inside a route runner emits exactly one
  // `operation_timing` at `error` level and zero `operational_failure` records. The error
  // level describes the request outcome; the ABSENCE of `operational_failure` is what marks it
  // as an expected client outcome rather than something operationally broken. The two must not
  // be read as the same statement.
  const timing = lines.find((line) => line.includes('operation_timing'));
  expect(timing).toContain('"level":"error"');
  expect(timing).toContain('"outcome":"error"');
  expect(lines.some((line) => line.includes('operational_failure'))).toBe(false);

  // Structured diagnostics record route templates, never a raw capability path.
  for (const line of structuredEventLines()) {
    expect(line).not.toMatch(/\/c\/[A-Za-z0-9_-]{16,}/);
  }
});

test('domain precondition rejection is also correlated without operational failure', async ({
  ownerPage,
}) => {
  const task = await createTask(ownerPage.request, 'Fixture point', uniqueLabel('correlation-412'));

  const response = await ownerPage.request.post(`/api/v1/tasks/${task.id}/notes`, {
    // Canonical strong ETag with a stale version: a genuine domain precondition rejection.
    headers: { 'Content-Type': 'application/json', 'If-Match': `"task-${task.id}-v99"` },
    data: { body: 'must not persist' },
  });
  expect(response.status()).toBe(412);

  const envelope = (await response.json()) as { error: { code: string; requestId: string } };
  expect(envelope.error.code).toBe('PRECONDITION_FAILED');

  const lines = await waitForStructuredLines(envelope.error.requestId);
  expect(lines.length).toBeGreaterThan(0);
  expect(lines.some((line) => line.includes('operational_failure'))).toBe(false);
});

test('successful Owner page load emits correlated timing diagnostics', async ({ ownerPage }) => {
  await ownerPage.goto('/tasks');
  await expect(ownerPage.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible();

  const structured = structuredEventLines();
  const listPageEvents = structured.filter(
    (line) => line.includes('operation_timing') && line.includes('owner_task_list_page'),
  );
  expect(listPageEvents.length).toBeGreaterThan(0);
  expect(listPageEvents.at(-1)).toContain('"routeTemplate":"/tasks"');
  expect(listPageEvents.at(-1)).toContain('"outcome":"ok"');
});
