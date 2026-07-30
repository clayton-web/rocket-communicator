// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { components } from '@aicaa/contracts/schema';
import type { CapabilityAction } from '@aicaa/domain';
import { RecipientCapabilityPanel } from '@/app/c/[token]/recipient-capability-panel';

type TaskDto = components['schemas']['Task'];

/**
 * Keyboard and focus behaviour for the Recipient confirmation dialogs (P1.5 / D119).
 *
 * D119 makes "explicit keyboard and focus-flow validation of both confirmation dialogs
 * including Escape and focus restoration" part of P1 closure. The Owner handoff dialog
 * already satisfied it; this one, measured in Chromium before any change, failed every
 * clause of it. Focus stayed on the trigger behind the backdrop, so the first three Tab
 * presses moved through the page's own action buttons while a modal was open; Escape did
 * nothing at all; and Cancel left focus on `<body>`, which for a keyboard user means being
 * returned to the top of the document with no idea where they were.
 *
 * A note on what this file can prove. jsdom does not implement sequential focus navigation,
 * so pressing Tab here only runs the component's own handler — it never moves focus by
 * itself. That makes this file authoritative for the wrap at each end of the dialog and for
 * focus being pulled back when it is outside, and it makes the Playwright suite the evidence
 * that ordinary Tab presses stay inside. Neither claim is made in the wrong place.
 */

const token = 'capability-token-value-32chars-min!!';

const ALL_ACTIONS: CapabilityAction[] = [
  'view_assigned_task',
  'add_task_note',
  'complete_task',
  'mark_task_waiting',
  'request_clarification',
  'return_task_to_owner',
  'submit_work_request',
];

function baseTask(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: 'task_a11y_1',
    organizationId: 'org_a11y',
    status: 'open',
    priorActionableStatus: null,
    summaryPoints: [
      { id: 'p1', kind: 'next_action', label: 'Next', order: 0, value: 'Follow up' },
    ] as TaskDto['summaryPoints'],
    assignment: {
      id: 'asg_a11y_1',
      recipientId: 'rcp_a11y',
      intendedRecipientEmail: 'recipient@example.com',
      assignedAt: '2026-07-13T19:00:00.000Z',
      assignedByOwnerId: 'owner_a11y',
      allowedCapabilityActions: ALL_ACTIONS,
      activeCapabilityId: 'cap_a11y_1',
    } as TaskDto['assignment'],
    dueAt: null,
    waitingUntil: null,
    priority: 'normal',
    derivedUrgency: 'normal',
    notes: [],
    reminder: { nextReminderAt: null, reminderStage: 0, waitingPaused: false },
    retention: { deleteAfter: '2026-08-12T19:00:00.000Z', policy: 'active_task' },
    version: 2,
    etag: '"task-task_a11y_1-v2"',
    createdAt: '2026-07-13T19:00:00.000Z',
    updatedAt: '2026-07-13T19:00:00.000Z',
    ...overrides,
  } as TaskDto;
}

function renderPanel(task: TaskDto = baseTask()) {
  return render(
    <RecipientCapabilityPanel
      token={token}
      initialTask={task}
      permittedActions={ALL_ACTIONS}
      expiresAt="2026-07-20T19:00:00.000Z"
    />,
  );
}

/**
 * Open a dialog the way a browser does it: the trigger takes focus, then activates. jsdom's
 * `fireEvent.click` does not focus its target, and the panel reads `document.activeElement`
 * to know where to send focus back, so skipping the focus step would test a situation that
 * cannot occur through a keyboard or a mouse.
 */
async function openDialog(triggerName: string) {
  const trigger = screen.getByRole('button', { name: triggerName });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog');
  return { trigger, dialog };
}

/** A real key press on the document, which is where the dialog listens. */
function press(key: string, init: { shiftKey?: boolean } = {}) {
  fireEvent.keyDown(document, { key, ...init });
}

function confirmButton() {
  return screen.getByRole('button', { name: /^(Confirm|Submitting…)$/ });
}

function cancelButton() {
  return screen.getByRole('button', { name: 'Cancel' });
}

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
}

/** Every action that opens a confirmation dialog, with the field focus should land on. */
const INPUT_DIALOGS = [
  { trigger: 'Mark waiting', field: 'Waiting until' },
  { trigger: 'Complete', field: 'Outcome' },
  { trigger: 'Add note', field: 'Note' },
  { trigger: 'Request clarification', field: 'Message' },
  { trigger: 'Return to owner', field: 'Note (optional)' },
  { trigger: 'Submit work request', field: 'Message' },
] as const;

describe('Recipient confirmation dialog semantics (P1.5 / D119)', () => {
  afterEach(cleanup);

  it('opens a dialog from every action trigger', async () => {
    for (const { trigger } of INPUT_DIALOGS) {
      renderPanel();
      await openDialog(trigger);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      cleanup();
    }
  });

  it('marks each dialog as a modal dialog', async () => {
    renderPanel();
    const { dialog } = await openDialog('Add note');
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('names each dialog from its visible heading, and describes the consequence', async () => {
    for (const { trigger } of INPUT_DIALOGS) {
      renderPanel();
      const { dialog } = await openDialog(trigger);

      // The accessible name is the action, taken from text the Recipient can also read.
      expect(dialog).toHaveAccessibleName(trigger);
      expect(within(dialog).getByRole('heading', { level: 2 })).toHaveTextContent(trigger);
      expect(dialog).toHaveAccessibleDescription(/\S/);
      cleanup();
    }
  });

  it('keeps the accessible name stable while a submission is pending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    renderPanel();
    const { dialog } = await openDialog('Add note');
    fireEvent.change(screen.getByLabelText('Note', { exact: true }), { target: { value: 'x' } });
    fireEvent.click(confirmButton());

    await waitFor(() => expect(confirmButton()).toBeDisabled());
    expect(dialog).toHaveAccessibleName('Add note');
    vi.unstubAllGlobals();
  });

  it('puts no token, task id, or other identifier into the dialog', async () => {
    renderPanel();
    const { dialog } = await openDialog('Add note');
    const exposed = [
      dialog.textContent ?? '',
      dialog.getAttribute('aria-label') ?? '',
      // Attribute values that reach assistive technology as text.
      ...[...dialog.querySelectorAll('*')].map((el) => el.getAttribute('aria-label') ?? ''),
    ].join(' ');

    for (const secret of [token, 'task_a11y_1', 'cap_a11y_1', 'asg_a11y_1', 'org_a11y']) {
      expect(exposed).not.toContain(secret);
    }
  });
});

describe('Recipient dialog opening focus (P1.5 / D119)', () => {
  afterEach(cleanup);

  it.each(INPUT_DIALOGS)(
    'moves focus into the $trigger dialog, onto its first field',
    async ({ trigger, field }) => {
      renderPanel();
      const { dialog } = await openDialog(trigger);

      expect(dialog.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).toBe(screen.getByLabelText(field, { exact: true }));
    },
  );

  it('focuses Cancel for the confirmation that collects nothing', async () => {
    // Resume is the only action with no field, so Cancel is the first thing in the dialog.
    renderPanel(baseTask({ status: 'waiting' }));
    const { dialog } = await openDialog('Resume');

    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(cancelButton());
  });

  it('never opens a dialog with Confirm focused', async () => {
    for (const { trigger } of INPUT_DIALOGS) {
      renderPanel();
      await openDialog(trigger);
      expect(document.activeElement).not.toBe(confirmButton());
      cleanup();
    }

    renderPanel(baseTask({ status: 'waiting' }));
    await openDialog('Resume');
    expect(document.activeElement).not.toBe(confirmButton());
  });

  it('leaves nothing in the page behind the dialog focused', async () => {
    renderPanel();
    const { dialog } = await openDialog('Return to owner');

    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { level: 1 }));
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

describe('Recipient dialog focus containment (P1.5 / D119)', () => {
  afterEach(cleanup);

  it('wraps Tab from the last control back to the first', async () => {
    renderPanel();
    const { dialog } = await openDialog('Add note');
    confirmButton().focus();

    press('Tab');

    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText('Note', { exact: true }));
  });

  it('wraps Shift+Tab from the first control back to the last', async () => {
    renderPanel();
    const { dialog } = await openDialog('Add note');
    screen.getByLabelText('Note', { exact: true }).focus();

    press('Tab', { shiftKey: true });

    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(confirmButton());
  });

  it('pulls focus back if it is outside the dialog when Tab is pressed', async () => {
    renderPanel();
    const { dialog } = await openDialog('Add note');
    // The state the page was permanently in before this fix: focus behind the backdrop.
    screen.getByRole('heading', { level: 1 }).focus();

    press('Tab');

    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('does not offer disabled controls as a Tab stop while pending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    renderPanel();
    const { dialog } = await openDialog('Add note');
    const note = screen.getByLabelText('Note', { exact: true });
    fireEvent.change(note, { target: { value: 'Draft' } });
    fireEvent.click(confirmButton());
    await waitFor(() => expect(confirmButton()).toBeDisabled());

    note.focus();
    press('Tab');

    // Both buttons are disabled, so the field is the only stop and focus stays on it.
    expect(document.activeElement).toBe(note);
    expect(dialog.contains(document.activeElement)).toBe(true);
    vi.unstubAllGlobals();
  });

  it('keeps containment correct once a failure message has appeared', async () => {
    setOnLine(false);
    renderPanel();
    const { dialog } = await openDialog('Add note');
    fireEvent.change(screen.getByLabelText('Note', { exact: true }), {
      target: { value: 'Draft' },
    });
    fireEvent.click(confirmButton());
    await screen.findByRole('status');

    confirmButton().focus();
    press('Tab');

    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText('Note', { exact: true }));
    setOnLine(true);
  });

  it('opens no second dialog while one is open', async () => {
    renderPanel();
    await openDialog('Add note');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });
});

describe('Recipient dialog dismissal and focus restoration (P1.5 / D119)', () => {
  beforeEach(() => setOnLine(true));

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    setOnLine(true);
  });

  it('closes on Escape when idle and dispatches nothing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    await openDialog('Add note');

    press('Escape');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
    // Nothing may claim the action happened.
    expect(document.body.textContent ?? '').not.toMatch(/saved|submitted|completed/i);
  });

  it('returns focus to the exact trigger after Escape', async () => {
    renderPanel();
    const { trigger } = await openDialog('Add note');

    press('Escape');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(trigger);
  });

  it('returns focus to the exact trigger after Cancel', async () => {
    renderPanel();
    const { trigger } = await openDialog('Complete');

    fireEvent.click(cancelButton());

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(trigger);
  });

  it('restores focus to the trigger of whichever dialog was opened', async () => {
    renderPanel();
    for (const name of ['Add note', 'Complete', 'Return to owner']) {
      const { trigger } = await openDialog(name);
      press('Escape');
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(document.activeElement).toBe(trigger);
    }
  });

  it('does not close on Escape while a request is in flight', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    renderPanel();
    await openDialog('Add note');
    fireEvent.change(screen.getByLabelText('Note', { exact: true }), {
      target: { value: 'Draft' },
    });
    fireEvent.click(confirmButton());
    await waitFor(() => expect(confirmButton()).toBeDisabled());

    press('Escape');

    // The dialog stays, so an unresolved submission is never hidden behind a closed dialog.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
    expect(document.body.textContent ?? '').not.toMatch(/cancel+ed/i);
  });

  it('leaves the pending state and becomes dismissable again after an offline failure', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setOnLine(false);
    renderPanel();
    const { trigger } = await openDialog('Add note');
    fireEvent.change(screen.getByLabelText('Note', { exact: true }), {
      target: { value: 'Draft' },
    });
    fireEvent.click(confirmButton());
    await screen.findByRole('status');

    await waitFor(() => expect(confirmButton()).toBeEnabled());
    press('Escape');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(trigger);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('becomes dismissable again after an ambiguous failure, without relabelling it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    renderPanel();
    const { trigger } = await openDialog('Add note');
    fireEvent.change(screen.getByLabelText('Note', { exact: true }), {
      target: { value: 'Draft' },
    });
    fireEvent.click(confirmButton());

    const status = await screen.findByRole('status');
    const ambiguous = status.textContent ?? '';
    expect(ambiguous).toMatch(/may or may not/i);

    await waitFor(() => expect(confirmButton()).toBeEnabled());
    press('Escape');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(trigger);

    /*
     * Closing must not convert an unknown outcome into a known one. The message survives
     * dismissal word for word, still hedged, and moves to the panel now that the dialog it
     * was covering has gone — leaving exactly one place it is announced from.
     */
    const afterClose = screen.getAllByRole('status');
    expect(afterClose).toHaveLength(1);
    expect(afterClose[0]).toHaveTextContent(ambiguous);
    expect(afterClose[0]).toHaveTextContent(/may or may not/i);
    expect(afterClose[0]?.textContent ?? '').not.toMatch(/\bwas saved\b|\bwas not received\b/i);
  });

  it('becomes dismissable again after a definite rejection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(409, { code: 'conflict', message: 'Conflict' })),
    );
    renderPanel();
    const { trigger } = await openDialog('Add note');
    fireEvent.change(screen.getByLabelText('Note', { exact: true }), {
      target: { value: 'Draft' },
    });
    fireEvent.click(confirmButton());
    await screen.findByRole('status');

    await waitFor(() => expect(confirmButton()).toBeEnabled());
    press('Escape');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(trigger);
  });

  it('preserves the existing transition on confirmed success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, baseTask({ version: 3 }))),
    );
    renderPanel();
    await openDialog('Add note');
    fireEvent.change(screen.getByLabelText('Note', { exact: true }), {
      target: { value: 'Draft' },
    });
    fireEvent.click(confirmButton());

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Add note' })).toBeInTheDocument();
  });

  it('sends focus to the heading when success removes the trigger', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, baseTask({ status: 'returned_to_owner' }))),
    );
    renderPanel();
    await openDialog('Return to owner');
    fireEvent.click(confirmButton());

    // Returning replaces the whole panel, so the trigger no longer exists to return to.
    const heading = await screen.findByRole('heading', { level: 1, name: 'Returned to owner' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe('Recipient dialog status announcements and drafts (P1.5 / D119)', () => {
  beforeEach(() => setOnLine(true));

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    setOnLine(true);
  });

  it('announces an outcome exactly once, from inside the dialog', async () => {
    setOnLine(false);
    renderPanel();
    const { dialog } = await openDialog('Add note');
    fireEvent.change(screen.getByLabelText('Note', { exact: true }), {
      target: { value: 'Draft' },
    });
    fireEvent.click(confirmButton());
    await screen.findByRole('status');

    const regions = screen.getAllByRole('status');
    expect(regions).toHaveLength(1);
    // Inside the dialog, because the backdrop covers anything rendered behind it.
    expect(dialog.contains(regions[0]!)).toBe(true);
    expect(regions[0]).toHaveAttribute('aria-live', 'polite');
  });

  it('does not move focus when a message appears', async () => {
    setOnLine(false);
    renderPanel();
    await openDialog('Add note');
    const note = screen.getByLabelText('Note', { exact: true });
    fireEvent.change(note, { target: { value: 'Draft' } });
    note.focus();

    fireEvent.click(confirmButton());
    await screen.findByRole('status');

    // The Recipient keeps their place in the field they were typing in.
    expect(document.activeElement).toBe(note);
  });

  it('shows no raw server or exception text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch: ECONNREFUSED 127.0.0.1:3210');
      }),
    );
    renderPanel();
    await openDialog('Add note');
    fireEvent.change(screen.getByLabelText('Note', { exact: true }), {
      target: { value: 'Draft' },
    });
    fireEvent.click(confirmButton());

    const status = await screen.findByRole('status');
    const text = status.textContent ?? '';
    expect(text).not.toMatch(/ECONNREFUSED|TypeError|127\.0\.0\.1|Failed to fetch/);
    expect(text).not.toContain(token);
    expect(text).not.toContain('task_a11y_1');
  });

  it('keeps the draft through an offline failure', async () => {
    setOnLine(false);
    renderPanel();
    await openDialog('Add note');
    fireEvent.change(screen.getByLabelText('Note', { exact: true }), {
      target: { value: 'Words worth keeping' },
    });
    fireEvent.click(confirmButton());
    await screen.findByRole('status');

    expect(screen.getByLabelText('Note', { exact: true })).toHaveValue('Words worth keeping');
  });

  it('keeps the draft through an ambiguous failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    renderPanel();
    await openDialog('Add note');
    fireEvent.change(screen.getByLabelText('Note', { exact: true }), {
      target: { value: 'Words worth keeping' },
    });
    fireEvent.click(confirmButton());
    await screen.findByRole('status');

    expect(screen.getByLabelText('Note', { exact: true })).toHaveValue('Words worth keeping');
  });

  it('keeps the draft through a definite rejection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(409, { code: 'conflict', message: 'Conflict' })),
    );
    renderPanel();
    await openDialog('Add note');
    fireEvent.change(screen.getByLabelText('Note', { exact: true }), {
      target: { value: 'Words worth keeping' },
    });
    fireEvent.click(confirmButton());
    await screen.findByRole('status');

    expect(screen.getByLabelText('Note', { exact: true })).toHaveValue('Words worth keeping');
  });

  it('starts a reopened dialog from a clean field, as it always has', async () => {
    renderPanel();
    await openDialog('Add note');
    fireEvent.change(screen.getByLabelText('Note', { exact: true }), {
      target: { value: 'Abandoned' },
    });

    press('Escape');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await openDialog('Add note');

    /*
     * The dialog unmounts on close, so its field state goes with it. That is the behaviour
     * this stage inherited and it is unchanged: the draft-preservation policy in `0ec068b`
     * covers failed submissions, where the Recipient did not choose to discard anything,
     * not a dialog the Recipient deliberately dismissed.
     */
    expect(screen.getByLabelText('Note', { exact: true })).toHaveValue('');
  });

  it('restoring focus does not disturb the field the Recipient was using', async () => {
    setOnLine(false);
    renderPanel();
    await openDialog('Add note');
    const note = screen.getByLabelText('Note', { exact: true });
    fireEvent.change(note, { target: { value: 'Words worth keeping' } });
    fireEvent.click(confirmButton());
    await screen.findByRole('status');
    await waitFor(() => expect(confirmButton()).toBeEnabled());

    expect(screen.getByLabelText('Note', { exact: true })).toHaveValue('Words worth keeping');
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });
});

describe('Recipient dialog source guards (P1.5 / D119)', () => {
  const source = readFileSync(
    join(process.cwd(), 'app/c/[token]/recipient-capability-panel.tsx'),
    'utf8',
  );
  /** Comments discuss what the code avoids, so guards run against code alone. */
  const code = source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '');

  it('uses the in-repo dialog pattern rather than a library', () => {
    expect(code).not.toMatch(/from\s+'(focus-trap|react-modal|@radix-ui|@headlessui|@reach)/);
    expect(code).toContain('aria-modal="true"');
  });

  it('does not wait on a timer to place focus', () => {
    expect(code).not.toMatch(/setTimeout|requestAnimationFrame/);
  });

  it('does not use alertdialog', () => {
    expect(code).not.toContain('alertdialog');
  });

  it('does not autofocus anything declaratively', () => {
    expect(code).not.toMatch(/autoFocus/);
  });

  it('added no capability action, endpoint, or retry', () => {
    expect(code).not.toMatch(/setInterval|navigator\.serviceWorker|SyncManager/);
    expect(code).not.toMatch(/addEventListener\(\s*'online'/);
  });
});
