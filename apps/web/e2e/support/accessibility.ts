import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { redactCapabilityPaths } from './artifact-safety';

/**
 * Automated accessibility scanning for the D119 gate.
 *
 * D119 requires "zero serious or critical automated findings on the current routes". That is
 * the whole of the gate implemented here: `critical` and `serious` fail the run, `moderate`
 * and `minor` are reported so they are visible without silently widening scope.
 *
 * Two things this deliberately does not do. It does not restrict axe to a WCAG tag subset,
 * because D119 states a severity threshold and says nothing about tags — narrowing to tags
 * would quietly shrink the gate it defines. And it does not disable any rule globally; an
 * exclusion, if one were ever justified, belongs on the single element that earns it.
 *
 * Privacy (D114). Axe results carry two fields that cannot be printed on this application:
 * `results.url`, which on the Recipient surface *is* the capability secret, and each node's
 * `html`, which is the raw outerHTML of the failing element and so can contain a Task title,
 * a note, or a Recipient address. Neither is ever emitted. What is emitted — rule id, impact,
 * help text, selector, and axe's own failure summary — is additionally passed through the
 * harness's existing capability redaction before it reaches a message.
 */

/** Impacts that fail the build. Everything else is advisory for this stage. */
export const BLOCKING_IMPACTS = ['critical', 'serious'] as const;

type Impact = 'critical' | 'serious' | 'moderate' | 'minor';

interface Finding {
  rule: string;
  impact: Impact;
  help: string;
  /** CSS selector for the failing element, never its markup. */
  target: string;
  summary: string;
}

export interface ScanResult {
  /** Serious and critical: the D119 gate. */
  blocking: Finding[];
  /** Moderate and minor: recorded, not enforced at this stage. */
  advisory: Finding[];
}

/**
 * Make a string safe to print. Capability paths go through the harness's own redaction, then
 * anything quoted is dropped — quoted text inside a selector or summary is the one place page
 * content could ride along — and the result is capped so no field can become a bulk dump.
 */
function sanitize(value: string): string {
  const redacted = redactCapabilityPaths(String(value ?? ''))
    .replaceAll(/"[^"]*"/g, '"…"')
    .replaceAll(/'[^']*'/g, "'…'")
    .replaceAll(/\s+/g, ' ')
    .trim();
  return redacted.length > 300 ? `${redacted.slice(0, 300)}…` : redacted;
}

/**
 * Run axe over the whole page in its current state.
 *
 * The whole page, not a subtree: scanning a narrowed root is how a scan comes back clean
 * while the real problem sits just outside it. With a dialog open this therefore also covers
 * the content behind the backdrop, which is where modal-specific rules actually apply.
 */
export async function scanAccessibility(page: Page): Promise<ScanResult> {
  const results = await new AxeBuilder({ page }).analyze();

  const findings: Finding[] = results.violations.flatMap((violation) =>
    violation.nodes.map((node) => ({
      rule: violation.id,
      impact: (node.impact ?? violation.impact ?? 'minor') as Impact,
      help: sanitize(violation.help),
      target: sanitize(node.target.join(' ')),
      summary: sanitize(node.failureSummary ?? ''),
    })),
  );

  const blocks = (impact: Impact) => (BLOCKING_IMPACTS as readonly string[]).includes(impact);
  return {
    blocking: findings.filter((finding) => blocks(finding.impact)),
    advisory: findings.filter((finding) => !blocks(finding.impact)),
  };
}

function format(state: string, findings: Finding[]): string {
  const lines = findings.map(
    (finding) =>
      `  [${finding.impact}] ${finding.rule} — ${finding.help}\n` +
      `    target: ${finding.target}\n` +
      `    fix: ${finding.summary}`,
  );
  return `${findings.length} serious/critical accessibility violation(s) in "${state}":\n${lines.join('\n')}`;
}

/**
 * The D119 gate for one route or interaction state.
 *
 * `state` names the surface in the failure message, because a bare rule id gives no clue
 * which of a dozen scanned states produced it.
 */
export async function expectNoSeriousOrCriticalViolations(
  page: Page,
  state: string,
): Promise<ScanResult> {
  const result = await scanAccessibility(page);

  if (result.advisory.length > 0) {
    // Recorded, never enforced at this stage. Rule ids and counts only.
    const counts = new Map<string, number>();
    for (const finding of result.advisory) {
      counts.set(`${finding.impact}:${finding.rule}`, (counts.get(finding.rule) ?? 0) + 1);
    }
    console.log(
      `[a11y advisory] ${state}: ${[...counts.entries()].map(([k, n]) => `${k}×${n}`).join(', ')}`,
    );
  }

  expect(result.blocking, format(state, result.blocking)).toEqual([]);
  return result;
}
