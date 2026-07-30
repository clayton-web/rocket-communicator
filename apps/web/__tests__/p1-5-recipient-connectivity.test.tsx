// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { components } from '@aicaa/contracts/schema';
import { RecipientCapabilityPanel } from '@/app/c/[token]/recipient-capability-panel';

type TaskDto = components['schemas']['Task'];

/**
 * Truthful Recipient connectivity feedback (P1.5 / D112 clause 5).
 *
 * Two defects motivated this suite, both measured in a browser before being fixed. A
 * submission made while the browser reported itself offline was dispatched anyway and then
 * described as "may or may not have been saved", inventing uncertainty about a request that
 * had not been sent. And every failure message rendered underneath the confirmation dialog's
 * backdrop — `document.elementFromPoint` at the paragraph's own centre returned the backdrop
 * — so the one moment the Recipient most needed feedback was the one moment they could not
 * see it. Playwright's `toBeVisible()` does not test occlusion, which is why the existing
 * transport-failure spec passed throughout.
 */

const token = 'capability-token-value-32chars-min!!';

function baseTask(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: 'task_conn_1',
    organizationId: 'org_conn',
    status: 'open',
    priorActionableStatus: null,
    summaryPoints: [
      { id: 'p1', kind: 'next_action', label: 'Next', order: 0, value: 'Follow up' },
    ] as TaskDto['summaryPoints'],
    assignment: {
      id: 'asg_conn_1',
      recipientId: 'rcp_conn',
      intendedRecipientEmail: 'recipient@example.com',
      assignedAt: '2026-07-13T19:00:00.000Z',
      assignedByOwnerId: 'owner_conn',
      allowedCapabilityActions: ['view_assigned_task', 'add_task_note', 'complete_task'],
      activeCapabilityId: 'cap_conn_1',
    } as TaskDto['assignment'],
    dueAt: null,
    waitingUntil: null,
    priority: 'normal',
    derivedUrgency: 'normal',
    notes: [],
    reminder: { nextReminderAt: null, reminderStage: 0, waitingPaused: false },
    retention: { deleteAfter: '2026-08-12T19:00:00.000Z', policy: 'active_task' },
    version: 2,
    etag: '"task-task_conn_1-v2"',
    createdAt: '2026-07-13T19:00:00.000Z',
    updatedAt: '2026-07-13T19:00:00.000Z',
    ...overrides,
  } as TaskDto;
}

function renderPanel() {
  return render(
    <RecipientCapabilityPanel
      token={token}
      initialTask={baseTask()}
      permittedActions={['view_assigned_task', 'add_task_note', 'complete_task']}
      expiresAt="2026-07-20T19:00:00.000Z"
    />,
  );
}

/** Report the browser as definitely offline, the one reading the client may act on. */
function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
}

/** Open the Add note dialog and type a draft into it. */
async function openNoteDialogWithDraft(draft = 'Draft the Recipient typed') {
  fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(screen.getByLabelText('Note', { exact: true }), { target: { value: draft } });
  return dialog;
}

function confirmButton() {
  return screen.getByRole('button', { name: /^(Confirm|Submitting…)$/ });
}

/** Text of the outcome message, wherever it currently renders. */
function outcomeText(): string {
  return screen
    .queryAllByRole('status')
    .map((node) => node.textContent ?? '')
    .join(' ');
}

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe('Recipient connectivity feedback', () => {
  beforeEach(() => {
    setOnLine(true);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    setOnLine(true);
  });

  it('does not dispatch a known-offline submission, and says so plainly', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    await openNoteDialogWithDraft();

    setOnLine(false);
    fireEvent.click(confirmButton());

    await waitFor(() => expect(outcomeText()).toMatch(/offline/i));
    // The claim "was not sent" is only safe because nothing was dispatched.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(outcomeText()).toMatch(/not sent/i);
    // And it must not borrow the ambiguous wording, which would be false here.
    expect(outcomeText()).not.toMatch(/may or may not/i);
  });

  it('keeps the typed note and a usable control after an offline attempt', async () => {
    vi.stubGlobal('fetch', vi.fn());
    renderPanel();
    await openNoteDialogWithDraft('Please confirm the delivery window');

    setOnLine(false);
    fireEvent.click(confirmButton());
    await waitFor(() => expect(outcomeText()).toMatch(/offline/i));

    expect(screen.getByLabelText('Note', { exact: true })).toHaveValue(
      'Please confirm the delivery window',
    );
    expect(confirmButton()).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('describes a dispatched request with no answer as unconfirmed, never as sent or saved', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderPanel();
    await openNoteDialogWithDraft();

    fireEvent.click(confirmButton());

    await waitFor(() => expect(outcomeText()).toMatch(/may or may not have been saved/i));
    expect(outcomeText()).not.toMatch(/^Saved\.$/m);
    // The opposite false certainty is equally forbidden: it may well have arrived.
    expect(outcomeText()).not.toMatch(/not sent|did not reach the server\.$/i);
    expect(outcomeText()).not.toMatch(/offline/i);
    expect(confirmButton()).toBeEnabled();
  });

  it('preserves the note draft through an unconfirmed submission', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderPanel();
    await openNoteDialogWithDraft('Unconfirmed but still typed');

    fireEvent.click(confirmButton());
    await waitFor(() => expect(outcomeText()).toMatch(/may or may not/i));

    expect(screen.getByLabelText('Note', { exact: true })).toHaveValue(
      'Unconfirmed but still typed',
    );
  });

  it('reports a definite rejection as a rejection, not as a connectivity problem', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse(403, { error: { code: 'FORBIDDEN', message: 'nope' } })),
    );
    renderPanel();
    await openNoteDialogWithDraft();

    fireEvent.click(confirmButton());

    await waitFor(() => expect(outcomeText()).toMatch(/does not permit that action/i));
    expect(outcomeText()).not.toMatch(/offline|may or may not/i);
  });

  it('reports a server failure truthfully without leaking the response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(500, {
          error: { code: 'INTERNAL', message: 'psql: FATAL role "aicaa" does not exist' },
        }),
      ),
    );
    renderPanel();
    await openNoteDialogWithDraft();

    fireEvent.click(confirmButton());

    await waitFor(() => expect(outcomeText()).toMatch(/temporary error/i));
    expect(outcomeText()).not.toMatch(/psql|FATAL|role "aicaa"/);
    expect(outcomeText()).not.toMatch(/offline|may or may not/i);
  });

  it('keeps the confirmed-success transition and clears the note only then', async () => {
    const saved = baseTask({
      version: 3,
      etag: '"task-task_conn_1-v3"',
      notes: [
        {
          id: 'note_1',
          body: 'Draft the Recipient typed',
          createdAt: '2026-07-14T19:00:00.000Z',
          attribution: { kind: 'recipient', recipientId: 'rcp_conn' },
        },
      ] as TaskDto['notes'],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, saved)));
    renderPanel();
    await openNoteDialogWithDraft();

    fireEvent.click(confirmButton());

    await waitFor(() => expect(outcomeText()).toMatch(/^Saved\.$/));
    // The dialog closes on success, which is what discards the draft — never before.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Draft the Recipient typed')).toBeInTheDocument();
  });

  it('sends one request however many times Confirm is clicked', async () => {
    let resolve: ((value: unknown) => void) | undefined;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    await openNoteDialogWithDraft();

    fireEvent.click(confirmButton());
    fireEvent.click(confirmButton());
    fireEvent.click(confirmButton());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(confirmButton()).toBeDisabled();

    resolve?.(jsonResponse(200, baseTask({ version: 3 })));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('leaves no control stuck busy after any outcome', async () => {
    const outcomes = [
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => Promise.resolve(jsonResponse(403, { error: { message: 'no' } })),
      () => Promise.resolve(jsonResponse(500, { error: { message: 'no' } })),
    ];

    for (const outcome of outcomes) {
      vi.stubGlobal('fetch', vi.fn().mockImplementation(outcome));
      renderPanel();
      await openNoteDialogWithDraft();
      fireEvent.click(confirmButton());

      await waitFor(() => expect(confirmButton()).toBeEnabled());
      expect(screen.queryByText('Submitting…')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
      cleanup();
    }
  });

  it('lets the Recipient leave the dialog after a failure instead of trapping them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderPanel();
    await openNoteDialogWithDraft();

    fireEvent.click(confirmButton());
    await waitFor(() => expect(outcomeText()).toMatch(/may or may not/i));

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add note' })).toBeEnabled();
  });

  it('does not resubmit or clear the message when the browser comes back online', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    await openNoteDialogWithDraft();

    setOnLine(false);
    fireEvent.click(confirmButton());
    await waitFor(() => expect(outcomeText()).toMatch(/offline/i));

    setOnLine(true);
    fireEvent(window, new Event('online'));

    // Connectivity returning is not a Recipient decision to submit, and it is not evidence
    // that the next request would arrive either.
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(outcomeText()).toMatch(/offline/i);
    expect(screen.getByLabelText('Note', { exact: true })).toHaveValue('Draft the Recipient typed');
  });

  it('offers no retry control that would repeat a non-idempotent action', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderPanel();
    await openNoteDialogWithDraft();

    fireEvent.click(confirmButton());
    await waitFor(() => expect(outcomeText()).toMatch(/may or may not/i));

    // Adding a note twice creates two notes, so the recovery offered is to re-read the Task
    // and decide, never a one-click repeat.
    expect(screen.queryByRole('button', { name: /retry|try again|resend/i })).toBeNull();
    expect(outcomeText()).toMatch(/reload this page/i);
  });

  it('names no token, task, or internal identifier in any outcome message', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(409, { error: { code: 'CONFLICT', message: 'task_conn_1 conflict' } }),
        ),
    );
    renderPanel();
    await openNoteDialogWithDraft();

    fireEvent.click(confirmButton());
    await waitFor(() => expect(outcomeText()).toMatch(/no longer allowed/i));

    const text = outcomeText();
    expect(text).not.toContain(token);
    expect(text).not.toContain('task_conn_1');
    expect(text).not.toContain('cap_conn_1');
    expect(text).not.toContain('asg_conn_1');
  });

  it('announces the outcome through exactly one status region', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderPanel();
    await openNoteDialogWithDraft();

    fireEvent.click(confirmButton());
    await waitFor(() => expect(outcomeText()).toMatch(/may or may not/i));

    // One region, so the message is not announced twice by a page-level and dialog copy.
    expect(screen.getAllByRole('status')).toHaveLength(1);
    // And it is inside the dialog, which is what covers the page.
    expect(screen.getByRole('dialog')).toContainElement(screen.getByRole('status'));
  });
});

/**
 * Structural guards for the recovery policy.
 *
 * The behavioural tests describe what happens after one failure. These describe what can
 * never be added quietly: a client that resubmits on its own turns an unconfirmed note into
 * a duplicated one, and no assertion about a single attempt would notice.
 */
describe('Recipient connectivity source guards', () => {
  const read = (relative: string) =>
    readFileSync(join(__dirname, '..', relative), 'utf8')
      .replaceAll(/\/\*[\s\S]*?\*\//g, '')
      .replaceAll(/\/\/.*$/gm, '');

  const panel = read('app/c/[token]/recipient-capability-panel.tsx');
  const clientApi = read('lib/capability/client-api.ts');

  it.each([
    ['the panel', () => panel],
    ['the client API', () => clientApi],
  ])('adds no automatic retry or background delivery in %s', (_label, source) => {
    const code = source();

    expect(code).not.toMatch(/serviceWorker|BackgroundSync|SyncManager|workbox/);
    expect(code).not.toMatch(/setInterval|requestIdleCallback/);
    expect(code).not.toMatch(/retryCount|maxRetries|backoff|\bretry\(/i);
    expect(code).not.toMatch(/sendBeacon|keepalive/);
  });

  it('registers no connectivity listener that could resubmit', () => {
    // The offline reading is taken at the moment of a deliberate submission and nowhere else,
    // so there is no handler that could fire a request the Recipient did not ask for.
    expect(panel).not.toMatch(/addEventListener\(\s*['"]online['"]/);
    expect(panel).not.toMatch(/addEventListener\(\s*['"]offline['"]/);
    expect(clientApi).not.toMatch(/addEventListener/);
  });

  it('reads the offline signal only in the safe direction', () => {
    // `=== false` is the whole contract: a browser claiming to be online proves nothing, so
    // a truthy check must never become a precondition for attempting a request.
    expect(clientApi).toContain('navigator.onLine === false');
    expect(clientApi).not.toMatch(/navigator\.onLine\s*===\s*true/);
    expect(clientApi).not.toMatch(/if\s*\(\s*navigator\.onLine\s*\)/);
    expect(panel).not.toContain('navigator.onLine');
  });

  it('renders no raw exception or response body to the Recipient', () => {
    expect(panel).not.toMatch(/error\.message|err\.message|String\(error\)/);
    expect(panel).not.toMatch(/JSON\.stringify\(/);
    // Server copy always passes through the public mapper.
    expect(panel).toContain('publicErrorMessage(');
  });

  it('leaves the post-dispatch path free of cause guessing', () => {
    // Once a request has left the browser, its rejection type says nothing about whether the
    // server committed, so nothing may branch on it to soften the ambiguous outcome.
    expect(clientApi).not.toMatch(/instanceof TypeError/);
    expect(clientApi).not.toMatch(/error\.name\s*===/);
  });
});
