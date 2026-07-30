import { test, expect, uniqueLabel } from '../support/fixtures';
import { createTask, textSummaryPoint } from '../support/owner-api';

/**
 * P1.4 Owner presentation in a real browser (D117).
 *
 * The timezone test is the important one here. Unit tests prove the formatter renders Vancouver
 * time under any *process* timezone; only a browser can prove the rendered page does not shift
 * when the *viewer's* timezone differs. Asia/Tokyo is chosen because it is far enough ahead that
 * a leak shows up as the wrong calendar day, not merely a wrong hour.
 */

test.describe('Owner dates render in the organization timezone', () => {
  test.use({ timezoneId: 'Asia/Tokyo' });

  test('a due date shows the Vancouver date even in an Asia/Tokyo browser', async ({
    ownerPage,
  }) => {
    const title = uniqueLabel('tz-due');
    // 2026-01-16T04:30:00Z is 2026-01-15 20:30 in Vancouver and 2026-01-16 13:30 in Tokyo.
    const response = await ownerPage.request.post('/api/v1/tasks', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        summaryPoints: [textSummaryPoint('Fixture point', title)],
        dueAt: '2026-01-16T04:30:00.000Z',
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const task = await response.json();

    await ownerPage.goto(`/tasks/${task.id}`);

    // The Vancouver calendar day, not the browser's.
    await expect(ownerPage.getByText('Jan 15, 2026')).toBeVisible();
    await expect(ownerPage.getByText('Jan 16, 2026')).toHaveCount(0);
  });

  test('a note timestamp shows Vancouver time with an explicit zone indicator', async ({
    ownerPage,
  }) => {
    const title = uniqueLabel('tz-note');
    const task = await createTask(ownerPage.request, 'Fixture point', title);

    const noted = await ownerPage.request.post(`/api/v1/tasks/${task.id}/notes`, {
      headers: { 'Content-Type': 'application/json', 'If-Match': task.etag },
      data: { body: `${uniqueLabel('tz-note-body')} note` },
    });
    expect(noted.ok()).toBe(true);

    await ownerPage.goto(`/tasks/${task.id}`);

    // A bare time would be ambiguous; the zone must always accompany it.
    await expect(ownerPage.getByText(/\bP[SD]T\b/).first()).toBeVisible();
  });
});

test('Task status and urgency render as human labels, never raw enum values', async ({
  ownerPage,
}) => {
  const title = uniqueLabel('labels');
  const response = await ownerPage.request.post('/api/v1/tasks', {
    headers: { 'Content-Type': 'application/json' },
    data: {
      summaryPoints: [textSummaryPoint('Fixture point', title)],
      // Already past, so the read-time urgency derivation yields `overdue`.
      dueAt: '2020-01-01T00:00:00.000Z',
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const task = await response.json();

  await ownerPage.goto('/tasks');

  const row = ownerPage.getByRole('link', { name: new RegExp(title) });
  await expect(row).toContainText('Open');
  await expect(row).toContainText('Overdue');
  await expect(row).toContainText('Unassigned');
  // The raw contract values must not leak into the interface.
  await expect(row).not.toContainText('in_progress');
  await expect(row).not.toContainText('due_soon');
  await expect(row).not.toContainText('overdue');

  await ownerPage.goto(`/tasks/${task.id}`);
  await expect(ownerPage.getByText('Due date')).toBeVisible();
  await expect(ownerPage.getByText('Overdue')).toBeVisible();
});

test('a long Task title wraps instead of causing horizontal document overflow', async ({
  ownerPage,
}) => {
  const prefix = uniqueLabel('longtitle');
  // A single unbroken token is the hard case: normal word wrapping cannot break it.
  const longTitle = `${prefix}-${'x'.repeat(220)}`;
  const task = await createTask(ownerPage.request, 'Fixture point', longTitle);

  await ownerPage.goto(`/tasks/${task.id}`);
  await expect(ownerPage.getByRole('heading', { level: 1 })).toBeVisible();

  const overflow = await ownerPage.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test('a long note wraps and preserves its own line breaks', async ({ ownerPage }) => {
  const title = uniqueLabel('longnote');
  const task = await createTask(ownerPage.request, 'Fixture point', title);
  const marker = uniqueLabel('longnote-body');

  const noted = await ownerPage.request.post(`/api/v1/tasks/${task.id}/notes`, {
    headers: { 'Content-Type': 'application/json', 'If-Match': task.etag },
    data: { body: `${marker}\nsecond line ${'y'.repeat(240)}` },
  });
  expect(noted.ok()).toBe(true);

  await ownerPage.goto(`/tasks/${task.id}`);
  await expect(ownerPage.getByText(new RegExp(marker))).toBeVisible();

  const overflow = await ownerPage.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
