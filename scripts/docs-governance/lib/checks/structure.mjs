/**
 * Structural invariants: identity, completeness, required fields, status vocabulary.
 *
 * The highest assigned identifier is always read from the live register. Nothing here
 * hard-codes D165 as the end of the register, so the harness keeps working as the register
 * grows past the baseline.
 *
 * Ordering is verified separately in `ordering.mjs`, because it is the one invariant whose
 * strictness depends on how far D165's representation change has progressed.
 */

import { STATUS_VOCABULARY } from '../clauses.mjs';
import { formatId, idToNumber } from '../ids.mjs';
import { baselineIdRange } from '../baseline.mjs';

const REQUIRED_FIELDS = {
  'table-row': ['id', 'decision', 'status', 'notes'],
  heading: ['id', 'title', 'status', 'decision'],
};

const NON_EMPTY_FIELDS = {
  'table-row': ['decision', 'status'],
  heading: ['title', 'status', 'decision'],
};

export function checkStructure({ records, baseline, findings }) {
  const byId = new Map();
  const duplicates = new Map();

  for (const record of records) {
    if (byId.has(record.id)) {
      if (!duplicates.has(record.id)) duplicates.set(record.id, [byId.get(record.id)]);
      duplicates.get(record.id).push(record);
      continue;
    }
    byId.set(record.id, record);
  }

  for (const [id, occurrences] of duplicates) {
    findings.fail('duplicate-id', `${id} appears ${occurrences.length} times in the register`, {
      lines: occurrences.map((record) => record.line).join(', '),
    });
  }

  const liveNumbers = [...byId.keys()].map(idToNumber);
  const highest = liveNumbers.length === 0 ? 0 : Math.max(...liveNumbers);
  const lowest = liveNumbers.length === 0 ? 0 : Math.min(...liveNumbers);

  if (lowest > 1 && liveNumbers.length > 0) {
    findings.fail(
      'register-does-not-start-at-d001',
      `lowest live identifier is ${formatId(lowest)}; the register must run from D001`,
    );
  }

  const gaps = [];
  for (let n = 1; n <= highest; n += 1) {
    if (!byId.has(formatId(n))) gaps.push(formatId(n));
  }
  if (gaps.length > 0) {
    findings.fail(
      'identifier-gap',
      `${gaps.length} identifier(s) missing between D001 and the highest assigned identifier ${formatId(highest)}`,
      { missing: gaps },
    );
  }

  const { ids: baselineIds } = baselineIdRange(baseline);
  const disappeared = baselineIds.filter((id) => !byId.has(id));
  for (const id of disappeared) {
    findings.fail(
      'baseline-id-disappeared',
      `${id} is present in the frozen baseline but absent from the live register`,
    );
  }

  const newIds = [...byId.keys()].filter((id) => !baselineIds.includes(id));
  if (newIds.length > 0) {
    findings.info(
      `${newIds.length} identifier(s) exist live but not in the frozen baseline (assigned after the checkpoint)`,
      { ids: newIds.sort() },
    );
  }

  for (const record of byId.values()) {
    const representation = record.representation;
    const required = REQUIRED_FIELDS[representation] ?? [];
    const missing = required.filter((field) => !record.presentFields.includes(field));
    if (missing.length > 0) {
      findings.fail(
        'missing-required-field',
        `${record.id} (${representation}) is missing required field(s): ${missing.join(', ')}`,
        { line: record.line },
      );
    }

    const empty = (NON_EMPTY_FIELDS[representation] ?? []).filter(
      (field) => (record.fields[field] ?? '').trim() === '',
    );
    if (empty.length > 0) {
      findings.fail(
        'empty-required-field',
        `${record.id} (${representation}) has empty required field(s): ${empty.join(', ')}`,
        { line: record.line },
      );
    }

    if (!STATUS_VOCABULARY.includes(record.status)) {
      findings.fail(
        'invalid-status',
        `${record.id} status ${JSON.stringify(record.status)} is outside the declared vocabulary`,
        { allowed: STATUS_VOCABULARY, line: record.line },
      );
    }
  }

  return {
    byId,
    highest: highest === 0 ? null : formatId(highest),
    baselineIds,
    newIds,
  };
}
