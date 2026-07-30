/**
 * P1.3 local performance evidence (audit-only).
 *
 * Builds a note-heavy fixture in an in-process Postgres (PGlite) and measures the
 * pre-P1.3 and post-P1.3 query shapes side by side in the same process, on the same
 * data, in the same run. The "before" variants re-issue the exact Prisma queries the
 * repository used before P1.3 rather than reading them from history, so both numbers
 * come from one machine and one warm-up state.
 *
 * This is development evidence only. It is not production measurement, it asserts
 * nothing, and no test depends on it. Query shape and call counts — proven by
 * `apps/web/__tests__/p1-3-database-work.test.ts` — are the load-bearing evidence;
 * the durations below are context.
 *
 *   node packages/db/scripts/p1-3-performance-evidence.mjs
 */
import { performance } from 'node:perf_hooks';
import {
  TASK_DETAIL_NOTE_LIMIT,
  appendTaskNote,
  createActiveAssignment,
  createTask,
  getTaskById,
  getTaskForCapabilityAuthorization,
  listTasks,
  upsertRecipient,
} from '../dist/index.js';
import { createTestDatabase } from '../dist/testing.js';

const ORG = 'org_p13_evidence';
const TASK_COUNT = 25;
const NOTES_PER_TASK = 200;
const LIST_LIMIT = 25;
const SAMPLES = 11;
const WARMUP = 3;

const iso = (minutes) => new Date(Date.UTC(2026, 6, 20, 0, 0, 0) + minutes * 60_000).toISOString();

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function fmt(ms) {
  return `${ms.toFixed(2)} ms`;
}

/** Median plus the observed range, so a single noisy sample cannot masquerade as a trend. */
async function sample(run) {
  for (let i = 0; i < WARMUP; i += 1) await run();
  const durations = [];
  let last;
  for (let i = 0; i < SAMPLES; i += 1) {
    const start = performance.now();
    last = await run();
    durations.push(performance.now() - start);
  }
  return {
    median: median(durations),
    min: Math.min(...durations),
    max: Math.max(...durations),
    value: last,
  };
}

/**
 * Both sides of every pair are measured at the same layer and differ only by the P1.3
 * change, so the sizes are comparable. Sizes are the JSON byte length of the value the
 * query returns — the data crossing the database boundary, not an HTTP response body.
 */
function report(before, after) {
  console.log(`  before: ${fmt(before.median)}  (range ${fmt(before.min)} – ${fmt(before.max)})`);
  console.log(`  after:  ${fmt(after.median)}  (range ${fmt(after.min)} – ${fmt(after.max)})`);
  const beforeBytes = Buffer.byteLength(JSON.stringify(before.value));
  const afterBytes = Buffer.byteLength(JSON.stringify(after.value));
  console.log(
    `  result: ${beforeBytes.toLocaleString()} B → ${afterBytes.toLocaleString()} B ` +
      `(${(beforeBytes / afterBytes).toFixed(1)}× smaller)`,
  );
}

async function seed(db) {
  await upsertRecipient(db, {
    organizationId: ORG,
    recipient: {
      id: 'rcp_evidence',
      displayName: 'Recipient',
      email: 'recipient@example.com',
      active: true,
    },
  });
  await createTask(db, ORG, {
    id: 'task_cap_evidence',
    organizationId: ORG,
    status: 'open',
    summaryPoints: [{ kind: 'action', text: 'Capability fixture' }],
    dueAt: null,
    waitingUntil: null,
    notes: [],
    reminder: { cadence: 'none' },
    retention: { policy: 'standard' },
    version: 1,
    createdAt: iso(0),
    updatedAt: iso(0),
  });
  await createActiveAssignment(db, ORG, 'task_cap_evidence', {
    id: 'asg_evidence',
    recipientId: 'rcp_evidence',
    intendedRecipientEmail: 'recipient@example.com',
    assignedAt: iso(0),
    assignedByOwnerId: 'owner_evidence',
    allowedCapabilityActions: ['view_assigned_task', 'complete_task'],
  });

  for (let t = 0; t < TASK_COUNT; t += 1) {
    const taskId = t === 0 ? 'task_cap_evidence' : `task_evidence_${String(t).padStart(3, '0')}`;
    if (t > 0) {
      await createTask(db, ORG, {
        id: taskId,
        organizationId: ORG,
        status: 'open',
        summaryPoints: [{ kind: 'action', text: `Task ${t}` }],
        dueAt: null,
        waitingUntil: null,
        notes: [],
        reminder: { cadence: 'none' },
        retention: { policy: 'standard' },
        version: 1,
        createdAt: iso(t),
        updatedAt: iso(t),
      });
    }
    for (let n = 0; n < NOTES_PER_TASK; n += 1) {
      await appendTaskNote(db, ORG, taskId, {
        id: `note_${t}_${String(n).padStart(4, '0')}`,
        body: `Recipient update ${n} for task ${t}. Representative note length for a real thread.`,
        createdAt: iso(t * 1000 + n),
        attribution: {
          kind: 'owner',
          owner: {
            ownerId: 'owner_evidence',
            recordedAt: iso(t * 1000 + n),
            requestId: `req_${t}_${n}`,
          },
        },
      });
    }
  }
}

/** The list query as it was before P1.3: every note of every listed Task. */
function listBefore(prisma) {
  return prisma.task.findMany({
    where: { organizationId: ORG },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: LIST_LIMIT + 1,
    include: {
      assignments: { where: { clearedAt: null }, take: 1 },
      notes: { orderBy: { createdAt: 'asc' } },
    },
  });
}

/** The list query as it is after P1.3: identical except the note relation is gone. */
function listAfter(prisma) {
  return prisma.task.findMany({
    where: { organizationId: ORG },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: LIST_LIMIT + 1,
    include: {
      assignments: { where: { clearedAt: null }, take: 1 },
    },
  });
}

/** The detail bundle as it was before P1.3: unbounded notes. */
function detailBefore(prisma) {
  return prisma.task.findFirst({
    where: { id: 'task_cap_evidence', organizationId: ORG },
    include: {
      assignments: { where: { clearedAt: null }, take: 1 },
      notes: { orderBy: { createdAt: 'asc' } },
    },
  });
}

/** The detail bundle as it is after P1.3: newest notes, bounded to the contract maximum. */
function detailAfter(prisma) {
  return prisma.task.findFirst({
    where: { id: 'task_cap_evidence', organizationId: ORG },
    include: {
      assignments: { where: { clearedAt: null }, take: 1 },
      notes: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: TASK_DETAIL_NOTE_LIMIT },
    },
  });
}

async function main() {
  const database = await createTestDatabase();
  const db = database.prisma;

  console.log(
    `Fixture: ${TASK_COUNT} Tasks × ${NOTES_PER_TASK} notes ` +
      `(${(TASK_COUNT * NOTES_PER_TASK).toLocaleString()} notes), list limit ${LIST_LIMIT}, ` +
      `${SAMPLES} samples after ${WARMUP} warm-ups. Local PGlite — not production.`,
  );

  await seed(db);

  console.log('\nOwner Task list — Prisma query shape, with vs without the note relation');
  report(await sample(() => listBefore(db)), await sample(() => listAfter(db)));

  console.log(
    `\nOwner Task detail — Prisma query shape, unbounded vs bounded to ${TASK_DETAIL_NOTE_LIMIT}`,
  );
  report(await sample(() => detailBefore(db)), await sample(() => detailAfter(db)));

  console.log('\nCapability authorization — full detail bundle vs lean projection');
  report(
    await sample(() => getTaskById(db, ORG, 'task_cap_evidence')),
    await sample(() => getTaskForCapabilityAuthorization(db, ORG, 'task_cap_evidence')),
  );

  // Shipping shape, for scale rather than comparison: the domain Task list the Owner
  // service maps to its DTO now carries no notes at all.
  const listed = await listTasks(db, { organizationId: ORG, limit: LIST_LIMIT });
  console.log(
    `\nShipped list result: ${Buffer.byteLength(JSON.stringify(listed)).toLocaleString()} B for ` +
      `${listed.items.length} Tasks, ` +
      `${listed.items.reduce((total, task) => total + task.notes.length, 0)} notes.`,
  );

  await database.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
