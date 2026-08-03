// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { components } from '@aicaa/contracts/schema';
import { ReminderPanel } from '@/app/(owner)/tasks/_components/reminder-panel';

type TaskReminderState = components['schemas']['TaskReminderState'];

const TASK_ID = 'task_a86b_panel';
const ETAG_V4 = '"task-reminder-task_a86b_panel-v4"';
const ETAG_V5 = '"task-reminder-task_a86b_panel-v5"';
const TASK_ETAG = '"task-task_a86b_panel-v4"';

vi.mock('@/lib/owner/api-client', () => ({
  fetchTaskReminder: vi.fn(),
  putTaskReminder: vi.fn(),
  deleteTaskReminder: vi.fn(),
}));

import { deleteTaskReminder, fetchTaskReminder, putTaskReminder } from '@/lib/owner/api-client';

const putMock = vi.mocked(putTaskReminder);
const deleteMock = vi.mocked(deleteTaskReminder);
const fetchMock = vi.mocked(fetchTaskReminder);

function reminder(overrides: Partial<TaskReminderState> = {}): TaskReminderState {
  return {
    taskId: TASK_ID,
    etag: ETAG_V4,
    dueLocalDate: '2026-08-20',
    schedulingTimeZone: 'America/Vancouver',
    state: 'active',
    generation: 1,
    advance: {
      disposition: 'scheduled',
      occurrence: { localDate: '2026-08-18', at: '2026-08-18T16:00:00.000Z' },
    },
    nextOverdueOccurrence: { localDate: '2026-08-21', at: '2026-08-21T16:00:00.000Z' },
    overdueDeliveredCount: 0,
    requiresOwnerAttention: false,
    stopReason: null,
    ...overrides,
  };
}

function renderPanel(
  input: {
    state?: TaskReminderState;
    taskStatus?: 'open' | 'waiting' | 'completed' | 'dismissed' | 'in_progress';
  } = {},
) {
  return render(
    <ReminderPanel
      taskId={TASK_ID}
      taskStatus={input.taskStatus ?? 'open'}
      initialReminder={input.state ?? reminder()}
    />,
  );
}

function dateInput(): HTMLInputElement {
  return screen.getByLabelText(/reminder due date/i) as HTMLInputElement;
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', {
    name: /^(Set|Save) reminder due date$/,
  }) as HTMLButtonElement;
}

/** Open the removal dialog and tick its confirmation checkbox. */
function armRemoval(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Remove reminder due date' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('checkbox'));
}

beforeEach(() => {
  putMock.mockReset();
  deleteMock.mockReset();
  fetchMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('A8.6b reminder panel: rendering', () => {
  it('is correct on first paint without issuing a request', () => {
    renderPanel();

    expect(screen.getByRole('heading', { name: 'Reminders', level: 2 })).toBeTruthy();
    expect(screen.getByText('Aug 20, 2026')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offers the due-date control on a Task with no due date', () => {
    renderPanel({
      state: reminder({
        state: 'no_due_date',
        dueLocalDate: null,
        advance: null,
        nextOverdueOccurrence: null,
        overdueDeliveredCount: null,
      }),
    });

    expect(dateInput().value).toBe('');
    expect(screen.getByRole('button', { name: 'Set reminder due date' })).toBeTruthy();
    // Nothing to remove yet.
    expect(screen.queryByRole('button', { name: 'Remove reminder due date' })).toBeNull();
  });

  it('explains a Waiting suspension and offers no resume control', () => {
    renderPanel({ state: reminder({ state: 'suspended_waiting' }), taskStatus: 'waiting' });

    expect(screen.getByText(/paused because this Task is Waiting/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /resume/i })).toBeNull();
  });

  it('explains a stopped schedule that needs attention, and how to repair it', () => {
    renderPanel({
      state: reminder({
        state: 'stopped',
        stopReason: 'repeated_ambiguous_outcomes',
        requiresOwnerAttention: true,
      }),
    });

    expect(screen.getByText(/could not confirm that recent reminders were delivered/)).toBeTruthy();
    expect(screen.getByText(/Setting a due date starts a new reminder cycle/)).toBeTruthy();
  });

  /*
   * The controls the milestone forbids. None is ratified, and each would either conflict with D129
   * or promise an action no endpoint performs.
   */
  it('offers no resend, send-now, or retry control in any state', () => {
    for (const state of [
      'no_due_date',
      'not_scheduled',
      'active',
      'suspended_waiting',
      'stopped',
    ] as const) {
      const { unmount } = renderPanel({
        state: reminder({
          state,
          stopReason: state === 'stopped' ? 'permanent_delivery_failure' : null,
        }),
      });

      for (const forbidden of [
        /resend/i,
        /send now/i,
        /send again/i,
        /retry/i,
        /force/i,
        /reset/i,
      ]) {
        expect(
          screen.queryByRole('button', { name: forbidden }),
          `${state} offered a forbidden control`,
        ).toBeNull();
      }
      unmount();
    }
  });

  it('does not poll or refresh itself', async () => {
    vi.useFakeTimers();
    try {
      renderPanel();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('A8.6b reminder panel: D104 disclosure', () => {
  it('shows no restart disclosure before the Owner touches the date', () => {
    renderPanel();
    expect(screen.queryByText(/starts a new reminder cycle/)).toBeNull();
  });

  it('shows no restart disclosure for the first due date', () => {
    renderPanel({ state: reminder({ state: 'no_due_date', dueLocalDate: null }) });
    fireEvent.change(dateInput(), { target: { value: '2026-09-01' } });

    expect(screen.queryByText(/starts a new reminder cycle/)).toBeNull();
  });

  it('shows no restart disclosure for re-selecting the same date', () => {
    renderPanel();
    fireEvent.change(dateInput(), { target: { value: '2026-09-01' } });
    fireEvent.change(dateInput(), { target: { value: '2026-08-20' } });

    expect(screen.queryByText(/starts a new reminder cycle/)).toBeNull();
  });

  it('discloses the restart, the count reset, and the recalculation before submission', () => {
    renderPanel();
    fireEvent.change(dateInput(), { target: { value: '2026-09-01' } });

    const disclosure = screen.getByText(/Saving this starts a new reminder cycle/);
    expect(disclosure.textContent).toMatch(/back\s+to\s+zero/);
    expect(disclosure.textContent).toMatch(/worked out again from the new date/);
    expect(disclosure.textContent).toMatch(/already sent stays on the record/);
    // Shown before the request, not after it.
    expect(putMock).not.toHaveBeenCalled();
  });

  it('ties the disclosure to the input for assistive technology', () => {
    renderPanel();
    fireEvent.change(dateInput(), { target: { value: '2026-09-01' } });

    const described = dateInput().getAttribute('aria-describedby') ?? '';
    const disclosureId = screen
      .getByText(/Saving this starts a new reminder cycle/)
      .getAttribute('id');
    expect(disclosureId).toBeTruthy();
    expect(described.split(' ')).toContain(disclosureId);
  });

  it('discloses the restart when re-saving the same date on a stopped schedule', () => {
    renderPanel({
      state: reminder({
        state: 'stopped',
        stopReason: 'overdue_ceiling_reached',
        requiresOwnerAttention: true,
      }),
    });
    fireEvent.change(dateInput(), { target: { value: '2026-08-20' } });

    expect(screen.getByText(/Saving this starts a new reminder cycle/)).toBeTruthy();
  });
});

describe('A8.6b reminder panel: saving a due date', () => {
  it('sends the reminder ETag and adopts the authoritative response', async () => {
    putMock.mockResolvedValue({
      ok: true,
      data: reminder({ etag: ETAG_V5, dueLocalDate: '2026-09-01' }),
      etag: ETAG_V5,
    });

    renderPanel();
    fireEvent.change(dateInput(), { target: { value: '2026-09-01' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
    expect(putMock).toHaveBeenCalledWith({
      taskId: TASK_ID,
      dueLocalDate: '2026-09-01',
      ifMatch: ETAG_V4,
    });
    expect(putMock.mock.calls[0]?.[0].ifMatch).not.toBe(TASK_ETAG);

    await screen.findByText(/Due date saved/);
    expect(screen.getByText('Sep 1, 2026')).toBeTruthy();
  });

  it('never claims a reminder was sent because the schedule was saved', async () => {
    putMock.mockResolvedValue({
      ok: true,
      data: reminder({ etag: ETAG_V5, dueLocalDate: '2026-09-01' }),
      etag: ETAG_V5,
    });

    renderPanel();
    fireEvent.change(dateInput(), { target: { value: '2026-09-01' } });
    fireEvent.click(saveButton());

    const banner = await screen.findByText(/Due date saved/);
    expect(banner.textContent).toContain('no reminder has been sent');
  });

  /*
   * An immaterial repeat is a real server behaviour (D104): same ETag back, nothing written. Calling
   * that "saved" would tell an Owner a new cycle began when none did.
   */
  it('distinguishes an unchanged save from a real one', async () => {
    putMock.mockResolvedValue({ ok: true, data: reminder(), etag: ETAG_V4 });

    renderPanel();
    fireEvent.click(saveButton());

    await screen.findByText(/already this Task’s due date, so nothing changed/);
    expect(screen.queryByText(/Due date saved/)).toBeNull();
  });

  it('blocks a second submission while the first is in flight', async () => {
    let release: ((value: { ok: true; data: TaskReminderState; etag: string }) => void) | undefined;
    putMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    renderPanel();
    fireEvent.change(dateInput(), { target: { value: '2026-09-01' } });
    const button = saveButton();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('true'));
    expect(putMock).toHaveBeenCalledTimes(1);

    release?.({
      ok: true,
      data: reminder({ etag: ETAG_V5, dueLocalDate: '2026-09-01' }),
      etag: ETAG_V5,
    });
    await screen.findByText(/Due date saved/);
    expect(putMock).toHaveBeenCalledTimes(1);
  });

  it('announces pending work politely without claiming an outcome', async () => {
    putMock.mockImplementation(() => new Promise(() => {}));

    renderPanel();
    fireEvent.change(dateInput(), { target: { value: '2026-09-01' } });
    fireEvent.click(saveButton());

    const pending = await screen.findByText(/The outcome is not known yet/);
    expect(pending.closest('[aria-live="polite"]')).toBeTruthy();
  });

  /*
   * jsdom blanks an impossible date the way a real date control does, so the DOM path can only
   * reach the empty case. The calendar-reality rule is exercised directly against `dueDateProblem`
   * in `a8-6b-reminder-due-date.test.ts`.
   */
  it('refuses to submit an empty date without contacting the server', () => {
    renderPanel({ state: reminder({ state: 'no_due_date', dueLocalDate: null }) });
    fireEvent.click(saveButton());

    expect(screen.getByRole('alert').textContent).toContain('Choose a due date');
    expect(putMock).not.toHaveBeenCalled();
  });

  it('marks the input invalid while a validation message is showing', () => {
    renderPanel({ state: reminder({ state: 'no_due_date', dueLocalDate: null }) });
    fireEvent.click(saveButton());

    expect(dateInput().getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(dateInput(), { target: { value: '2026-09-01' } });
    expect(dateInput().getAttribute('aria-invalid')).toBe('false');
  });

  /*
   * The date is carried as text end to end. Constructing a `Date` from it in the browser's own
   * timezone is how "2026-09-01" becomes the thirty-first for an Owner east of the organization.
   */
  it('sends the exact calendar date the Owner chose, with no timezone shift', async () => {
    putMock.mockResolvedValue({
      ok: true,
      data: reminder({ etag: ETAG_V5, dueLocalDate: '2026-01-01' }),
      etag: ETAG_V5,
    });

    renderPanel();
    fireEvent.change(dateInput(), { target: { value: '2026-01-01' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(putMock).toHaveBeenCalled());
    expect(putMock.mock.calls[0]?.[0].dueLocalDate).toBe('2026-01-01');
  });

  it('offers no time picker, because reminder timing is policy', () => {
    renderPanel();
    expect(dateInput().type).toBe('date');
    expect(screen.queryByLabelText(/time/i)).toBeNull();
  });
});

describe('A8.6b reminder panel: concurrency and unknown outcomes', () => {
  /*
   * A `412` is a concurrency resolution path, not a failure. The panel re-reads, shows the server's
   * truth, and waits for the Owner — it must not resubmit with a fresh token, which would repeat an
   * action they never reconfirmed.
   */
  it('resolves a stale ETag by re-reading and showing the current state, without retrying', async () => {
    putMock.mockResolvedValue({
      ok: false,
      error: {
        status: 412,
        code: 'PRECONDITION_FAILED',
        message: 'x',
        outcomeCategory: 'stale',
        allowSameKeyRetry: false,
        allowNewOperation: true,
        refetchTask: true,
        refetchRecipients: false,
      },
    });
    fetchMock.mockResolvedValue({
      ok: true,
      data: reminder({ etag: ETAG_V5, dueLocalDate: '2026-10-10' }),
      etag: ETAG_V5,
    });

    renderPanel();
    fireEvent.change(dateInput(), { target: { value: '2026-09-01' } });
    fireEvent.click(saveButton());

    await screen.findByText(/changed somewhere else/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(putMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Oct 10, 2026')).toBeTruthy();
  });

  it('adopts the re-read ETag so the next submission uses the current token', async () => {
    putMock
      .mockResolvedValueOnce({
        ok: false,
        error: {
          status: 412,
          code: 'PRECONDITION_FAILED',
          message: 'x',
          outcomeCategory: 'stale',
          allowSameKeyRetry: false,
          allowNewOperation: true,
          refetchTask: true,
          refetchRecipients: false,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: reminder({ etag: '"task-reminder-task_a86b_panel-v6"', dueLocalDate: '2026-09-01' }),
        etag: '"task-reminder-task_a86b_panel-v6"',
      });
    fetchMock.mockResolvedValue({
      ok: true,
      data: reminder({ etag: ETAG_V5, dueLocalDate: '2026-10-10' }),
      etag: ETAG_V5,
    });

    renderPanel();
    fireEvent.change(dateInput(), { target: { value: '2026-09-01' } });
    fireEvent.click(saveButton());
    await screen.findByText(/changed somewhere else/);

    fireEvent.click(saveButton());
    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(2));
    expect(putMock.mock.calls[1]?.[0].ifMatch).toBe(ETAG_V5);
  });

  it('reports an unanswered save as unknown and says whether it appears to have applied', async () => {
    putMock.mockResolvedValue({
      ok: false,
      error: {
        status: 0,
        code: 'UNKNOWN',
        message: 'x',
        outcomeCategory: 'ambiguous',
        allowSameKeyRetry: true,
        allowNewOperation: false,
        refetchTask: false,
        refetchRecipients: false,
      },
    });
    fetchMock.mockResolvedValue({
      ok: true,
      data: reminder({ etag: ETAG_V5, dueLocalDate: '2026-09-01' }),
      etag: ETAG_V5,
    });

    renderPanel();
    fireEvent.change(dateInput(), { target: { value: '2026-09-01' } });
    fireEvent.click(saveButton());

    const banner = await screen.findByText(/did not get an answer/);
    expect(banner.textContent).toContain('now matches what you asked for');
    expect(putMock).toHaveBeenCalledTimes(1);
  });

  it('says plainly when an unanswered save did not apply', async () => {
    putMock.mockResolvedValue({
      ok: false,
      error: {
        status: 0,
        code: 'UNKNOWN',
        message: 'x',
        outcomeCategory: 'ambiguous',
        allowSameKeyRetry: true,
        allowNewOperation: false,
        refetchTask: false,
        refetchRecipients: false,
      },
    });
    fetchMock.mockResolvedValue({ ok: true, data: reminder(), etag: ETAG_V4 });

    renderPanel();
    fireEvent.change(dateInput(), { target: { value: '2026-09-01' } });
    fireEvent.click(saveButton());

    const banner = await screen.findByText(/did not get an answer/);
    expect(banner.textContent).toContain('has not changed');
    expect(banner.textContent).not.toMatch(/\bfailed\b/i);
  });

  it('preserves the Owner’s chosen date through an unresolved outcome', async () => {
    putMock.mockResolvedValue({
      ok: false,
      error: {
        status: 0,
        code: 'UNKNOWN',
        message: 'x',
        outcomeCategory: 'ambiguous',
        allowSameKeyRetry: true,
        allowNewOperation: false,
        refetchTask: false,
        refetchRecipients: false,
      },
    });
    fetchMock.mockResolvedValue({ ok: true, data: reminder(), etag: ETAG_V4 });

    renderPanel();
    fireEvent.change(dateInput(), { target: { value: '2026-09-01' } });
    fireEvent.click(saveButton());
    await screen.findByText(/did not get an answer/);

    expect(dateInput().value).toBe('2026-09-01');
  });

  /* The one case where the panel genuinely cannot say what happened, and says exactly that. */
  it('admits when even the authoritative re-read failed', async () => {
    putMock.mockResolvedValue({
      ok: false,
      error: {
        status: 0,
        code: 'UNKNOWN',
        message: 'x',
        outcomeCategory: 'ambiguous',
        allowSameKeyRetry: true,
        allowNewOperation: false,
        refetchTask: false,
        refetchRecipients: false,
      },
    });
    fetchMock.mockResolvedValue({
      ok: false,
      error: {
        status: 0,
        code: 'UNKNOWN',
        message: 'x',
        outcomeCategory: 'unknown',
        allowSameKeyRetry: false,
        allowNewOperation: true,
        refetchTask: false,
        refetchRecipients: false,
      },
    });

    renderPanel();
    fireEvent.change(dateInput(), { target: { value: '2026-09-01' } });
    fireEvent.click(saveButton());

    const banner = await screen.findByText(/could not check the current reminder state either/);
    expect(banner.textContent).toContain('Reload the Task');
  });

  it('does not re-read after a domain conflict, which no re-read would change', async () => {
    putMock.mockResolvedValue({
      ok: false,
      error: {
        status: 409,
        code: 'DOMAIN_CONFLICT',
        message: 'x',
        outcomeCategory: 'conflict',
        allowSameKeyRetry: false,
        allowNewOperation: false,
        refetchTask: true,
        refetchRecipients: false,
      },
    });

    renderPanel();
    fireEvent.change(dateInput(), { target: { value: '2026-09-01' } });
    fireEvent.click(saveButton());

    await screen.findByRole('alert');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('routes definite errors through an alert region', async () => {
    putMock.mockResolvedValue({
      ok: false,
      error: {
        status: 409,
        code: 'DOMAIN_CONFLICT',
        message: 'x',
        outcomeCategory: 'conflict',
        allowSameKeyRetry: false,
        allowNewOperation: false,
        refetchTask: true,
        refetchRecipients: false,
      },
    });

    renderPanel();
    fireEvent.click(saveButton());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('does not allow that reminder change');
  });
});

describe('A8.6b reminder panel: removal', () => {
  it('requires confirmation before removing anything', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Remove reminder due date' }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('explains the consequences without implying sent email can be recalled', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Remove reminder due date' }));
    const dialog = screen.getByRole('dialog');

    expect(dialog.textContent).toContain('current reminder cycle will stop');
    expect(dialog.textContent).toContain('unless you set a due date again');
    expect(dialog.textContent).toContain('cannot recall an email');
    expect(dialog.textContent).not.toMatch(/unsend|recall the reminder|undo the email/i);
  });

  it('sends the reminder ETag and adopts the authoritative no-due-date state', async () => {
    deleteMock.mockResolvedValue({
      ok: true,
      data: reminder({
        etag: ETAG_V5,
        state: 'no_due_date',
        dueLocalDate: null,
        advance: null,
        nextOverdueOccurrence: null,
        overdueDeliveredCount: null,
      }),
      etag: ETAG_V5,
    });

    renderPanel();
    armRemoval();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove reminder due date' }),
    );

    await waitFor(() =>
      expect(deleteMock).toHaveBeenCalledWith({ taskId: TASK_ID, ifMatch: ETAG_V4 }),
    );
    await screen.findByText(/Due date removed/);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText(/No reminders are scheduled for this Task/)).toBeTruthy();
  });

  it('does not send a second removal while the first is in flight', async () => {
    let release: ((value: { ok: true; data: TaskReminderState; etag: string }) => void) | undefined;
    deleteMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    renderPanel();
    armRemoval();
    const confirm = within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Remove reminder due date',
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(confirm.getAttribute('aria-busy')).toBe('true'));
    expect(deleteMock).toHaveBeenCalledTimes(1);

    release?.({
      ok: true,
      data: reminder({ etag: ETAG_V5, state: 'no_due_date', dueLocalDate: null }),
      etag: ETAG_V5,
    });
    await screen.findByText(/Due date removed/);
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it('resolves a stale removal by re-reading rather than removing again', async () => {
    deleteMock.mockResolvedValue({
      ok: false,
      error: {
        status: 412,
        code: 'PRECONDITION_FAILED',
        message: 'x',
        outcomeCategory: 'stale',
        allowSameKeyRetry: false,
        allowNewOperation: true,
        refetchTask: true,
        refetchRecipients: false,
      },
    });
    fetchMock.mockResolvedValue({
      ok: true,
      data: reminder({ etag: ETAG_V5, dueLocalDate: '2026-10-10' }),
      etag: ETAG_V5,
    });

    renderPanel();
    armRemoval();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove reminder due date' }),
    );

    await screen.findByText(/changed somewhere else/);
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Oct 10, 2026')).toBeTruthy();
  });

  it('reports an unanswered removal as unknown and says what the server now holds', async () => {
    deleteMock.mockResolvedValue({
      ok: false,
      error: {
        status: 0,
        code: 'UNKNOWN',
        message: 'x',
        outcomeCategory: 'ambiguous',
        allowSameKeyRetry: true,
        allowNewOperation: false,
        refetchTask: false,
        refetchRecipients: false,
      },
    });
    fetchMock.mockResolvedValue({
      ok: true,
      data: reminder({ etag: ETAG_V5, state: 'no_due_date', dueLocalDate: null }),
      etag: ETAG_V5,
    });

    renderPanel();
    armRemoval();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove reminder due date' }),
    );

    const banner = await screen.findByText(/did not get an answer/);
    expect(banner.textContent).toContain('no longer has a due date');
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it('moves focus into the dialog and restores it on cancel', async () => {
    renderPanel();
    const trigger = screen.getByRole('button', { name: 'Remove reminder due date' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('closes on Escape without removing anything', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Remove reminder due date' }));
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('keeps the confirmation gated until the Owner ticks the box', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Remove reminder due date' }));
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', {
      name: 'Remove reminder due date',
    }) as HTMLButtonElement;

    expect(confirm.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('checkbox'));
    expect(confirm.disabled).toBe(false);
  });

  it('is labelled and described for assistive technology', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Remove reminder due date' }));
    const dialog = screen.getByRole('dialog');

    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
  });
});

describe('A8.6b reminder panel: eligibility', () => {
  it('lets an active Task edit its due date', () => {
    renderPanel({ taskStatus: 'in_progress' });
    expect(dateInput()).toBeTruthy();
  });

  it('replaces the editor with an explanation on a completed Task', () => {
    renderPanel({
      state: reminder({ state: 'stopped', stopReason: 'task_completed' }),
      taskStatus: 'completed',
    });

    expect(screen.queryByLabelText(/reminder due date/i)).toBeNull();
    expect(
      screen.getByText(/This Task is completed, so its due date can no longer be changed/),
    ).toBeTruthy();
  });

  it('replaces the editor with an explanation on a dismissed Task', () => {
    renderPanel({
      state: reminder({ state: 'stopped', stopReason: 'task_dismissed' }),
      taskStatus: 'dismissed',
    });

    expect(screen.queryByLabelText(/reminder due date/i)).toBeNull();
    expect(
      screen.getByText(/This Task is dismissed, so its due date can no longer be changed/),
    ).toBeTruthy();
  });

  it('makes the locked reason reachable from the surviving removal control', () => {
    renderPanel({
      state: reminder({ state: 'stopped', stopReason: 'task_completed' }),
      taskStatus: 'completed',
    });

    const remove = screen.getByRole('button', { name: 'Remove reminder due date' });
    const describedBy = remove.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(String(describedBy))?.textContent).toContain('completed');
  });

  it('still allows a Waiting Task to change its due date', () => {
    renderPanel({ state: reminder({ state: 'suspended_waiting' }), taskStatus: 'waiting' });
    expect(dateInput()).toBeTruthy();
  });
});
