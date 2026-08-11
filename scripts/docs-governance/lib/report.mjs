/**
 * Findings model.
 *
 * Exactly two severities can change the outcome, and the difference is deliberate:
 *
 *   fail   — a mechanical, deterministic violation of a D165 invariant. Never advisory,
 *            never suppressible, always exit code 1.
 *   review — something a machine cannot decide honestly. Reported in full, exit code 0.
 *            A review item is not a soft failure; it is work assigned to a human reviewer
 *            for the batch in progress.
 *
 * Nothing is downgraded to `review` because it was inconvenient to implement. Every
 * `review` category exists because the underlying question is semantic (does "D106 ceiling"
 * still mean what it meant?) rather than structural.
 */

export const SEVERITY = { fail: 'fail', review: 'review', info: 'info' };

export function createFindings() {
  const items = [];

  const add = (severity) => (code, message, detail) => {
    items.push({ severity, code, message, detail: detail ?? null });
  };

  return {
    items,
    fail: add(SEVERITY.fail),
    review: add(SEVERITY.review),
    /** Observations carry no code, because nothing acts on them. */
    info: (message, detail) => {
      items.push({ severity: SEVERITY.info, code: 'observation', message, detail: detail ?? null });
    },
    get failures() {
      return items.filter((item) => item.severity === SEVERITY.fail);
    },
    get reviews() {
      return items.filter((item) => item.severity === SEVERITY.review);
    },
    get infos() {
      return items.filter((item) => item.severity === SEVERITY.info);
    },
  };
}

function groupByCode(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.code)) groups.set(item.code, []);
    groups.get(item.code).push(item);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function renderDetail(detail, indent) {
  if (detail === null || detail === undefined) return [];
  if (typeof detail === 'string') return [`${indent}${detail}`];
  return Object.entries(detail).map(([key, value]) => {
    const rendered = Array.isArray(value) ? value.join(', ') : String(value);
    return `${indent}${key}: ${rendered}`;
  });
}

export function formatReport(findings, { title, checks, verbose }) {
  const lines = [title, ''];

  lines.push('Checks run:');
  for (const check of checks) {
    lines.push(`  ${check.status === 'skipped' ? '-' : '·'} ${check.name}: ${check.summary}`);
  }
  lines.push('');

  const render = (label, items) => {
    if (items.length === 0) return;
    lines.push(`${label} (${items.length}):`);
    for (const [code, group] of groupByCode(items)) {
      lines.push(`  [${code}] ${group.length === 1 ? '' : `${group.length} items`}`.trimEnd());
      const shown = verbose ? group : group.slice(0, 20);
      for (const item of shown) {
        lines.push(`    - ${item.message}`);
        lines.push(...renderDetail(item.detail, '        '));
      }
      if (shown.length < group.length) {
        lines.push(`    ... ${group.length - shown.length} more (use --verbose)`);
      }
    }
    lines.push('');
  };

  render('HARD FAILURES', findings.failures);
  render('HUMAN-REVIEW ITEMS', findings.reviews);

  if (findings.infos.length > 0) {
    lines.push('Observations:');
    for (const item of findings.infos) {
      lines.push(`  - ${item.message}`);
      lines.push(...renderDetail(item.detail, '      '));
    }
    lines.push('');
  }

  lines.push(
    findings.failures.length === 0
      ? `RESULT: green — 0 hard failures, ${findings.reviews.length} human-review item(s).`
      : `RESULT: red — ${findings.failures.length} hard failure(s), ${findings.reviews.length} human-review item(s).`,
  );
  lines.push(
    'Human-review items do not affect the exit code. This command is not part of pnpm verify or CI (D165).',
  );

  return lines.join('\n');
}
