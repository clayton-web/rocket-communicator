import { test, expect, uniqueLabel } from '../support/fixtures';
import { addOwnerNote, createTask, getTask } from '../support/owner-api';
import { readTaskNotes, readTaskState } from '../support/db-fixtures';

/**
 * Existing concurrency contract: optimistic concurrency via strong ETag / If-Match, and the
 * P1.0 distinction between an ambiguous transport retry and a confirmed 412 recovery.
 *
 * Coverage note: the ambiguous-retry branch that replays an original Idempotency-Key belongs
 * to the Gmail handoff route, which P1.2 excludes. That branch stays covered by the existing
 * A7 integration tests and is documented as a browser-level gap.
 */

// Concurrency semantics are transport-level; one engine is sufficient.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'transport contract: desktop only');
});

test('stale If-Match is refused with 412 and produces no duplicate side effect', async ({
  ownerPage,
}) => {
  const title = uniqueLabel('concurrency');
  const task = await createTask(ownerPage.request, 'Fixture point', title);
  const staleEtag = task.etag;

  // First mutation succeeds and advances the authoritative version.
  await addOwnerNote(ownerPage.request, task, `${title} first note`);
  expect(readTaskState(task.id)?.version).toBe(2);

  // Replaying the original concurrency context is refused, not silently applied.
  const stale = await ownerPage.request.post(`/api/v1/tasks/${task.id}/notes`, {
    headers: { 'Content-Type': 'application/json', 'If-Match': staleEtag },
    data: { body: `${title} stale replay` },
  });

  expect(stale.status()).toBe(412);
  const envelope = (await stale.json()) as { error: { code: string; message: string } };
  expect(envelope.error.code).toBe('PRECONDITION_FAILED');
  expect(envelope.error.message).toBe('The resource has changed since the provided ETag.');

  // No duplicate and no partial write.
  expect(readTaskNotes(task.id)).toHaveLength(1);
  expect(readTaskState(task.id)?.version).toBe(2);

  // Confirmed 412 recovery: refresh authoritative state, then make a new confirmed attempt.
  const refreshed = await getTask(ownerPage.request, task.id);
  expect(refreshed.etag).not.toBe(staleEtag);
  await addOwnerNote(ownerPage.request, refreshed, `${title} recovered note`);

  expect(readTaskNotes(task.id)).toHaveLength(2);
  expect(readTaskState(task.id)?.version).toBe(3);

  // The Owner UI shows the truthful recovered state, with no conflict artifacts.
  await ownerPage.goto(`/tasks/${task.id}`);
  await expect(ownerPage.getByText(`${title} first note`)).toBeVisible();
  await expect(ownerPage.getByText(`${title} recovered note`)).toBeVisible();
  await expect(ownerPage.getByText(`${title} stale replay`)).toHaveCount(0);
});

test('malformed If-Match is refused as a precondition failure, not applied', async ({
  ownerPage,
}) => {
  const task = await createTask(ownerPage.request, 'Fixture point', uniqueLabel('concurrency-bad'));

  const response = await ownerPage.request.post(`/api/v1/tasks/${task.id}/notes`, {
    headers: { 'Content-Type': 'application/json', 'If-Match': 'not-a-strong-etag' },
    data: { body: 'must not persist' },
  });

  expect(response.status()).toBe(412);
  expect(readTaskNotes(task.id)).toHaveLength(0);
});
