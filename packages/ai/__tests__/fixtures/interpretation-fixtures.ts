/**
 * Deterministic interpretation fixtures for contract validation.
 * These are expected model JSON shapes — not live API responses.
 */

export const interpretationFixtures = {
  /** A. SINGLE TASK */
  A_singleTask: {
    input: 'Call Sharon about the listing agreement.',
    modelOutput: {
      tasks: [
        {
          summaryPoints: [
            {
              id: 'sp_1',
              kind: 'next_action',
              label: 'Call',
              order: 0,
              value: 'Call Sharon about the listing agreement',
            },
          ],
          peopleHints: ['Sharon'],
          deadlineExpression: null,
        },
      ],
    },
  },

  /** B. MULTIPLE TASKS */
  B_multipleTasks: {
    input: 'Call Sharon tomorrow about the price. Send Kevin the updated numbers.',
    modelOutput: {
      tasks: [
        {
          summaryPoints: [
            {
              id: 'sp_1',
              kind: 'next_action',
              label: 'Call',
              order: 0,
              value: 'Call Sharon about the price',
            },
          ],
          peopleHints: ['Sharon'],
          deadlineExpression: 'tomorrow',
        },
        {
          summaryPoints: [
            {
              id: 'sp_1',
              kind: 'next_action',
              label: 'Send',
              order: 0,
              value: 'Send Kevin the updated numbers',
            },
          ],
          peopleHints: ['Kevin'],
          deadlineExpression: null,
        },
      ],
    },
  },

  /** C. NO TASK */
  C_noTask: {
    input: 'Thanks again for lunch. Great seeing you.',
    modelOutput: {
      tasks: [],
    },
  },

  /** D. MIXED ACTIONABLE / NON-ACTIONABLE */
  D_mixed: {
    input: 'Send Kevin the updated numbers. Carlie said the inspection went well.',
    modelOutput: {
      tasks: [
        {
          summaryPoints: [
            {
              id: 'sp_1',
              kind: 'next_action',
              label: 'Send',
              order: 0,
              value: 'Send Kevin the updated numbers',
            },
          ],
          peopleHints: ['Kevin'],
          deadlineExpression: null,
        },
      ],
    },
  },

  /** E. DEADLINE EXPRESSION */
  E_deadlineExpression: {
    input: 'Send Sharon the revised agreement tomorrow afternoon.',
    modelOutput: {
      tasks: [
        {
          summaryPoints: [
            {
              id: 'sp_1',
              kind: 'next_action',
              label: 'Send',
              order: 0,
              value: 'Send Sharon the revised agreement',
            },
          ],
          peopleHints: ['Sharon'],
          deadlineExpression: 'tomorrow afternoon',
        },
      ],
    },
  },

  /** F. NO INVENTED DEADLINE */
  F_noInventedDeadline: {
    input: 'Send Sharon the revised agreement.',
    modelOutput: {
      tasks: [
        {
          summaryPoints: [
            {
              id: 'sp_1',
              kind: 'next_action',
              label: 'Send',
              order: 0,
              value: 'Send Sharon the revised agreement',
            },
          ],
          peopleHints: ['Sharon'],
          deadlineExpression: null,
        },
      ],
    },
  },

  /** G. MULTI-POINT SINGLE TASK */
  G_multiPointSingleTask: {
    input: 'Call Sharon tomorrow about the price and ask whether she reviewed the agreement.',
    modelOutput: {
      tasks: [
        {
          summaryPoints: [
            {
              id: 'sp_1',
              kind: 'next_action',
              label: 'Call',
              order: 0,
              value: 'Call Sharon about the price',
            },
            {
              id: 'sp_2',
              kind: 'request',
              label: 'Ask',
              order: 1,
              value: 'Ask whether she reviewed the agreement',
            },
          ],
          peopleHints: ['Sharon'],
          deadlineExpression: 'tomorrow',
        },
      ],
    },
  },

  /** H. PEOPLE HINT (name only — never email/Recipient) */
  H_peopleHint: {
    input: 'Call Sharon about the listing agreement.',
    modelOutput: {
      tasks: [
        {
          summaryPoints: [
            {
              id: 'sp_1',
              kind: 'next_action',
              label: 'Call',
              order: 0,
              value: 'Call Sharon about the listing agreement',
            },
          ],
          peopleHints: ['Sharon'],
          deadlineExpression: null,
        },
      ],
    },
  },

  /** I. INVALID CLAIMED TASK — empty summaryPoints on a claimed task */
  I_invalidClaimedTaskEmpty: {
    modelOutput: {
      tasks: [
        {
          summaryPoints: [],
          peopleHints: [],
          deadlineExpression: null,
        },
      ],
    },
  },

  /** I2. INVALID CLAIMED TASK — no actionable kind */
  I_invalidClaimedTaskNonActionable: {
    modelOutput: {
      tasks: [
        {
          summaryPoints: [
            {
              id: 'sp_1',
              kind: 'confirmed_fact',
              label: 'Note',
              order: 0,
              value: 'Carlie said the inspection went well',
            },
          ],
          peopleHints: ['Carlie'],
          deadlineExpression: null,
        },
      ],
    },
  },

  /** H-invalid: email-shaped people hint must fail validation */
  H_invalidEmailHint: {
    modelOutput: {
      tasks: [
        {
          summaryPoints: [
            {
              id: 'sp_1',
              kind: 'next_action',
              label: 'Call',
              order: 0,
              value: 'Call Sharon',
            },
          ],
          peopleHints: ['sharon@example.com'],
          deadlineExpression: null,
        },
      ],
    },
  },

  /** Slice goal mixed example (Sharon + Kevin; Carlie non-actionable omitted) */
  sliceGoal_mixedThreeStatements: {
    input:
      'Call Sharon tomorrow about the price. Send Kevin the updated numbers. Carlie said the inspection went well.',
    modelOutput: {
      tasks: [
        {
          summaryPoints: [
            {
              id: 'sp_1',
              kind: 'next_action',
              label: 'Call',
              order: 0,
              value: 'Call Sharon about the price',
            },
          ],
          peopleHints: ['Sharon'],
          deadlineExpression: 'tomorrow',
        },
        {
          summaryPoints: [
            {
              id: 'sp_1',
              kind: 'next_action',
              label: 'Send',
              order: 0,
              value: 'Send Kevin the updated numbers',
            },
          ],
          peopleHints: ['Kevin'],
          deadlineExpression: null,
        },
      ],
    },
  },
} as const;
