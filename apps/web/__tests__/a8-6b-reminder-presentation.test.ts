import { describe, expect, it } from 'vitest';
import type { components } from '@aicaa/contracts/schema';
import {
  OVERDUE_SUCCESSFUL_DELIVERY_CEILING,
  decideReminderScheduling,
  type TaskStatus,
} from '@aicaa/domain';
import {
  REMINDER_DUE_DATE_TERM,
  restartsReminderCycle,
  toOwnerReminderView,
} from '@/lib/reminders/presentation';
import { toOwnerAttentionItem } from '@/lib/reminders/attention';

type TaskReminderState = components['schemas']['TaskReminderState'];
type StopReason = NonNullable<TaskReminderState['stopReason']>;
type AdvanceDisposition = components['schemas']['TaskReminderAdvanceDisposition'];

const TASK_ID = 'task_a86b';

/**
 * Every contracted value, listed here rather than sampled.
 *
 * A projection that renders four of six stop reasons is not caught by tests that only try the
 * interesting ones, and the two it misses are the ones nobody thought about.
 */
const ALL_STOP_REASONS: readonly StopReason[] = [
  'task_completed',
  'task_dismissed',
  'due_date_removed',
  'overdue_ceiling_reached',
  'permanent_delivery_failure',
  'repeated_ambiguous_outcomes',
];

const ALL_DISPOSITIONS: readonly AdvanceDisposition[] = [
  'scheduled',
  'skipped_window_elapsed',
  'skipped_waiting_elapsed',
  'delivered',
  'skipped_not_eligible',
  'failed_permanent',
  'ambiguous',
  'not_enabled',
];

const ALL_TASK_STATUSES: readonly TaskStatus[] = [
  'open',
  'in_progress',
  'waiting',
  'completed',
  'dismissed',
];

function state(overrides: Partial<TaskReminderState> = {}): TaskReminderState {
  return {
    taskId: TASK_ID,
    etag: '"task-reminder-task_a86b-v3"',
    dueLocalDate: '2026-08-20',
    schedulingTimeZone: 'America/Vancouver',
    state: 'active',
    generation: 2,
    advance: {
      disposition: 'scheduled',
      occurrence: { localDate: '2026-08-18', at: '2026-08-18T16:00:00.000Z' },
    },
    nextOverdueOccurrence: { localDate: '2026-08-21', at: '2026-08-21T16:00:00.000Z' },
    overdueDeliveredCount: 3,
    requiresOwnerAttention: false,
    stopReason: null,
    ...overrides,
  };
}

/** Everything the panel can put on screen, as one searchable string. */
function renderedText(view: ReturnType<typeof toOwnerReminderView>): string {
  return [
    view.badge,
    view.headline,
    view.explanation,
    view.dueDateText ?? '',
    view.editability.lockedReason ?? '',
    ...view.facts.flatMap((fact) => [fact.term, fact.value]),
  ].join(' ');
}

describe('A8.6b reminder presentation: state rendering', () => {
  it('explains no_due_date without implying anything is scheduled', () => {
    const view = toOwnerReminderView(
      state({
        state: 'no_due_date',
        dueLocalDate: null,
        advance: null,
        nextOverdueOccurrence: null,
        overdueDeliveredCount: null,
        generation: null,
      }),
      'open',
    );

    expect(view.headline).toBe('No reminders are scheduled for this Task.');
    expect(view.dueDateText).toBeNull();
    expect(view.dueDateValue).toBe('');
    expect(view.facts).toHaveLength(0);
    expect(view.editability.editable).toBe(true);
    // Nothing to remove, so no destructive control is offered.
    expect(view.editability.removable).toBe(false);
  });

  /*
   * The state no write path produces. It is tested because "unreachable" is a claim about today's
   * code, not about the row a future migration or a hand-edited database could present.
   */
  it('handles not_scheduled safely rather than rendering an impossible blank', () => {
    const view = toOwnerReminderView(
      state({
        state: 'not_scheduled',
        generation: null,
        advance: null,
        nextOverdueOccurrence: null,
        overdueDeliveredCount: null,
      }),
      'open',
    );

    expect(view.headline).toContain('no reminders are scheduled');
    expect(view.explanation).toContain('Saving the due date again');
    expect(view.dueDateText).not.toBeNull();
    expect(view.badge).not.toBe('');
  });

  it('shows the active schedule, its dates, and progress toward the delivery limit', () => {
    const view = toOwnerReminderView(state(), 'open');
    const text = renderedText(view);

    expect(view.badge).toBe('Reminders on');
    expect(view.dueDateText).toBe('Aug 20, 2026');
    expect(text).toContain('Aug 18, 2026');
    expect(text).toContain('Aug 21, 2026');
    expect(text).toContain(`3 of ${OVERDUE_SUCCESSFUL_DELIVERY_CEILING} daily reminders sent`);
  });

  it('states the ceiling as the contracted fourteen', () => {
    expect(OVERDUE_SUCCESSFUL_DELIVERY_CEILING).toBe(14);
    const view = toOwnerReminderView(state({ overdueDeliveredCount: 0 }), 'open');
    expect(renderedText(view)).toContain('0 of 14 daily reminders sent');
  });

  it('explains Waiting suspension including the absence of a backlog', () => {
    const view = toOwnerReminderView(state({ state: 'suspended_waiting' }), 'waiting');

    expect(view.headline).toContain('paused because this Task is Waiting');
    expect(view.explanation).toContain('will not send the missed reminders');
    expect(view.explanation).toContain('resume');
    // The due date stays visible while paused.
    expect(view.dueDateText).toBe('Aug 20, 2026');
  });

  /*
   * A stopped schedule's advance and next-overdue values are history. Printing "Next overdue
   * reminder: 21 Aug" beside "reminders stopped" would contradict itself on one screen.
   */
  it('drops forward-looking occurrences once stopped', () => {
    const view = toOwnerReminderView(
      state({
        state: 'stopped',
        stopReason: 'overdue_ceiling_reached',
        requiresOwnerAttention: true,
      }),
      'open',
    );
    const text = renderedText(view);

    expect(text).not.toContain('Aug 21, 2026');
    expect(view.facts.map((fact) => fact.term)).toEqual(['Overdue reminders']);
  });

  it.each(ALL_STOP_REASONS)('explains the stop reason %s in plain language', (stopReason) => {
    const view = toOwnerReminderView(state({ state: 'stopped', stopReason }), 'open');
    const text = renderedText(view);

    expect(view.headline.length).toBeGreaterThan(0);
    expect(view.explanation.length).toBeGreaterThan(0);
    // The enum name itself must never reach the screen.
    expect(text).not.toContain(stopReason);
    expect(text).not.toMatch(/_/);
  });

  it('says delivery could not be confirmed for repeated ambiguity, and does not claim it was missed', () => {
    const view = toOwnerReminderView(
      state({
        state: 'stopped',
        stopReason: 'repeated_ambiguous_outcomes',
        requiresOwnerAttention: true,
      }),
      'open',
    );

    expect(view.explanation).toContain('could not confirm');
    expect(view.explanation).toContain('may or may not have received');
    expect(view.explanation).not.toMatch(/did not receive|was not delivered|never received/i);
  });

  it('tells the Owner how to repair a stopped schedule without offering to resend', () => {
    for (const stopReason of [
      'overdue_ceiling_reached',
      'permanent_delivery_failure',
      'repeated_ambiguous_outcomes',
    ] as const) {
      const view = toOwnerReminderView(
        state({ state: 'stopped', stopReason, requiresOwnerAttention: true }),
        'open',
      );
      expect(view.explanation).toContain('Setting a due date starts a new reminder cycle.');
      expect(renderedText(view)).not.toMatch(/send again|resend|send now|try again now/i);
    }
  });

  it.each(ALL_DISPOSITIONS)('renders the advance disposition %s as a sentence', (disposition) => {
    const view = toOwnerReminderView(
      state({
        advance: {
          disposition,
          occurrence: { localDate: '2026-08-18', at: '2026-08-18T16:00:00.000Z' },
        },
      }),
      'open',
    );
    const advanceFact = view.facts.find((fact) => fact.term === 'Reminder before the due date');

    expect(advanceFact).toBeDefined();
    expect(advanceFact?.value).not.toContain(disposition);
    expect(advanceFact?.value).not.toMatch(/_/);
  });

  it('handles an advance with no recorded occurrence', () => {
    const view = toOwnerReminderView(
      state({ advance: { disposition: 'skipped_window_elapsed', occurrence: null } }),
      'open',
    );
    const advanceFact = view.facts.find((fact) => fact.term === 'Reminder before the due date');

    expect(advanceFact?.value).toBe(
      'Not sent — the due date was already close when the reminder was set up',
    );
  });
});

describe('A8.6b reminder presentation: Owner-facing terminology', () => {
  /*
   * The generation number is on the contract and must never be on the screen. "Cycle 3" answers no
   * question an Owner has, and the word is scheduler vocabulary.
   */
  it('never renders the generation number or the word generation', () => {
    for (const scheduleState of [
      'no_due_date',
      'not_scheduled',
      'active',
      'suspended_waiting',
      'stopped',
    ] as const) {
      const view = toOwnerReminderView(state({ state: scheduleState, generation: 7 }), 'open');
      const text = renderedText(view).toLowerCase();

      expect(text).not.toContain('generation');
      expect(text).not.toMatch(/\bcycle 7\b/);
      expect(JSON.stringify(view)).not.toContain('"generation"');
    }
  });

  it('uses no scheduler, worker, or database vocabulary', () => {
    const forbidden = [
      'generation',
      'claim',
      'lease',
      'fencing',
      'fence',
      'retry count',
      'reminderversion',
      'prisma',
      'row',
      'enum',
      'occurrence kind',
      'scheduler',
      'worker',
      'etag',
      'idempotency',
    ];

    for (const scheduleState of [
      'no_due_date',
      'not_scheduled',
      'active',
      'suspended_waiting',
      'stopped',
    ] as const) {
      for (const stopReason of ALL_STOP_REASONS) {
        for (const taskStatus of ALL_TASK_STATUSES) {
          const view = toOwnerReminderView(state({ state: scheduleState, stopReason }), taskStatus);
          const text = renderedText(view).toLowerCase();
          for (const word of forbidden) {
            expect(
              text,
              `"${word}" reached the Owner in ${scheduleState}/${stopReason}/${taskStatus}`,
            ).not.toContain(word);
          }
        }
      }
    }
  });

  it('speaks of a reminder cycle where the schema speaks of a generation', () => {
    const view = toOwnerReminderView(
      state({
        state: 'stopped',
        stopReason: 'overdue_ceiling_reached',
        requiresOwnerAttention: true,
      }),
      'open',
    );
    expect(view.explanation).toContain('reminder cycle');
  });

  it('names its own date apart from the Task-level due date', () => {
    // Task.dueAt and dueLocalDate are independent (D102, D109); one label for both would conflate them.
    expect(REMINDER_DUE_DATE_TERM).toBe('Reminder due date');
  });
});

describe('A8.6b reminder presentation: editability', () => {
  /*
   * The panel must forbid exactly what the route forbids.
   *
   * Both read `decideReminderScheduling`, so this asserts the wiring rather than a duplicated table:
   * if the domain ever admits or refuses another status, the panel follows without an edit here.
   */
  it.each(ALL_TASK_STATUSES)('matches the domain scheduling decision for %s', (taskStatus) => {
    const view = toOwnerReminderView(state(), taskStatus);
    const domainAllows = decideReminderScheduling(taskStatus).kind !== 'refused';

    expect(view.editability.editable).toBe(domainAllows);
  });

  it('explains why a completed Task cannot be edited instead of showing a dead control', () => {
    const view = toOwnerReminderView(
      state({ state: 'stopped', stopReason: 'task_completed' }),
      'completed',
    );

    expect(view.editability.editable).toBe(false);
    expect(view.editability.lockedReason).toContain('completed');
  });

  it('explains why a dismissed Task cannot be edited', () => {
    const view = toOwnerReminderView(
      state({ state: 'stopped', stopReason: 'task_dismissed' }),
      'dismissed',
    );

    expect(view.editability.editable).toBe(false);
    expect(view.editability.lockedReason).toContain('dismissed');
  });

  /*
   * DELETE is permitted on every Task status because removal only ever reduces activity, so a
   * terminal Task keeps the removal control even though its date is no longer editable.
   */
  it('keeps removal available on a terminal Task that still has a due date', () => {
    const view = toOwnerReminderView(
      state({ state: 'stopped', stopReason: 'task_completed' }),
      'completed',
    );

    expect(view.editability.editable).toBe(false);
    expect(view.editability.removable).toBe(true);
  });

  it('offers no removal when there is no due date to remove', () => {
    const view = toOwnerReminderView(state({ state: 'no_due_date', dueLocalDate: null }), 'open');
    expect(view.editability.removable).toBe(false);
  });

  it('allows editing a Waiting Task, because the server accepts it as a suspended schedule', () => {
    const view = toOwnerReminderView(state({ state: 'suspended_waiting' }), 'waiting');
    expect(view.editability.editable).toBe(true);
  });
});

describe('A8.6b reminder presentation: D104 material change', () => {
  it('does not promise a restart for the first due date', () => {
    expect(
      restartsReminderCycle(state({ state: 'no_due_date', dueLocalDate: null }), '2026-09-01'),
    ).toBe(false);
  });

  it('does not promise a restart for re-saving the same date on a live schedule', () => {
    expect(restartsReminderCycle(state({ dueLocalDate: '2026-08-20' }), '2026-08-20')).toBe(false);
    expect(
      restartsReminderCycle(
        state({ state: 'suspended_waiting', dueLocalDate: '2026-08-20' }),
        '2026-08-20',
      ),
    ).toBe(false);
  });

  it('promises a restart for a changed date on a live schedule', () => {
    expect(restartsReminderCycle(state({ dueLocalDate: '2026-08-20' }), '2026-09-01')).toBe(true);
  });

  /*
   * Reactivation (D109). A stopped schedule is not the same schedule as a live one, so re-saving
   * even an identical date really does open a new cycle — and this is the repair path Owners reach
   * from `/attention`, so hiding the disclosure would surprise them at exactly the wrong moment.
   */
  it('promises a restart when re-saving the same date on a stopped schedule', () => {
    expect(
      restartsReminderCycle(
        state({
          state: 'stopped',
          stopReason: 'overdue_ceiling_reached',
          dueLocalDate: '2026-08-20',
        }),
        '2026-08-20',
      ),
    ).toBe(true);
  });

  it('does not promise a restart when there is no schedule behind the date', () => {
    expect(restartsReminderCycle(state({ state: 'not_scheduled' }), '2026-09-01')).toBe(false);
  });
});

describe('A8.6b reminder presentation: agreement with /attention', () => {
  /*
   * The Owner arrives from the Attention list. If the two surfaces described the same stop
   * differently they would reasonably think they were looking at two different problems.
   */
  it.each([
    'overdue_ceiling_reached',
    'permanent_delivery_failure',
    'repeated_ambiguous_outcomes',
  ] as const)('renders the same meaning as the attention list for %s', (stopReason) => {
    const attention = toOwnerAttentionItem({
      taskId: TASK_ID,
      taskSummaryPoints: [],
      taskDueLocalDate: '2026-08-20',
      status: 'stopped',
      stopReason,
      overdueDeliveredCount: 14,
    });
    const view = toOwnerReminderView(
      state({ state: 'stopped', stopReason, requiresOwnerAttention: true }),
      'open',
    );

    expect(view.badge).toBe(attention.badge);
    expect(view.badgeTone).toBe(attention.badgeTone);
    expect(view.headline).toBe(attention.headline);
    // The Task page adds the repair sentence the list cannot offer, and repeats the list's meaning verbatim first.
    expect(view.explanation.startsWith(attention.explanation)).toBe(true);
  });

  it('surfaces the attention flag so the panel can cross-reference the list', () => {
    const flagged = toOwnerReminderView(
      state({
        state: 'stopped',
        stopReason: 'permanent_delivery_failure',
        requiresOwnerAttention: true,
      }),
      'open',
    );
    expect(flagged.requiresOwnerAttention).toBe(true);
  });
});
