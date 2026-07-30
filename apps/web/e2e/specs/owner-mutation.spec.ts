import { test, expect, uniqueLabel } from '../support/fixtures';
import { addOwnerNote, createTask, getTask } from '../support/owner-api';
import { readTaskNotes, readTaskState } from '../support/db-fixtures';

/**
 * Representative existing Owner mutation on a disposable Task.
 *
 * The current Owner UI exposes no non-Gmail mutation control (the only control is the
 * handoff panel, and Gmail is excluded from P1.2), so the mutation is driven through the
 * real authenticated Owner HTTP surface from the browser session, and the resulting state is
 * then verified in the browser. Recorded as a finding for later P1 slices.
 */

test('Owner note mutation succeeds, renders truthfully, and does not duplicate on refresh', async ({
  ownerPage,
  diagnostics,
}) => {
  const title = uniqueLabel('mutation');
  const noteBody = `${title} single note`;
  const task = await createTask(ownerPage.request, 'Fixture point', title);

  const before = readTaskState(task.id);
  expect(before?.version).toBe(1);

  await addOwnerNote(ownerPage.request, task, noteBody);

  // Truthful resulting state: version advanced exactly once, one persisted note.
  const after = readTaskState(task.id);
  expect(after?.version).toBe(2);
  expect(readTaskNotes(task.id).filter((note) => note.body === noteBody)).toHaveLength(1);

  await ownerPage.goto(`/tasks/${task.id}`);
  await expect(ownerPage.getByText(noteBody)).toBeVisible();

  // A browser refresh must not repeat the side effect.
  await ownerPage.reload();
  await expect(ownerPage.getByText(noteBody)).toBeVisible();
  expect(readTaskNotes(task.id).filter((note) => note.body === noteBody)).toHaveLength(1);
  expect(readTaskState(task.id)?.version).toBe(2);

  expect(diagnostics.consoleErrors).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.failedRequests).toEqual([]);
});

test('Owner mutation without If-Match is refused as a precondition requirement', async ({
  ownerPage,
}) => {
  const task = await createTask(ownerPage.request, 'Fixture point', uniqueLabel('mutation-428'));

  const response = await ownerPage.request.post(`/api/v1/tasks/${task.id}/notes`, {
    headers: { 'Content-Type': 'application/json' },
    data: { body: 'must not persist without If-Match' },
  });

  expect(response.status()).toBe(428);
  const envelope = (await response.json()) as { error: { code: string; requestId: string } };
  expect(envelope.error.code).toBe('PRECONDITION_REQUIRED');

  // Refused transport requirement means no side effect at all.
  expect(readTaskNotes(task.id)).toHaveLength(0);
  expect((await getTask(ownerPage.request, task.id)).etag).toBe(task.etag);
});
