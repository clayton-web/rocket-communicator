import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { components } from '@aicaa/contracts/schema';
import {
  CapabilityUnavailableView,
  RecipientCapabilityPanel,
} from '@/app/c/[token]/recipient-capability-panel';
import CapabilityTokenPage, { metadata as pageMetadata } from '@/app/c/[token]/page';

type TaskDto = components['schemas']['Task'];

vi.mock('@/lib/capability/page-load', () => ({
  loadCapabilityPageView: vi.fn(),
}));

import { loadCapabilityPageView } from '@/lib/capability/page-load';

const token = 'capability-token-value-32chars-min!!';

function baseTask(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: 'task_ui_1',
    organizationId: 'org_ui',
    status: 'open',
    priorActionableStatus: null,
    summaryPoints: [
      {
        id: 'p1',
        kind: 'next_action',
        label: 'Next',
        order: 0,
        value: 'Follow up with the customer',
      },
    ],
    assignment: {
      id: 'asg_ui_1',
      recipientId: 'rcp_ui',
      intendedRecipientEmail: 'recipient@example.com',
      assignedAt: '2026-07-13T19:00:00.000Z',
      assignedByOwnerId: 'owner_ui',
      allowedCapabilityActions: [
        'view_assigned_task',
        'mark_task_waiting',
        'complete_task',
        'add_task_note',
        'return_task_to_owner',
        'request_clarification',
        'submit_work_request',
      ],
      activeCapabilityId: 'cap_ui_1',
    },
    dueAt: null,
    waitingUntil: null,
    priority: 'normal',
    derivedUrgency: 'normal',
    notes: [],
    reminder: {
      nextReminderAt: null,
      reminderStage: 0,
      waitingPaused: false,
    },
    retention: {
      deleteAfter: '2026-08-12T19:00:00.000Z',
      policy: 'active_task',
    },
    version: 2,
    etag: '"task-task_ui_1-v2"',
    createdAt: '2026-07-13T19:00:00.000Z',
    updatedAt: '2026-07-13T19:00:00.000Z',
    ...overrides,
  };
}

describe('Recipient capability page UI', () => {
  beforeEach(() => {
    vi.mocked(loadCapabilityPageView).mockReset();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => baseTask({ version: 3, etag: '"task-task_ui_1-v3"', status: 'waiting' }),
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('exports noindex metadata and robots protections', () => {
    expect(pageMetadata.robots).toMatchObject({ index: false, follow: false });
    expect(pageMetadata.referrer).toBe('no-referrer');
  });

  it('renders unavailable for invalid capability without Owner session', async () => {
    vi.mocked(loadCapabilityPageView).mockResolvedValue({ ok: false, reason: 'unavailable' });
    render(await CapabilityTokenPage({ params: Promise.resolve({ token }) }));
    expect(screen.getByRole('heading', { name: 'Link unavailable' })).toBeInTheDocument();
    expect(screen.queryByText(token)).not.toBeInTheDocument();
  });

  it('renders assigned task and scoped actions for a valid capability', async () => {
    const task = baseTask();
    vi.mocked(loadCapabilityPageView).mockResolvedValue({
      ok: true,
      task,
      permittedActions: [
        'view_assigned_task',
        'add_task_note',
        'return_task_to_owner',
        'complete_task',
      ],
      expiresAt: '2026-07-20T19:00:00.000Z',
    });
    render(await CapabilityTokenPage({ params: Promise.resolve({ token }) }));

    expect(screen.getByRole('heading', { name: 'Assigned task' })).toBeInTheDocument();
    expect(screen.getByText('Follow up with the customer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add note' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Return to owner' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark waiting' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Snooze' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
    expect(screen.queryByText(token)).not.toBeInTheDocument();
  });

  it('requires confirmation before POSTing and cancels without requesting', async () => {
    render(
      <RecipientCapabilityPanel
        token={token}
        initialTask={baseTask()}
        permittedActions={['view_assigned_task', 'add_task_note']}
        expiresAt="2026-07-20T19:00:00.000Z"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends confirmation, If-Match, and refreshes task state on success', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () =>
        baseTask({
          version: 3,
          etag: '"task-task_ui_1-v3"',
          notes: [
            {
              id: 'note_1',
              body: 'Typed note from recipient',
              createdAt: '2026-07-13T19:05:00.000Z',
              attribution: {
                kind: 'capability',
                capability: {
                  capabilityId: 'cap_ui_1',
                  assignmentId: 'asg_ui_1',
                  taskId: 'task_ui_1',
                  intendedRecipientEmail: 'recipient@example.com',
                  action: 'add_task_note',
                  recordedAt: '2026-07-13T19:05:00.000Z',
                  outcome: 'succeeded',
                },
              },
            },
          ],
        }),
    } as Response);

    render(
      <RecipientCapabilityPanel
        token={token}
        initialTask={baseTask()}
        permittedActions={['view_assigned_task', 'add_task_note']}
        expiresAt="2026-07-20T19:00:00.000Z"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    fireEvent.change(screen.getByLabelText('Note'), {
      target: { value: 'Typed note from recipient' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain(`/api/v1/capabilities/${encodeURIComponent(token)}/tasks/`);
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['if-match']).toBe('"task-task_ui_1-v2"');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      body: 'Typed note from recipient',
      confirmation: 'confirmed',
    });
    expect(init?.referrerPolicy).toBe('no-referrer');

    await waitFor(() => {
      expect(screen.getByText('Typed note from recipient')).toBeInTheDocument();
    });
  });

  it('reloads on 412 without retrying the mutation', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 412,
        json: async () => ({ error: { code: 'PRECONDITION_FAILED', message: 'stale' } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () =>
          baseTask({
            version: 4,
            etag: '"task-task_ui_1-v4"',
            status: 'in_progress',
            summaryPoints: [
              {
                id: 'p1',
                kind: 'next_action',
                label: 'Next',
                order: 0,
                value: 'Updated instructions',
              },
            ],
          }),
      } as Response);

    render(
      <RecipientCapabilityPanel
        token={token}
        initialTask={baseTask()}
        permittedActions={['view_assigned_task', 'add_task_note']}
        expiresAt="2026-07-20T19:00:00.000Z"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'stale attempt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/tasks/task_ui_1');
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('GET');
    await waitFor(() => {
      expect(screen.getByText('Updated instructions')).toBeInTheDocument();
      expect(
        screen.getByText('The task was updated. Please review the latest details and try again.'),
      ).toBeInTheDocument();
    });
  });

  it('shows return success and disables further actions', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () =>
        baseTask({
          assignment: undefined,
          version: 3,
          etag: '"task-task_ui_1-v3"',
        }),
    } as Response);

    render(
      <RecipientCapabilityPanel
        token={token}
        initialTask={baseTask()}
        permittedActions={['view_assigned_task', 'return_task_to_owner']}
        expiresAt="2026-07-20T19:00:00.000Z"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Return to owner' }));
    expect(screen.getByText(/Returning this assignment ends your access/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Returned to owner' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Return to owner' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('explains work request does not create a task', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        suggestion: {
          id: 'sug_1',
          organizationId: 'org_ui',
          status: 'pending',
          summaryPoints: baseTask().summaryPoints,
          sourceReference: undefined,
          proposedRecipientId: null,
          proposedDueAt: null,
          proposedPriority: 'normal',
          voiceOriginated: false,
          mergedIntoTaskId: null,
          retention: baseTask().retention,
          version: 1,
          etag: '"task-suggestion-sug_1-v1"',
          createdAt: '2026-07-13T19:10:00.000Z',
          updatedAt: '2026-07-13T19:10:00.000Z',
        },
        task: baseTask({ version: 3, etag: '"task-task_ui_1-v3"' }),
      }),
    } as Response);

    render(
      <RecipientCapabilityPanel
        token={token}
        initialTask={baseTask()}
        permittedActions={['view_assigned_task', 'submit_work_request']}
        expiresAt="2026-07-20T19:00:00.000Z"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Submit work request' }));
    expect(screen.getByText(/pending suggestion, not a new assigned task/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Please schedule a visit' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(
        screen.getByText('Work request submitted for owner review. No new task was created.'),
      ).toBeInTheDocument();
    });
  });

  it('shows the same unavailable copy for CapabilityUnavailableView', () => {
    render(<CapabilityUnavailableView />);
    expect(screen.getByRole('heading', { name: 'Link unavailable' })).toBeInTheDocument();
  });
});

/**
 * Recipient summary-point presentation (P1.5).
 *
 * The panel used to carry its own `summaryText` copy, the last of the three the P1.4
 * presentation refactor set out to remove. That copy returned `point.label` whenever a point
 * had no `value` field, while the eyebrow label above it returned `point.label` too — so
 * `amount`, `deadline`, and `missing_information` points printed their label twice in a row
 * and a screen reader announced the same wording twice.
 *
 * These assert rendered text rather than the helper in isolation, because the defect was
 * never in either helper alone: it was in rendering both of them for the same point.
 */
function pointItems(): string[] {
  return [...document.querySelectorAll('li')].map((item) => item.textContent ?? '');
}

function renderPanel(summaryPoints: TaskDto['summaryPoints'], overrides: Partial<TaskDto> = {}) {
  return render(
    <RecipientCapabilityPanel
      token={token}
      initialTask={baseTask({ summaryPoints, ...overrides })}
      permittedActions={['view_assigned_task', 'add_task_note']}
      expiresAt="2026-07-20T19:00:00.000Z"
    />,
  );
}

describe('Recipient summary point presentation', () => {
  // These assert element counts, so a leaked previous render would fail them for the wrong
  // reason. Vitest runs without globals here, so RTL's automatic cleanup is not registered.
  afterEach(cleanup);

  it('renders a value-less point once instead of repeating its label', () => {
    renderPanel([
      { id: 'p1', kind: 'amount', label: 'Invoice total', order: 0, amount: 4102, currency: 'USD' },
    ] as TaskDto['summaryPoints']);

    // Previously "Invoice totalInvoice total": the eyebrow and the body were the same words.
    expect(pointItems()).toEqual(['Invoice total']);
    expect(screen.getAllByText('Invoice total')).toHaveLength(1);
  });

  it('keeps the eyebrow label when it describes rather than repeats the point', () => {
    renderPanel([
      {
        id: 'p1',
        kind: 'next_action',
        label: 'Next',
        order: 0,
        value: 'Follow up with the customer',
      },
    ] as TaskDto['summaryPoints']);

    // A label that adds information is not a duplicate and must survive.
    expect(pointItems()).toEqual(['NextFollow up with the customer']);
  });

  it('preserves every distinct point, in order', () => {
    renderPanel([
      { id: 'p1', kind: 'next_action', label: 'Next', order: 0, value: 'Call Sarah' },
      { id: 'p2', kind: 'request', label: 'Request', order: 1, value: 'Send documents by Friday' },
      {
        id: 'p3',
        kind: 'deadline',
        label: 'Inspection deadline',
        order: 2,
        localDate: '2026-08-01',
      },
    ] as TaskDto['summaryPoints']);

    expect(pointItems()).toEqual([
      'NextCall Sarah',
      'RequestSend documents by Friday',
      'Inspection deadline',
    ]);
  });

  it('keeps a summary point that extends its label rather than repeating it', () => {
    renderPanel([
      {
        id: 'p1',
        kind: 'confirmed_fact',
        label: 'Call Sarah',
        order: 0,
        value: 'Call Sarah about the inspection report',
      },
    ] as TaskDto['summaryPoints']);

    // Only an exact match is a duplicate. Extra words are meaning, not repetition.
    expect(pointItems()).toEqual(['Call SarahCall Sarah about the inspection report']);
  });

  it('treats a whitespace-only difference as a duplicate, following summaryPointText', () => {
    renderPanel([
      { id: 'p1', kind: 'missing_information', label: '  Missing address  ', order: 0 },
    ] as unknown as TaskDto['summaryPoints']);

    // Both sides are trimmed by the shared rule, so the padding cannot smuggle a second copy.
    expect(pointItems()).toEqual(['Missing address']);
  });

  it('does not deduplicate two separate points that happen to share wording', () => {
    renderPanel([
      { id: 'p1', kind: 'next_action', label: 'Next', order: 0, value: 'Call Sarah' },
      { id: 'p2', kind: 'commitment', label: 'Commitment', order: 1, value: 'Call Sarah' },
    ] as TaskDto['summaryPoints']);

    // Suppression is scoped to one point's own label. Distinct points are Task data.
    expect(pointItems()).toEqual(['NextCall Sarah', 'CommitmentCall Sarah']);
  });

  it('renders no summary container at all when there are no points', () => {
    renderPanel([]);

    expect(screen.queryByRole('heading', { name: 'Instructions' })).not.toBeInTheDocument();
    // An empty list is a container that announces a structure with nothing in it.
    expect(document.querySelectorAll('ul')).toHaveLength(0);
  });

  it('leaves notes, actions, and status untouched by the summary change', () => {
    renderPanel(
      [
        { id: 'p1', kind: 'amount', label: 'Invoice total', order: 0, amount: 10, currency: 'USD' },
      ] as TaskDto['summaryPoints'],
      {
        notes: [
          {
            id: 'note_1',
            body: 'Recipient note stays visible',
            createdAt: '2026-07-13T19:05:00.000Z',
            attribution: { kind: 'owner', ownerUserId: 'owner_ui' },
          },
        ] as TaskDto['notes'],
      },
    );

    expect(screen.getByRole('heading', { name: 'Notes' })).toBeInTheDocument();
    expect(screen.getByText('Recipient note stays visible')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add note' })).toBeInTheDocument();
    expect(screen.getByText(/Status:/)).toBeInTheDocument();
  });

  it('renders no note timestamp, because this surface shows none', () => {
    renderPanel([] as TaskDto['summaryPoints'], {
      notes: [
        {
          id: 'note_1',
          body: 'Recipient note',
          createdAt: '2026-08-01T21:30:00.000Z',
          attribution: { kind: 'owner', ownerUserId: 'owner_ui' },
        },
      ] as TaskDto['notes'],
    });

    // Notes render their body only. Recorded so a future note timestamp is a deliberate
    // addition through the shared formatter rather than a reintroduced local one.
    expect(screen.getByText('Recipient note')).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toContain('2026-08-01');
    expect(document.body.textContent ?? '').not.toContain('2:30');
  });

  it('renders no capability token or internal identifier in the summary', () => {
    renderPanel([
      {
        id: 'p1_secret_id',
        kind: 'amount',
        label: 'Invoice total',
        order: 0,
        amount: 1,
        currency: 'USD',
      },
    ] as TaskDto['summaryPoints']);

    const body = document.body.textContent ?? '';
    expect(body).not.toContain(token);
    expect(body).not.toContain('p1_secret_id');
    expect(body).not.toContain('task_ui_1');
  });
});

/**
 * Recipient timestamps render in the organization timezone (P1.5, D117/D122).
 *
 * The panel used to call `toLocaleString(undefined, …)`, so the same deadline read one way to
 * the Owner who set it and another to the Recipient acting on it — the cross-surface
 * inconsistency D117 was approved to remove — and, this being a client component, differently
 * again between the server render and hydration. D122 recorded `/c/{token}` as a known gap
 * deferred to this slice.
 *
 * Every expectation below is a literal `America/Vancouver` rendering. That is deliberate: a
 * developer machine in Vancouver cannot tell a fixed zone from its own, so these strings are
 * only real evidence when the file also runs under a foreign `TZ`, which validation does.
 */
describe('Recipient timestamp presentation (P1.5)', () => {
  afterEach(cleanup);

  function renderWithTimestamps(
    overrides: Partial<TaskDto>,
    expiresAt = '2026-07-20T19:00:00.000Z',
  ) {
    return render(
      <RecipientCapabilityPanel
        token={token}
        initialTask={baseTask(overrides)}
        permittedActions={['view_assigned_task', 'add_task_note']}
        expiresAt={expiresAt}
      />,
    );
  }

  /** The status/date meta line, which is where all three Recipient timestamps render. */
  function metaLine(): string {
    const paragraph = [...document.querySelectorAll('p')].find((node) =>
      node.textContent?.startsWith('Status:'),
    );
    return paragraph?.textContent ?? '';
  }

  it('renders a due date in the organization timezone rather than the host timezone', () => {
    renderWithTimestamps({ dueAt: '2026-08-01T21:30:00.000Z' });
    expect(metaLine()).toContain('Due Aug 1, 2026');
  });

  it('renders the capability expiry as an instant carrying its zone', () => {
    renderWithTimestamps({}, '2026-07-20T19:00:00.000Z');
    expect(metaLine()).toContain('Link available until Jul 20, 2026, 12:00 p.m. PDT');
  });

  it('keeps a late-evening due instant on its organization calendar day', () => {
    // 22:00 in Vancouver, already the next day in UTC. A formatter that resolved the date in
    // UTC — or in any zone east of it — would advance the deadline by a day.
    renderWithTimestamps({ dueAt: '2026-08-02T05:00:00.000Z' });
    expect(metaLine()).toContain('Due Aug 1, 2026');
    expect(metaLine()).not.toContain('Aug 2, 2026');
  });

  it('renders a winter instant in standard time', () => {
    renderWithTimestamps({}, '2026-01-15T20:00:00.000Z');
    expect(metaLine()).toContain('Link available until Jan 15, 2026, 12:00 p.m. PST');
  });

  it.each([
    ['before spring forward', '2026-03-08T09:59:00.000Z', 'Mar 8, 2026, 1:59 a.m. PST'],
    ['after spring forward', '2026-03-08T10:01:00.000Z', 'Mar 8, 2026, 3:01 a.m. PDT'],
    ['first pass of the repeated hour', '2026-11-01T08:30:00.000Z', 'Nov 1, 2026, 1:30 a.m. PDT'],
    ['second pass of the repeated hour', '2026-11-01T09:30:00.000Z', 'Nov 1, 2026, 1:30 a.m. PST'],
  ])('resolves daylight saving %s', (_label, expiresAt, expected) => {
    renderWithTimestamps({}, expiresAt);
    expect(metaLine()).toContain(`Link available until ${expected}`);
  });

  it('renders a waiting-until date without a time of day, matching the Owner surface', () => {
    renderWithTimestamps({ status: 'waiting', waitingUntil: '2026-09-04T23:00:00.000Z' });
    expect(metaLine()).toContain('Waiting until Sep 4, 2026');
    expect(metaLine()).not.toContain('4:00 p.m.');
  });

  it('omits absent optional timestamps instead of claiming a date', () => {
    renderWithTimestamps({ dueAt: null, waitingUntil: null });
    const meta = metaLine();
    expect(meta).toContain('Status:');
    expect(meta).not.toContain('Due');
    expect(meta).not.toContain('Waiting until');
    expect(meta).not.toContain('Unknown date');
  });

  it('omits an unparseable timestamp rather than rendering a fabricated one', () => {
    renderWithTimestamps({ dueAt: 'not-a-timestamp' as TaskDto['dueAt'] });
    const meta = metaLine();
    expect(meta).not.toContain('Due');
    expect(meta).not.toContain('Unknown date');
    expect(meta).not.toContain('Invalid Date');
  });

  it('exposes no raw ISO timestamp to the Recipient', () => {
    renderWithTimestamps({ dueAt: '2026-08-01T21:30:00.000Z' }, '2026-07-20T19:00:00.000Z');
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('2026-08-01T21:30:00.000Z');
    expect(body).not.toContain('2026-07-20T19:00:00.000Z');
  });

  it('leaves summary points, notes, status, and actions in place', () => {
    renderWithTimestamps({
      dueAt: '2026-08-01T21:30:00.000Z',
      notes: [
        {
          id: 'note_1',
          body: 'Existing note',
          createdAt: '2026-07-14T19:00:00.000Z',
          attribution: { kind: 'owner', ownerUserId: 'owner_ui' },
        },
      ] as TaskDto['notes'],
    });

    expect(screen.getByText('Follow up with the customer')).toBeInTheDocument();
    expect(screen.getByText('Existing note')).toBeInTheDocument();
    expect(metaLine()).toContain('Status:');
    expect(screen.getByRole('button', { name: /note/i })).toBeInTheDocument();
  });
});

/**
 * Source guards for the Recipient timestamp path.
 *
 * Behavioural tests above prove the current output. These prove the *mechanism*, so a future
 * edit cannot restore host-timezone rendering while still producing correct strings on a
 * machine that happens to sit in Vancouver.
 */
describe('Recipient timestamp source guards (P1.5)', () => {
  const readSource = async (relative: string) => {
    const { readFileSync } = await import('node:fs');
    return readFileSync(new URL(relative, import.meta.url), 'utf8');
  };

  /**
   * Source with comments removed, so a guard reads what the file *does*.
   *
   * The panel's comment records the API this change removed, and a naive substring search
   * cannot tell that mention apart from a real call.
   */
  const readCode = async (relative: string) =>
    (await readSource(relative)).replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/\/\/.*$/gm, '');

  it('leaves no environment-dependent date formatting in the Recipient panel', async () => {
    const code = await readCode('../app/c/[token]/recipient-capability-panel.tsx');

    expect(code).not.toContain('toLocaleString');
    expect(code).not.toContain('toLocaleDateString');
    expect(code).not.toContain('toLocaleTimeString');
    // A formatter built here would carry its own zone decision, which is the thing D117
    // centralized; the panel must reach the zone only through the shared module.
    expect(code).not.toContain('Intl.DateTimeFormat');
    expect(code).toContain("from '@/lib/presentation/datetime'");
  });

  it('leaves the shared module as the only place naming the organization timezone', async () => {
    const datetime = await readSource('../lib/presentation/datetime.ts');
    const panel = await readCode('../app/c/[token]/recipient-capability-panel.tsx');

    expect(datetime).toContain("OWNER_DISPLAY_TIME_ZONE = 'America/Vancouver'");
    expect(panel).not.toContain('America/Vancouver');
  });

  it('leaves the Owner callers on the formatters they already used', async () => {
    const detail = await readSource('../app/(owner)/tasks/_components/task-detail.tsx');
    const list = await readSource('../app/(owner)/tasks/_components/task-list.tsx');

    expect(detail).toContain('formatOwnerDate(task.dueAt)');
    expect(detail).toContain('formatOwnerDate(task.waitingUntil)');
    expect(detail).toContain('formatOwnerDateTime(note.createdAt)');
    expect(list).toContain('formatOwnerDate(task.dueAt)');
  });

  it('changes no capability authorization, token, or write behaviour', async () => {
    const source = await readSource('../app/c/[token]/recipient-capability-panel.tsx');

    // The panel remains a presentation component: it reads the token only to pass it to the
    // existing client API, and performs no token parsing or authorization of its own.
    expect(source).not.toContain('createHash');
    expect(source).not.toContain('pepper');
    expect(source).not.toContain('validateCapabilityToken');
  });
});
