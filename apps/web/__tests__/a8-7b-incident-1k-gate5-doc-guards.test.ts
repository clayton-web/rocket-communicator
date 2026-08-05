import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A8.7b-INCIDENT-1k Gate 5 documentation guards.
 *
 * Gate 5 deploys the queued A8.4b–A8.6 code to a Production already at `D2`. Every gate before it
 * was a database operation, and the runbook's own history is the reason these guards exist: the
 * A8 schema incident happened because a deployment reached Production through push-to-`main` with
 * no inspection step, and the 1d hotfix nearly compounded it by promoting a preview-target build
 * that had no `DATABASE_URL`.
 *
 * So the facts guarded here are the ones whose loss would reintroduce a specific failure that has
 * already happened once, plus the reconciliation facts whose regression would send an operator to
 * work from a Production state that no longer exists.
 *
 * These guards deliberately do not assert prose. Wording is what architecture review is for; what
 * a guard can defend is that a load-bearing claim is still present and has not been inverted.
 */

const repoRoot = path.resolve(__dirname, '../../..');
const migrationsDir = path.join(repoRoot, 'packages/db/prisma/migrations');

function read(relativePath: string): string {
  const absolute = path.join(repoRoot, relativePath);
  expect(existsSync(absolute), `${relativePath} must exist`).toBe(true);
  return readFileSync(absolute, 'utf8');
}

const GATE_5_HEADING = '### Gate 5 — Deploying the queued A8.4b–A8.6 code';
const GATE_5_EVIDENCE_HEADING = '## Gate 5 — Deploying the queued A8.4b–A8.6 code';

/** The four migrations Gate 4 applied. Gate 5 applies none of them, or anything else. */
const GATE_4_FOUR = [
  '20260802173000_a8_4b1_capability_skip_reason',
  '20260802210000_a8_4b2_repeated_ambiguous_stop_reason',
  '20260803090000_a8_4b3_advance_due_scan_index',
  '20260803120000_a8_5a_owner_notification_intents',
] as const;

/** The one route the queued code adds relative to the deployed `534959d`. */
const NEW_ROUTE = '/api/v1/internal/notifications/process';

function runbook(): string {
  return read('docs/DEPLOYMENT.md');
}

function evidence(): string {
  return read('docs/A8_7_EVIDENCE.md');
}

/** The Gate 5 section alone, so a fact stated only for Gate 4 cannot satisfy a Gate 5 guard. */
function gate5Section(): string {
  const contents = runbook();
  const start = contents.indexOf(GATE_5_HEADING);
  expect(start, 'the Gate 5 runbook section must exist').toBeGreaterThan(-1);

  // The next `###` heading bounds the section; `####` and `#####` subsections belong to it.
  const rest = contents.slice(start + GATE_5_HEADING.length);
  const end = rest.search(/\n### [^#]/);
  return end === -1 ? rest : rest.slice(0, end);
}

function gate5EvidenceSection(): string {
  const contents = evidence();
  const start = contents.indexOf(GATE_5_EVIDENCE_HEADING);
  expect(start, 'the Gate 5 evidence record must exist').toBeGreaterThan(-1);
  const rest = contents.slice(start + GATE_5_EVIDENCE_HEADING.length);
  const end = rest.search(/\n## [^#]/);
  return end === -1 ? rest : rest.slice(0, end);
}

describe('the Gate 5 runbook exists and is bounded to a deployment', () => {
  it('names Gate 5 as its own section, findable without chat history', () => {
    expect(runbook()).toContain(GATE_5_HEADING);
  });

  it('carries numbered subsections comparable to Gate 4', () => {
    const section = gate5Section();
    // Every load-bearing step must be addressable, because stop conditions cross-reference them.
    for (const anchor of ['G5.1', 'G5.2', 'G5.3', 'G5.11', 'G5.12', 'G5.17', 'G5.18', 'G5.20']) {
      expect(section, `${anchor} must exist so the runbook can cross-reference it`).toContain(
        anchor,
      );
    }
  });

  it('states that Gate 5 was executed and does not authorize Gate 6', () => {
    const section = gate5Section();
    expect(section).toMatch(/Executed 2026-08-05/);
    expect(section).toMatch(/Gate 5 is complete/);
    expect(section).toMatch(/does not authorize/);
    expect(section).toMatch(/Gate 6/);
  });

  it('requires its own Owner authorization and refuses to inherit Gate 4s', () => {
    const section = gate5Section();
    expect(section).toMatch(/Gate 5 requires its own explicit Owner authorization/);
    expect(section).toMatch(/Gate 4's completion authorizes nothing here/);
  });

  it('runs no migration, and says so against the four Gate 4 names', () => {
    const section = gate5Section();
    expect(section).toMatch(/no migration runs at any point, including during the build/);
    // Gate 5 must not restate the Gate 4 migration set as work of its own.
    for (const name of GATE_4_FOUR) {
      expect(section, `${name} belongs to Gate 4, not Gate 5`).not.toContain(name);
    }
  });

  it('derives its fourteen-migration expectation from the real migration tree', () => {
    const onDisk = readdirSync(migrationsDir).filter((entry) => /^2026/.test(entry));
    expect(onDisk).toHaveLength(14);
    expect(gate5Section()).toMatch(/[Ee]xactly fourteen/);
  });
});

describe('the D3 / F0 baseline must not regress to D2-as-current', () => {
  it('records Production as D3 / F0 in the current-state section', () => {
    const contents = runbook();
    const start = contents.indexOf('### Current production state');
    expect(start).toBeGreaterThan(-1);
    const rest = contents.slice(start);
    const section = rest.slice(0, rest.search(/\n### [^#]/));

    expect(section, 'the current state is D3 / F0').toMatch(/\*\*D3\*\* \(`F0`\)|\*\*D3\*\* \/ `F0`|\*\*D3 \/ F0\*\*/);
    expect(section, 'Production holds all fourteen migrations').toMatch(/fourteen/);
    expect(section, 'all three flags remain absent').toMatch(/Absent/);
    // The exact stale claims this reconciliation removed must not come back.
    expect(section).not.toMatch(/State\s*\|\s*\*\*D1′\*\*/);
    expect(section).not.toMatch(/ten rows in `_prisma_migrations`/);
    expect(section).not.toMatch(/State\s*\|\s*\*\*D2\*\*/);
  });

  it('marks D3 as current and D2 / D1prime as left in the state matrix', () => {
    const contents = runbook();
    const start = contents.indexOf('### Approved repair state matrix');
    const rest = contents.slice(start);
    const matrix = rest.slice(0, rest.search(/\n### [^#]/));

    const d3Row = matrix.split('\n').find((line) => line.includes('**D3**'));
    const d2Row = matrix.split('\n').find((line) => line.includes('**D2**'));
    const d1PrimeRow = matrix.split('\n').find((line) => line.includes('**D1′**'));
    expect(d3Row, 'D3 row must exist').toBeDefined();
    expect(d2Row, 'D2 row must exist as history').toBeDefined();
    expect(d1PrimeRow, "D1' row must exist as history").toBeDefined();
    expect(d3Row, 'D3 is the current state').toMatch(/Current state/);
    expect(d2Row, 'D2 must not be labelled current').not.toMatch(/\*\*Current state\.\*\*/);
    expect(d1PrimeRow, "D1' must not be labelled current").not.toMatch(/\*\*Current state\.\*\*/);
  });

  it('describes no migration as unapplied in production', () => {
    const contents = runbook();
    expect(contents).not.toMatch(/\*\*not yet applied in production\*\*/);
    expect(contents).not.toMatch(/are still unapplied/);
  });

  it('records each Gate 4 migration as applied, by name', () => {
    const contents = runbook();
    for (const name of GATE_4_FOUR) {
      const line = contents.split('\n').find((l) => l.includes(`${name}/`) && l.includes('**'));
      expect(line, `${name} must have a migration-list entry`).toBeDefined();
      expect(line, `${name} must be recorded as applied`).toMatch(
        /applied in production 2026-08-05/,
      );
    }
  });

  it('does not claim A8.6c is blocked on migrations 6-9', () => {
    const contents = runbook();
    expect(contents).not.toMatch(/A8\.6c therefore cannot ship until/);
    expect(contents).toMatch(/the blocker is cleared and A8\.6c can ship/);
  });

  it('marks the Gate 4 section complete rather than pending', () => {
    const contents = runbook();
    const start = contents.indexOf('### Gate 4 — Production migrations 6–9');
    expect(start).toBeGreaterThan(-1);
    const banner = contents.slice(start, start + 1200);
    expect(banner).toMatch(/Executed 2026-08-05/);
    expect(banner).toMatch(/Gate 4 is complete/);
    // The slice table must agree with the section banner.
    expect(contents).not.toMatch(/\*\*Gate 4\*\*.*\*\*Pending\*\*/);
  });
});

describe('the deployment method is production-target, inspected, and never a push', () => {
  it('specifies the production-target build command with skip-domain', () => {
    expect(gate5Section()).toMatch(/vercel deploy --prod --skip-domain --yes/);
  });

  it('prohibits push-to-main as the Gate 5 deployment method', () => {
    const section = gate5Section();
    expect(section).toMatch(/`git push origin main` is prohibited as the Gate 5 deployment method/);
    // The reason must survive alongside the rule, because the rule looks arbitrary without it.
    expect(section).toMatch(/no inspection step/i);
    expect(section).toMatch(/A8 schema incident/);
  });

  it('prohibits promoting a preview-target deployment, with the reason attached', () => {
    const section = gate5Section();
    expect(section).toMatch(/Promoting a preview-target deployment is prohibited/);
    expect(section).toMatch(/DATABASE_URL/);
    expect(section).toMatch(/must not be promoted/);
  });

  it('requires production-target inspection before promotion', () => {
    const section = gate5Section();
    expect(section).toMatch(/Pre-promotion inspection/);
    expect(section).toMatch(/Deployment target\s*\|\s*\*\*`production`\.?\*\*/);
    expect(section).toMatch(/Only after every .*G5\.11/);
  });

  it('requires the build log to show no migration', () => {
    expect(gate5Section()).toMatch(
      /\*\*Migration during build\*\*\s*\|\s*\*\*None\.\*\*\s*Only `prisma generate`/,
    );
  });

  it('never describes skip-domain as making the artifact unreachable', () => {
    const section = gate5Section();
    expect(section).toMatch(/does not make the artifact unreachable/);
    expect(section).toMatch(/immutable deployment URL/);
    // The wrong claim, in the shape it took before the correction. The section is allowed to
    // quote the phrase in order to reject it, so only the assertion form is prohibited.
    expect(section).not.toMatch(/environment variables, and serves no traffic/);
    expect(section).not.toMatch(/unreachable until promoted/);
    expect(section).toMatch(/zero \*\*aliased\*\* traffic, not zero exposure/);
  });

  it('names the control that actually prevents traffic movement', () => {
    const section = gate5Section();
    expect(section).toMatch(/control that actually prevents accidental traffic movement/);
    expect(section).toMatch(/not pushing to `main`/);
  });

  it('keeps the same skip-domain correction in the general deployment section', () => {
    const contents = runbook();
    const start = contents.indexOf('### Deploying a commit that is not on `main`');
    const rest = contents.slice(start);
    const section = rest.slice(0, rest.search(/\n### [^#]/));
    expect(section).toMatch(/does not make the artifact unreachable/);
    expect(section).not.toMatch(/holds Production environment variables, and serves no traffic/);
  });
});

describe('the expected route set is stated as a delta', () => {
  it('names the one added route and requires it by name', () => {
    const section = gate5Section();
    expect(section).toContain(NEW_ROUTE);
    expect(section).toMatch(/adds \*\*exactly one route\*\*/);
  });

  it('states the expected route count and warns against matching the 1d figure', () => {
    const section = gate5Section();
    expect(section).toMatch(/\*\*51\*\*/);
    expect(section).toMatch(/Do not compare against the 1d figure/);
    expect(section).toMatch(/counted on different bases/);
  });

  /*
   * The build log and the manifest disagree by one, and an operator who does not know why will
   * read the difference as a defect. Both numbers therefore have to be stated together with the
   * reason, or the smaller one becomes a false stop condition.
   */
  it('states both counting bases and reconciles them', () => {
    const section = gate5Section();
    expect(section).toMatch(/routes-manifest\.json/);
    expect(section).toMatch(/\*\*52\*\*/);
    expect(section).toMatch(/_global-error/);
    expect(section).toMatch(/describe the same build/);
  });

  it('requires verification by name rather than by count alone', () => {
    expect(gate5Section()).toMatch(/Verify by name/);
  });

  it('agrees with the route files actually present in the app tree', () => {
    const appDir = path.join(repoRoot, 'apps/web/app');
    const routeFile = path.join(appDir, 'api/v1/internal/notifications/process/route.ts');
    expect(existsSync(routeFile), `${NEW_ROUTE} must exist for the runbook to expect it`).toBe(
      true,
    );
  });

  /*
   * Conditional for the same reason 1j's bundle guard is: `pnpm verify` runs the suite before
   * `build:web`, so on a clean checkout there is no manifest to read. When one exists it makes the
   * documented 52 self-verifying instead of a number an operator has to trust.
   */
  it('matches the real routes manifest when a local build is present', () => {
    const manifestPath = path.join(repoRoot, 'apps/web/.next/routes-manifest.json');
    if (!existsSync(manifestPath)) {
      return;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      staticRoutes?: { page: string }[];
      dynamicRoutes?: { page: string }[];
    };
    const pages = new Set(
      [...(manifest.staticRoutes ?? []), ...(manifest.dynamicRoutes ?? [])].map((r) => r.page),
    );
    expect(pages.has(NEW_ROUTE), `${NEW_ROUTE} must be in the built route set`).toBe(true);
    expect(pages.has('/attention')).toBe(true);
    expect(pages.has('/api/v1/tasks/[taskId]/reminder')).toBe(true);
    expect(pages.size, 'the runbook documents 52 manifest entries').toBe(52);
  });
});

describe('the smoke sequence covers the checks that caught real defects', () => {
  it('includes the /attention check and treats an error boundary as a hard stop', () => {
    const section = gate5Section();
    expect(section).toMatch(/Owner `\/attention` in a browser/);
    expect(section).toMatch(/neither reaches the error boundary/);
    expect(section).toMatch(/An error boundary on this page is a hard stop/);
  });

  it('covers both /attention sections separately', () => {
    const section = gate5Section();
    expect(section).toMatch(/section one/);
    expect(section).toMatch(/section two/);
    expect(section).toMatch(/owner_notification_intents/);
  });

  it('includes the reminder ETag v0 regression check', () => {
    const section = gate5Section();
    expect(section).toMatch(/ETag ending `v0`/);
    expect(section).toMatch(/the 1d regression check/);
    // The misleading diagnostic signature must travel with the check.
    expect(section).toMatch(/UNKNOWN_FAILURE/);
  });

  it('probes unauthenticated routing before spending a session', () => {
    expect(gate5Section()).toMatch(/unauthenticated[\s\S]{0,120}401 `UNAUTHORIZED`/);
  });
});

describe('flags, schedulers, and inertness are required', () => {
  it('requires all three flags absent, by name', () => {
    const section = gate5Section();
    for (const flag of [
      'ENABLE_OWNER_EVENT_CAPTURE',
      'ENABLE_OWNER_EVENT_DELIVERY',
      'ENABLE_REMINDER_DELIVERY',
    ]) {
      expect(section, `${flag} must be named`).toContain(flag);
    }
    expect(section).toMatch(/must be absent before the build, absent in the built deployment/);
    expect(section).toMatch(/a flag found present is a hard stop/);
  });

  it('requires scheduler inactivity and forbids creating the notification job', () => {
    const section = gate5Section();
    expect(section).toMatch(/must be inactive before Gate 5 and must remain inactive through it/);
    expect(section).toMatch(/No job may be created, resumed, edited, or invoked/);
    expect(section).toMatch(/Notification-processing job: \*\*does not exist\*\*/);
  });

  it('requires an Owner no-use window and records that no flag enforces it', () => {
    const section = gate5Section();
    expect(section).toMatch(/Owner no-use window/);
    expect(section).toMatch(/This is a discipline, not a control/);
  });

  it('verifies inertness with unchanged counts after promotion', () => {
    const section = gate5Section();
    expect(section).toMatch(/Inertness verification/);
    expect(section).toMatch(/Still exactly fourteen rows/);
    expect(section).toMatch(/Any non-zero notification count is a hard stop/);
  });
});

describe('containment and rollback posture', () => {
  it('names a fresh production-target build of 534959d as primary containment', () => {
    const section = gate5Section();
    expect(section).toMatch(/Primary containment is a fresh production-target build of `534959d`/);
  });

  it('never presents one-step Instant Rollback as safe', () => {
    const section = gate5Section();
    expect(section).toMatch(/One-step Instant Rollback is unavailable/);
    expect(section).not.toMatch(/one-step rollback is safe/i);
    expect(section).not.toMatch(/simply roll back/i);
  });

  it('keeps 8588c5d as a redeployment requiring read-only confirmation', () => {
    const section = gate5Section();
    expect(section).toMatch(/`8588c5d` remains the universal fallback/);
    expect(section).toMatch(/redeployment\*\*, not a rollback/);
    expect(section).toMatch(/confirmed read-only before Gate 5 begins/);
  });

  it('states that rollback never reverses a migration', () => {
    expect(gate5Section()).toMatch(/Rolling back does not undo a migration/);
  });

  it('keeps scheduler state and environment binding as separate concerns', () => {
    const section = gate5Section();
    expect(section).toMatch(/Rollback does not disable an external scheduler job/);
    expect(section).toMatch(/A deployment carries the environment variables it was built with/);
    expect(section).toMatch(/separate concerns from the deployment/);
  });
});

describe('Gate 6 separation', () => {
  it('ends with an explicit stop before Gate 6', () => {
    const section = gate5Section();
    expect(section).toMatch(/G5\.20 Stop before Gate 6/);
    expect(section).toMatch(/Explicitly not authorized by Gate 5/);
  });

  it('is followed by a prepared Gate 6 first-activation runbook that is unbegun', () => {
    const contents = runbook();
    expect(contents).toContain('### Gate 6 — First controlled production enablement (A8.7c capture / F0 → F1)');
    const start = contents.indexOf('### Gate 6 — First controlled production enablement');
    const rest = contents.slice(start);
    const section = rest.slice(0, rest.search(/\n### [^#]/));
    expect(section).toMatch(/Gate 6 has not been executed/);
    expect(section).toMatch(/this section does not authorize it/);
    expect(section).toContain('ENABLE_OWNER_EVENT_CAPTURE');
    expect(section).toMatch(/G6\.1/);
    expect(section).toMatch(/G6\.14/);
    expect(section).toMatch(/G6\.15/);
    // Delivery and reminder must remain out of scope for the first activation.
    expect(section).toMatch(/ENABLE_OWNER_EVENT_DELIVERY/);
    expect(section).toMatch(/Out of scope/);
  });

  it('includes a deterministic Gate 6 operator execution checklist that does not authorize execution', () => {
    const contents = runbook();
    const start = contents.indexOf('#### G6.15 Operator execution checklist');
    expect(start).toBeGreaterThan(-1);
    const rest = contents.slice(start);
    const section = rest.slice(0, rest.search(/\n### [^#]/));
    expect(section).toMatch(/does not authorize Gate 6/);
    expect(section).toMatch(/Documentation only/);
    // Required operator surfaces from the Gate 6 checklist slice.
    expect(section).toMatch(/Preconditions/);
    expect(section).toMatch(/EC-1/);
    expect(section).toMatch(/EC-12/);
    expect(section).toMatch(/Expected result/);
    expect(section).toMatch(/Evidence/);
    expect(section).toMatch(/Explicit stop conditions/);
    expect(section).toMatch(/Explicit rollback trigger points/);
    expect(section).toMatch(/G6\.12/);
    expect(section).toMatch(/Final verification checklist/);
    expect(section).toMatch(/Gate completion criteria/);
    expect(section).toMatch(/Owner authorization checkpoints/);
    // First activation only — capture flag alone; later gates withheld.
    expect(section).toContain('ENABLE_OWNER_EVENT_CAPTURE');
    expect(section).toMatch(/ENABLE_OWNER_EVENT_DELIVERY/);
    expect(section).toMatch(/A8\.7d/);
    expect(section).toMatch(/A8\.7e/);
    expect(section).toMatch(/never mark complete by doing these/);
    expect(section).toMatch(/setting `ENABLE_OWNER_EVENT_DELIVERY` or `ENABLE_REMINDER_DELIVERY`/);
  });

  it('names every Gate 6 action it withholds', () => {
    const section = gate5Section();
    for (const withheld of ['A8.7c', 'A8.7d', 'A8.7e']) {
      expect(section, `${withheld} must be named as withheld`).toContain(withheld);
    }
    expect(section).toMatch(/Setting any of the three A8 flags/);
  });

  it('treats reconciling origin/main as a separate Owner decision', () => {
    expect(gate5Section()).toMatch(/Reconciling `origin\/main`/);
  });
});

describe('the nine PostgreSQL suites and Docker classification', () => {
  it('lists all nine suites as a Gate 5 prerequisite', () => {
    const section = gate5Section();
    const suites = [
      'a8-5e-worker-concurrency.pg.test.ts',
      'owner-reminder-concurrency.pg.test.ts',
      'reminder-advance-waiting-skip.pg.test.ts',
      'reminder-worker-concurrency.pg.test.ts',
      'a8-4a-occurrence-concurrency.pg.test.ts',
      'a8-5a-owner-notification.pg.test.ts',
      'a8-5b-notification-concurrency.pg.test.ts',
      'a8-5d-producer-concurrency.pg.test.ts',
      'a8-6c-missed-notification-read.pg.test.ts',
    ];
    for (const suite of suites) {
      expect(section, `${suite} must be listed`).toContain(suite);
    }
  });

  it('lists exactly the suites that exist on disk, so the list cannot drift', () => {
    const onDisk = [
      ...readdirSync(path.join(repoRoot, 'apps/web/__tests__')),
      ...readdirSync(path.join(repoRoot, 'packages/db/__tests__')),
    ].filter((entry) => entry.endsWith('.pg.test.ts'));
    expect(onDisk).toHaveLength(9);

    const section = gate5Section();
    for (const suite of onDisk) {
      expect(section, `${suite} exists but the runbook does not list it`).toContain(suite);
    }
  });

  it('records that pnpm verify never runs them', () => {
    expect(gate5Section()).toMatch(/`pnpm verify` therefore never runs them/);
  });

  it('classifies Docker as required only for those suites', () => {
    const section = gate5Section();
    expect(section).toMatch(/Docker is required for these suites and for nothing else in Gate 5/);

    const contents = runbook();
    const start = contents.indexOf('#### Docker');
    expect(start).toBeGreaterThan(-1);
    const rest = contents.slice(start);
    const docker = rest.slice(0, rest.search(/\n### [^#]/));
    expect(docker).toMatch(/Gate 5 classification/);
    expect(docker).toMatch(/Gate 5 build, inspection, promotion[\s\S]{0,80}\*\*Not required\*\*/);
  });
});

describe('the commit ancestry statement', () => {
  it('states all four ancestry claims precisely', () => {
    const contents = runbook();
    const start = contents.indexOf('##### Commit ancestry of the deployed hotfix');
    expect(start, 'the ancestry subsection must exist').toBeGreaterThan(-1);
    const rest = contents.slice(start);
    const section = rest.slice(0, rest.search(/\n#{1,5} [^#]/) + 1 || undefined);

    expect(section).toMatch(/`534959d` is an ancestor of local `main`/);
    expect(section).toMatch(/`68bedff`/);
    expect(section).toMatch(/is not an ancestor of `origin\/main`/);
    expect(section).toMatch(/carries the reminder ETag fix forward/);
    expect(section).toMatch(/No cherry-pick and no rebase is required/);
  });

  it('does not leave the bare not-an-ancestor-of-main claim anywhere', () => {
    const contents = runbook();
    // The old wording, which was true only of origin/main.
    expect(contents).not.toMatch(/\*\*Not an ancestor of `main`\*\*/);
    expect(contents).not.toMatch(/It is not an ancestor of `main`\./);
  });

  it('requires the deployment worktree to verify ancestry mechanically', () => {
    expect(gate5Section()).toMatch(/git merge-base --is-ancestor 534959d HEAD/);
  });
});

describe('the build-command question is posed as an Owner decision', () => {
  it('states both candidate commands and does not silently pick one', () => {
    const section = gate5Section();
    expect(section).toMatch(/pnpm build:vercel/);
    expect(section).toMatch(/pnpm --filter @aicaa\/web build/);
    expect(section).toMatch(/omits `pnpm build:ai`/);
    expect(section).toMatch(/This is an Owner decision and it is not made here/);
  });

  it('forbids changing the Vercel setting during the gate', () => {
    expect(gate5Section()).toMatch(/No Vercel setting may be changed during Gate 5 itself/);
  });

  it('matches the build scripts that actually exist', () => {
    const rootScripts = JSON.parse(read('package.json')).scripts as Record<string, string>;
    const webScripts = JSON.parse(read('apps/web/package.json')).scripts as Record<string, string>;
    // The recommendation only makes sense while build:vercel is the ordered chain.
    expect(rootScripts['build:vercel']).toContain('build:ai');
    // And the acceptance option only holds while the web build invokes the AI build transitively.
    expect(webScripts.build).toContain('@aicaa/ai');
  });
});

describe('the Gate 5 evidence record', () => {
  it('exists between Gate 4 and A8.7c Stage 11', () => {
    const contents = evidence();
    const gate4 = contents.indexOf('## Gate 4 — Production migrations 6–9');
    const gate5 = contents.indexOf(GATE_5_EVIDENCE_HEADING);
    const stage11 = contents.indexOf('## A8.7c — Owner-event capture');

    expect(gate4).toBeGreaterThan(-1);
    expect(gate5, 'the Gate 5 evidence record must exist').toBeGreaterThan(-1);
    expect(gate5, 'Gate 5 must follow Gate 4').toBeGreaterThan(gate4);
    expect(gate5, 'Gate 5 must precede A8.7c').toBeLessThan(stage11);
  });

  it('is marked executed and complete at D3 / F0', () => {
    const section = gate5EvidenceSection();
    expect(section).toMatch(/Executed and verified 2026-08-05/);
    expect(section).toMatch(/`D3` \(`F0`\)|\*\*`D3` \/ `F0`\*\*/);
    expect(section).toMatch(/Gate 6 not begun/);
  });

  it('refuses reuse of the Gate 4 record, with the reason', () => {
    const section = gate5EvidenceSection();
    expect(section).toMatch(/Do not record Gate 5 in the/);
    expect(section).toMatch(/Gate 5 runs no migration at all/);
  });

  it('carries a field for every required capture category', () => {
    const section = gate5EvidenceSection();
    const required: Array<[string, RegExp]> = [
      ['authorization', /Authorization reference/],
      ['execution window', /Execution window/],
      ['exact deployed commit', /Exact deployed commit/],
      ['worktree path', /Deployment worktree path/],
      ['worktree cleanliness', /git status --short` empty/],
      ['previous deployment ID', /Previous deployment ID/],
      ['new deployment ID', /New deployment ID/],
      ['deployment target', /Deployment target/],
      ['READY state', /READY/],
      ['metadata commit SHA', /Commit SHA bound to the deployment/],
      ['build command', /Build command, from project settings/],
      ['Node version', /Node version, from project settings/],
      ['no migration during build', /Migration during build \(expect none\)/],
      ['route count', /Route count/],
      ['route delta', /Route delta/],
      ['production-only bindings', /five Production-only variables/],
      ['flag absence', /Flags in the deployment environment/],
      ['scheduler state', /Scheduler state before/],
      ['pre-promotion inspection', /Pre-promotion inspection/],
      ['promotion result', /Promotion command and result/],
      ['database counts after', /Q2 migration history after/],
      ['final state', /Final state/],
      ['Gate 6 not begun', /Gate 6 not begun/],
    ];
    for (const [label, pattern] of required) {
      expect(section, `the capture record must have a ${label} field`).toMatch(pattern);
    }
  });

  it('has a row for each of the twelve smoke checks', () => {
    const section = gate5EvidenceSection();
    for (let index = 1; index <= 12; index += 1) {
      expect(section, `smoke check ${index} must have a row`).toContain(`**Smoke ${index}**`);
    }
  });

  it('has deviations, stop conditions, and containment tables', () => {
    const section = gate5EvidenceSection();
    expect(section).toMatch(/### Deviations from the approved procedure/);
    expect(section).toMatch(/### Stop conditions encountered/);
    expect(section).toMatch(/### Containment actions taken/);
  });

  it('states what the gate must not do, including migrating and pushing', () => {
    const section = gate5EvidenceSection();
    expect(section).toMatch(/No migration of any kind/);
    expect(section).toMatch(/No push to `main`/);
    expect(section).toMatch(/No promotion of a preview-target deployment/);
    expect(section).toMatch(/Gate 6 is not begun/);
  });
});
