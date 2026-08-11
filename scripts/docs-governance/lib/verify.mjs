/**
 * Verification orchestration.
 *
 * Exposed as a function rather than only as a CLI so the tests drive the real checks against
 * synthetic fixtures instead of re-implementing them.
 */

import { readFileSync } from 'node:fs';

import { checkCitations } from './checks/citations.mjs';
import {
  checkInertIsolation,
  checkInertSentinelUsage,
  checkOperativeText,
} from './checks/operative.mjs';
import { checkOrdering } from './checks/ordering.mjs';
import { checkStructure } from './checks/structure.mjs';
import { checkSupersession } from './checks/supersession.mjs';
import { createFindings } from './report.mjs';
import { loadBaseline } from './baseline.mjs';
import { parseRegister } from './parse-register.mjs';

export function runVerification({
  registerPath,
  baselinePath,
  repoRoot,
  scanCitations = true,
  citationExclusions = [],
  source,
  baseline: providedBaseline,
}) {
  const findings = createFindings();
  const checks = [];

  const registerSource = source ?? readFileSync(registerPath, 'utf8');
  const baseline = providedBaseline ?? loadBaseline(baselinePath);

  const { records, problems, representations } = parseRegister(registerSource);

  for (const problem of problems) {
    findings.fail('malformed-register', `line ${problem.line}: ${problem.message}`);
  }

  checks.push({
    name: 'representation parse',
    status: 'ran',
    summary: `${records.length} record(s) read as ${representations.join(' + ') || 'no known representation'}`,
  });

  const structure = checkStructure({ records, baseline, findings });
  checks.push({
    name: 'structure',
    status: 'ran',
    summary: `D001–${structure.highest ?? '???'} identity, completeness, required fields, status vocabulary`,
  });

  const ordering = checkOrdering({ records, baseline, findings });
  checks.push({
    name: 'transition ordering',
    status: 'ran',
    summary:
      ordering.state === 'converted'
        ? 'fully converted: strict global ascending order enforced end to end'
        : `${ordering.state} representation (${ordering.legacyRecords} legacy row(s), ${ordering.convertedRecords} converted): legacy section order, frozen section anchoring, per-section and baseline-relative order`,
  });

  const classifications = checkOperativeText({ baseline, byId: structure.byId, findings });
  checkInertSentinelUsage({ records, findings });
  checkInertIsolation({ records, findings });
  checks.push({
    name: 'operative text, boundaries, inert history',
    status: 'ran',
    summary: `${classifications.identical} identical, ${classifications.relocated} relocated, ${classifications.changed} changed against the frozen baseline`,
  });

  checkSupersession({ records, byId: structure.byId, baseline, findings });
  checks.push({
    name: 'supersession',
    status: 'ran',
    summary: 'in-part completeness, status contradictions, counterpart preservation',
  });

  if (scanCitations) {
    const citations = checkCitations({
      repoRoot,
      byId: structure.byId,
      exclusions: citationExclusions,
      findings,
    });
    checks.push({
      name: 'repository citations',
      status: 'ran',
      summary: `${citations.bareCitations} bare and ${citations.rangeCitations} range citation(s) across ${citations.filesScanned} tracked file(s); ${citations.namedCitations} named-clause citation(s) reported`,
    });
  } else {
    checks.push({
      name: 'repository citations',
      status: 'skipped',
      summary: 'skipped (--no-citations)',
    });
  }

  return {
    findings,
    checks,
    records,
    representations,
    highestAssignedId: structure.highest,
    ordering,
    classifications,
  };
}
