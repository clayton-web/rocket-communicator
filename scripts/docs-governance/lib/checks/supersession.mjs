/**
 * Supersession and amendment semantics.
 *
 * Full semantic reciprocity cannot be decided mechanically in this register, and pretending
 * otherwise would either fabricate relationships or force the harness red on history that was
 * always one-sided. The split is therefore explicit:
 *
 * Hard failures — structural claims the register itself already makes:
 *   · a Superseded-in-part record must still identify the amending decision, what was
 *     withdrawn, and what remains operative;
 *   · a record that says it was superseded must carry a superseded status, and "in part"
 *     must match "Superseded in part";
 *   · a record that says it supersedes another in part must point at a record whose status is
 *     "Superseded in part";
 *   · a supersession counterpart that the frozen baseline recorded must not vanish.
 *
 * Human review — genuinely semantic, so reported rather than asserted:
 *   · a Superseded record that names no newer governing decision. Inventing a successor would be
 *     fabrication; a pointer that repository history proves was asserted and later lost in
 *     reformatting is restored by a reviewer, never by the harness;
 *   · a one-sided assertion, where X says it was superseded by Y but Y never says so. This is
 *     normal in this register — D155 withdraws D113 clauses while describing the effect
 *     instead of claiming supersession — so it is a reviewer's judgement, not a defect.
 */

import { idToNumber } from '../ids.mjs';
import { analyzeRecord } from '../analyze.mjs';

export function checkSupersession({ records, byId, baseline, findings }) {
  const baselineById = new Map(baseline.records.map((entry) => [entry.id, entry]));
  const analyses = new Map(records.map((record) => [record.id, analyzeRecord(record)]));

  for (const record of records) {
    const analysis = analyses.get(record.id);
    const supersession = analysis.supersession;

    if (record.status === 'Superseded in part') {
      checkSupersededInPartCompleteness({ record, supersession, findings });
    }

    if (record.status === 'Superseded' && supersession.citedIds.length === 0) {
      findings.review(
        'superseded-without-successor',
        `${record.id} is Superseded but names no newer governing decision`,
        {
          note: 'The register never asserted a successor for this record. Do not invent one; a reviewer decides whether a pointer should be added by a future decision.',
          line: record.line,
        },
      );
    }

    checkInboundAssertions({ record, supersession, byId, findings });
    checkOutboundAssertions({ record, supersession, byId, analyses, findings });
    checkCounterpartPreservation({ record, supersession, baselineById, findings });
  }
}

function checkSupersededInPartCompleteness({ record, supersession, findings }) {
  const missing = [];
  if (supersession.citedIds.length === 0) missing.push('the withdrawing/amending decision');
  if (supersession.withdrawalEvidence.length === 0) missing.push('what was withdrawn');
  if (supersession.remainingOperativeEvidence.length === 0) missing.push('what remains operative');

  if (missing.length === 0) return;

  findings.fail(
    'superseded-in-part-incomplete',
    `${record.id} is Superseded in part but does not identify ${missing.join(' or ')}`,
    { line: record.line },
  );
}

function checkInboundAssertions({ record, supersession, byId, findings }) {
  for (const assertion of supersession.inbound) {
    for (const target of assertion.ids) {
      if (!byId.has(target)) {
        findings.fail(
          'supersession-counterpart-missing',
          `${record.id} says it was superseded by ${target}, which does not exist in the register`,
          { phrase: assertion.phrase, line: record.line },
        );
        continue;
      }
      if (idToNumber(target) < idToNumber(record.id)) {
        findings.review(
          'supersession-direction-unusual',
          `${record.id} says it was superseded by the earlier decision ${target}`,
          { phrase: assertion.phrase, line: record.line },
        );
      }
    }

    const inPart = /in\s+part/.test(assertion.phrase);
    const expected = inPart ? 'Superseded in part' : 'Superseded';
    if (record.status !== expected) {
      findings.fail(
        'supersession-status-contradiction',
        `${record.id} asserts "${assertion.phrase}" but its status is ${JSON.stringify(record.status)} rather than ${JSON.stringify(expected)}`,
        { line: record.line },
      );
    }
  }
}

function checkOutboundAssertions({ record, supersession, byId, analyses, findings }) {
  for (const assertion of supersession.outbound) {
    const inPart = /in\s+part/.test(assertion.phrase);

    for (const target of assertion.ids) {
      const targetRecord = byId.get(target);
      if (targetRecord === undefined) {
        findings.fail(
          'supersession-counterpart-missing',
          `${record.id} says it supersedes ${target}, which does not exist in the register`,
          { phrase: assertion.phrase, line: record.line },
        );
        continue;
      }

      if (inPart && targetRecord.status !== 'Superseded in part') {
        findings.fail(
          'supersession-status-contradiction',
          `${record.id} supersedes ${target} in part, but ${target} has status ${JSON.stringify(targetRecord.status)} rather than "Superseded in part"`,
          { line: targetRecord.line },
        );
        continue;
      }

      if (!inPart && !targetRecord.status.startsWith('Superseded')) {
        findings.fail(
          'supersession-status-contradiction',
          `${record.id} supersedes ${target}, but ${target} has status ${JSON.stringify(targetRecord.status)}`,
          { line: targetRecord.line },
        );
        continue;
      }

      const targetAnalysis = analyses.get(target);
      const acknowledges =
        targetAnalysis !== undefined &&
        (targetAnalysis.supersession.inbound.some((a) => a.ids.includes(record.id)) ||
          targetAnalysis.supersession.citedIds.includes(record.id));

      if (!acknowledges) {
        findings.review(
          'supersession-one-sided',
          `${record.id} says it supersedes ${target}, but ${target} does not mention ${record.id}`,
          {
            note: 'One-sided by history in several places. A reviewer decides whether the counterpart should acknowledge it; the harness never adds reciprocity that was never asserted.',
            line: targetRecord.line,
          },
        );
      }
    }
  }
}

/**
 * A counterpart identifier the baseline froze must still be cited. Losing a supersession
 * pointer during a representation batch destroys the amendment ledger D165 preserves, so for
 * superseded records this is a hard failure; elsewhere a dropped citation is a review item,
 * because D165 does authorize classified reference shifts in supporting prose.
 */
function checkCounterpartPreservation({ record, supersession, baselineById, findings }) {
  const entry = baselineById.get(record.id);
  if (entry === undefined) return;

  const frozen = entry.supersession?.citedIds ?? [];
  const dropped = frozen.filter((id) => !supersession.citedIds.includes(id));
  if (dropped.length === 0) return;

  if (record.status.startsWith('Superseded')) {
    findings.fail(
      'supersession-counterpart-dropped',
      `${record.id} (${record.status}) no longer cites ${dropped.join(', ')}`,
      { line: record.line },
    );
    return;
  }

  findings.review('citation-dropped', `${record.id} no longer cites ${dropped.join(', ')}`, {
    note: 'Confirm this was an authorized reference shift and name the destination that now owns the detail (D165).',
    line: record.line,
  });
}
