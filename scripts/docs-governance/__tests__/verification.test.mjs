/**
 * Each test mutates a fixture register and asserts the harness reaches the right verdict.
 * The real register is used only as a green smoke test, never as the sole fixture: a check
 * that cannot be shown to fail has not been shown to work.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { buildBaseline } from '../lib/baseline.mjs';
import { createFindings } from '../lib/report.mjs';
import { parseRegister } from '../lib/parse-register.mjs';
import { runVerification } from '../lib/verify.mjs';
import { scanTextForCitations } from '../lib/checks/citations.mjs';
import { splitTableRow } from '../lib/markdown-table.mjs';
import { BASELINE_PATH, REGISTER_PATH, REPO_ROOT } from '../paths.mjs';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const fixture = (name) => readFileSync(path.join(FIXTURES, name), 'utf8');

function freeze(source) {
  const { records } = parseRegister(source);
  return buildBaseline({
    records,
    source,
    sourcePath: 'fixtures/current-table.md',
    commit: 'fixture',
  });
}

/** Verifies `liveSource` against a baseline frozen from `baselineSource`. */
function verify(liveSource, baselineSource = fixture('current-table.md')) {
  const result = runVerification({
    source: liveSource,
    baseline: freeze(baselineSource),
    repoRoot: REPO_ROOT,
    scanCitations: false,
  });

  return {
    ...result,
    failureCodes: result.findings.failures.map((item) => item.code),
    reviewCodes: result.findings.reviews.map((item) => item.code),
    messages: result.findings.items.map((item) => item.message).join('\n'),
  };
}

const TABLE = fixture('current-table.md');

const rowIndexOf = (lines, id) => lines.findIndex((line) => line.startsWith(`| ${id} `));

/**
 * Rewrites cells of one table row. Structural rather than a raw string replacement, because
 * Prettier pads table cells to align the columns and exact-text edits would silently no-op.
 */
function setCells(source, id, patch) {
  const lines = source.split('\n');
  const index = rowIndexOf(lines, id);
  assert.notEqual(index, -1, `row ${id} not found`);

  const cells = splitTableRow(lines[index]);
  const next = [patch.decision ?? cells[1], patch.status ?? cells[2], patch.notes ?? cells[3]];
  lines[index] = `| ${id} | ${next.join(' | ')} |`;
  return lines.join('\n');
}

/**
 * Replaces text once, asserting it was actually there. Without the assertion a fixture edit
 * that no longer matches would leave the test passing while testing nothing.
 */
function mutate(source, from, to) {
  assert.ok(source.includes(from), `fixture does not contain ${JSON.stringify(from)}`);
  return source.replace(from, to);
}

function swapRows(source, first, second) {
  const lines = source.split('\n');
  const a = rowIndexOf(lines, first);
  const b = rowIndexOf(lines, second);
  assert.ok(a !== -1 && b !== -1, `rows ${first}/${second} not found`);
  [lines[a], lines[b]] = [lines[b], lines[a]];
  return lines.join('\n');
}

/** One heading record: its own heading line through to the next heading of any level. */
function headingBlock(lines, id) {
  const start = lines.findIndex((line) => line.startsWith(`### ${id} `));
  assert.notEqual(start, -1, `heading record ${id} not found`);
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith('#')) end += 1;
  return { start, end };
}

function swapHeadingRecords(source, first, second) {
  const lines = source.split('\n');
  const a = headingBlock(lines, first);
  const b = headingBlock(lines, second);
  assert.ok(a.end <= b.start, `${first} must appear before ${second}`);

  return [
    ...lines.slice(0, a.start),
    ...lines.slice(b.start, b.end),
    ...lines.slice(a.end, b.start),
    ...lines.slice(a.start, a.end),
    ...lines.slice(b.end),
  ].join('\n');
}

/** Moves a whole heading record so it sits immediately before the line starting with `anchor`. */
function moveHeadingRecord(source, id, anchor) {
  const lines = source.split('\n');
  const { start, end } = headingBlock(lines, id);
  const rest = [...lines.slice(0, start), ...lines.slice(end)];
  const at = rest.findIndex((line) => line.startsWith(anchor));
  assert.notEqual(at, -1, `anchor ${JSON.stringify(anchor)} not found`);

  return [...rest.slice(0, at), ...lines.slice(start, end), ...rest.slice(at)].join('\n');
}

function rowOf(source, id) {
  const lines = source.split('\n');
  const index = rowIndexOf(lines, id);
  assert.notEqual(index, -1, `row ${id} not found`);
  return lines[index];
}

const tableRow = (id) => rowOf(TABLE, id);

const convertedRecord = (id) => {
  const lines = fixture('future-headings.md').split('\n');
  const { start, end } = headingBlock(lines, id);
  return lines.slice(start, end).join('\n').trimEnd();
};

/**
 * Assembles a partly-converted register from verbatim fixture material, so a placement test
 * changes only where records sit and never a word of what they say.
 */
function partiallyConverted({ convertedFirst }) {
  const converted = [
    '## Converted decisions',
    '',
    convertedRecord('D005'),
    '',
    convertedRecord('D006'),
  ];
  const legacy = [
    '## Active decisions',
    '',
    ...TABLE.split('\n').slice(12, 14),
    tableRow('D001'),
    tableRow('D002'),
    tableRow('D003'),
  ];

  return [
    '# Decision register (fixture)',
    '',
    'Statuses: **Approved** · **Proposed** · **Deferred** · **Open** · **Superseded** · **Superseded in part**',
    '',
    ...(convertedFirst ? [...converted, '', ...legacy] : [...legacy, '', ...converted]),
    '',
    '## Superseded decisions',
    '',
    ...TABLE.split('\n').slice(26, 28),
    tableRow('D004'),
    '',
  ].join('\n');
}

test('the fixture register verifies green against its own frozen baseline', () => {
  const result = verify(TABLE);

  assert.deepEqual(result.failureCodes, []);
  assert.equal(result.classifications.identical, 6);
  assert.equal(result.classifications.changed, 0);
  assert.equal(result.highestAssignedId, 'D006');
});

test('a disappeared baseline identifier fails', () => {
  const live = TABLE.split('\n')
    .filter((line) => !line.startsWith('| D005 |'))
    .join('\n');

  const result = verify(live);
  assert.ok(result.failureCodes.includes('baseline-id-disappeared'));
  assert.ok(result.failureCodes.includes('identifier-gap'));
  assert.match(result.messages, /D005 is present in the frozen baseline/);
});

test('a duplicated identifier fails', () => {
  const duplicated = TABLE.split('\n').find((line) => line.startsWith('| D005 |'));
  const live = mutate(TABLE, duplicated, `${duplicated}\n${duplicated}`);

  const result = verify(live);
  assert.ok(result.failureCodes.includes('duplicate-id'));
  assert.match(result.messages, /D005 appears 2 times/);
});

test('a gap below the highest assigned identifier fails even when the baseline agrees', () => {
  const live = TABLE.split('\n')
    .filter((line) => !line.startsWith('| D005 |'))
    .join('\n');

  const result = verify(live, live);
  assert.ok(result.failureCodes.includes('identifier-gap'));
  assert.match(result.messages, /missing between D001 and the highest assigned identifier D006/);
});

test('records out of ascending order inside a section fail', () => {
  const lines = TABLE.split('\n');
  const first = lines.findIndex((line) => line.startsWith('| D001 |'));
  const second = lines.findIndex((line) => line.startsWith('| D002 |'));
  [lines[first], lines[second]] = [lines[second], lines[first]];

  const result = verify(lines.join('\n'));
  assert.ok(result.failureCodes.includes('not-ascending'));
});

/** Swaps the Active and Superseded legacy table blocks, leaving every row intact. */
function swapLegacyTableSections(source) {
  const activeHeading = '## Active decisions';
  const supersededHeading = '## Superseded decisions';
  assert.ok(source.includes(activeHeading));
  assert.ok(source.includes(supersededHeading));

  const [preamble, rest] = source.split(`\n${activeHeading}\n`);
  const [activeBody, supersededBody] = rest.split(`\n${supersededHeading}\n`);
  assert.ok(activeBody !== undefined && supersededBody !== undefined);

  return [
    preamble,
    supersededHeading,
    '',
    supersededBody.trimEnd(),
    '',
    activeHeading,
    '',
    activeBody.trim(),
    '',
  ].join('\n');
}

test('untouched current two-table representation keeps legacy section order green', () => {
  const result = verify(TABLE);

  assert.deepEqual(result.failureCodes, []);
  assert.equal(result.ordering.state, 'legacy');
  assert.equal(result.ordering.legacyRecords, 6);
});

test('moving the complete Superseded table above Active hard-fails', () => {
  const result = verify(swapLegacyTableSections(TABLE));

  assert.deepEqual(result.failureCodes, ['legacy-section-order-violation']);
  assert.match(result.messages, /legacy table section "superseded".*appears before "active"/);
});

test('partial conversion keeps remaining legacy sections in their original relative order', () => {
  const result = verify(fixture('mixed-transition.md'));

  assert.deepEqual(result.failureCodes, []);
  assert.equal(result.ordering.state, 'mixed');
  assert.ok(result.ordering.legacyRecords >= 2);
});

test('eliminating one legacy section does not require the empty section to remain', () => {
  const live = [
    '# Decision register (fixture)',
    '',
    'Statuses: **Approved** · **Proposed** · **Deferred** · **Open** · **Superseded** · **Superseded in part**',
    '',
    '## Active decisions',
    '',
    ...TABLE.split('\n').slice(12, 14),
    tableRow('D001'),
    tableRow('D002'),
    tableRow('D003'),
    tableRow('D005'),
    tableRow('D006'),
    '',
    '## Converted decisions',
    '',
    convertedRecord('D004'),
    '',
  ].join('\n');

  const result = verify(live);

  assert.deepEqual(result.failureCodes, []);
  assert.equal(result.ordering.state, 'mixed');
  assert.ok(
    !result.messages.includes('legacy-section-order-violation'),
    'an emptied legacy section must not be required merely to satisfy section order',
  );
});

test('a status outside the declared vocabulary fails', () => {
  const result = verify(setCells(TABLE, 'D006', { status: 'Postponed' }));

  assert.ok(result.failureCodes.includes('invalid-status'));
  assert.match(result.messages, /"Postponed" is outside the declared vocabulary/);
});

test('a changed status fails separately from an invalid one', () => {
  const result = verify(setCells(TABLE, 'D006', { status: 'Approved' }));

  assert.ok(result.failureCodes.includes('status-changed'));
  assert.ok(!result.failureCodes.includes('invalid-status'));
});

test('a missing required field fails', () => {
  const result = verify(setCells(TABLE, 'D006', { decision: '' }));

  assert.ok(result.failureCodes.includes('empty-required-field'));
});

test('rewritten operative Decision text fails', () => {
  const live = mutate(
    TABLE,
    'the fixture repository is separate.',
    'the fixture repository is completely separate.',
  );

  const result = verify(live);
  const failure = result.findings.failures.find((item) => item.code === 'operative-text-changed');
  assert.ok(failure !== undefined);
  assert.match(failure.detail.wordsAdded, /completely/);
  assert.equal(failure.detail.wordsRemoved, '(none)');
});

test('paraphrase fails, reporting both the removed and the added wording', () => {
  const live = mutate(
    TABLE,
    'Rocket must **not** share a deployment target with any other product.',
    'Rocket is prohibited from sharing deployment targets.',
  );

  const result = verify(live);
  const failure = result.findings.failures.find((item) => item.code === 'operative-text-changed');
  assert.ok(failure !== undefined);
  assert.match(failure.detail.wordsRemoved, /share/);
  assert.match(failure.detail.wordsAdded, /prohibited/);
});

test('an emphasis-only edit to operative text fails rather than passing quietly', () => {
  const live = mutate(TABLE, 'Rocket must **not** share', 'Rocket must not share');

  const result = verify(live);
  assert.ok(result.failureCodes.includes('operative-inline-syntax-changed'));
});

test('reordering words inside a clause fails, because reordering can invert meaning', () => {
  const live = mutate(
    TABLE,
    'AI may **recommend** but must **never** activate a schedule without explicit Owner authority.',
    'AI must **never** activate a schedule without explicit Owner authority but may **recommend**.',
  );

  const result = verify(live);
  assert.ok(result.failureCodes.includes('operative-clause-rearranged'));
});

test('a lost boundary clause fails', () => {
  const live = mutate(
    TABLE,
    ' Rocket must **not** share a deployment target with any other product.',
    '',
  );

  const result = verify(live);
  assert.ok(result.failureCodes.includes('boundary-clause-lost'));
  const failure = result.findings.failures.find((item) => item.code === 'boundary-clause-lost');
  assert.deepEqual(failure.detail.markers, ['must-not']);
});

test('a boundary clause demoted into inert history fails', () => {
  const live = setCells(TABLE, 'D001', {
    decision: '**Repository separation:** the fixture repository is separate.',
    notes:
      'Origin note preserved. This does **not** authorize any deployment change. **Inert history \u2014 not current law (withdrawn by D005).** Rocket must **not** share a deployment target with any other product.',
  });

  const result = verify(live);
  assert.ok(result.failureCodes.includes('boundary-demoted-to-inert-history'));
});

test('text preserved as inert history must not reappear as operative law', () => {
  const live = mutate(
    TABLE,
    '| D003 | **Partially withdrawn record:** the deterministic rules own the sends.',
    '| D003 | **Partially withdrawn record:** the preset intervals are 24h, 48h, and 72h counted from the delivery clock start. The deterministic rules own the sends.',
  );

  const result = verify(live);
  assert.ok(result.failureCodes.includes('withdrawn-clause-resurrected'));
});

test('an inert-history sentinel with the wrong dash fails', () => {
  const live = mutate(
    TABLE,
    'Inert history \u2014 not current law',
    'Inert history - not current law',
  );

  const result = verify(live);
  assert.ok(
    result.failureCodes.includes('inert-sentinel-near-miss') ||
      result.failureCodes.includes('inert-sentinel-not-exact'),
  );
});

test('the sentinel inside an operative Decision field fails unless it is quoted', () => {
  const unquoted = mutate(
    TABLE,
    '**Deferred capability:** push delivery is deferred',
    '**Deferred capability:** Inert history \u2014 not current law applies, and push delivery is deferred',
  );
  assert.ok(verify(unquoted).failureCodes.includes('inert-history-not-isolated'));

  const quoted = mutate(
    TABLE,
    '**Deferred capability:** push delivery is deferred',
    '**Deferred capability:** inert text sits under \u201cInert history \u2014 not current law\u201d, and push delivery is deferred',
  );
  assert.ok(!verify(quoted).failureCodes.includes('inert-history-not-isolated'));
});

test('a Superseded-in-part record that stops saying what remains operative fails', () => {
  const live = mutate(TABLE, ' **Still operative:** AI may recommend but never activate.', '');

  const result = verify(live);
  assert.ok(result.failureCodes.includes('superseded-in-part-incomplete'));
  assert.match(result.messages, /what remains operative/);
});

test('a supersession counterpart that does not exist fails', () => {
  const live = mutate(TABLE, '**Superseded in part by D005.**', '**Superseded in part by D009.**');

  const result = verify(live);
  assert.ok(result.failureCodes.includes('supersession-counterpart-missing'));
});

test('a superseding record pointing at a record with the wrong status fails', () => {
  const live = setCells(TABLE, 'D003', { status: 'Approved' });

  const result = verify(live);
  assert.ok(result.failureCodes.includes('supersession-status-contradiction'));
  assert.match(result.messages, /D005 supersedes D003 in part, but D003 has status "Approved"/);
});

test('a dropped supersession counterpart citation fails for a superseded record', () => {
  const live = mutate(TABLE, '**Superseded by D005.** Historical wording', 'Historical wording');

  const result = verify(live);
  assert.ok(result.failureCodes.includes('supersession-counterpart-dropped'));
});

test('a Superseded record that never named a successor is a review item, not a failure', () => {
  const live = setCells(TABLE, 'D004', {
    notes: 'Historical wording retained verbatim above.',
  });

  const result = verify(live, live);
  assert.deepEqual(result.failureCodes, []);
  assert.ok(result.reviewCodes.includes('superseded-without-successor'));
});

test('converting the whole register to heading records produces no hard failure', () => {
  const result = verify(fixture('future-headings.md'));

  assert.deepEqual(result.failureCodes, []);
  assert.deepEqual(result.representations, ['heading']);
  assert.equal(result.classifications.changed, 0);
  assert.equal(result.classifications.identical + result.classifications.relocated, 6);
});

test('relocating a bold lead-in into a heading title is reported, never silent', () => {
  const result = verify(fixture('future-headings.md'));
  const relocations = result.findings.reviews.filter((item) =>
    ['operative-relocated', 'operative-decoration-changed'].includes(item.code),
  );

  assert.ok(relocations.length > 0);
  assert.match(relocations[0].detail.note, /D165/);
});

test('a half-converted register verifies with no hard failure', () => {
  const result = verify(fixture('mixed-transition.md'));

  assert.deepEqual(result.failureCodes, []);
  assert.deepEqual(result.representations, ['heading', 'table-row']);
  assert.equal(result.ordering.state, 'mixed');
});

test('the live fully converted register verifies with no hard failure', () => {
  const result = runVerification({
    registerPath: REGISTER_PATH,
    baselinePath: BASELINE_PATH,
    repoRoot: REPO_ROOT,
    scanCitations: false,
  });

  assert.deepEqual(
    result.findings.failures.map((item) => item.code),
    [],
  );
  assert.deepEqual(result.representations, ['heading']);
  assert.equal(result.records.length, 174);
  assert.equal(result.ordering.state, 'converted');
});

test('absorbing a thematic break into the final converted record is a hard failure', () => {
  const closed = fixture('mixed-transition.md');
  const malformed = closed.replace(
    '## Active decisions not yet converted',
    '---\n\n## Active decisions not yet converted',
  );

  const result = verify(malformed, fixture('current-table.md'));

  assert.ok(result.failureCodes.includes('malformed-register'));
  assert.match(result.messages, /D003 would absorb a thematic break/);
  assert.equal(
    result.records.find((record) => record.id === 'D003').decision.startsWith('the deterministic'),
    true,
  );
});

test('a converted block correctly closed by a section heading verifies with no parse failure', () => {
  const result = verify(fixture('mixed-transition.md'), fixture('current-table.md'));

  assert.ok(!result.failureCodes.includes('malformed-register'));
  assert.deepEqual(result.failureCodes, []);
});

test('two converted records swapped during the transition fail', () => {
  const result = verify(swapHeadingRecords(fixture('mixed-transition.md'), 'D001', 'D002'));

  assert.deepEqual(result.failureCodes, ['not-ascending']);
  assert.match(result.messages, /D001 follows D002 in heading-records/);
});

test('two leftover legacy rows reordered during the transition fail', () => {
  const result = verify(swapRows(fixture('mixed-transition.md'), 'D005', 'D006'));

  assert.deepEqual(result.failureCodes, ['not-ascending']);
  assert.match(result.messages, /D005 follows D006 in table:active/);
});

/**
 * The case per-group ascending order alone let through: every group still ascends, but a
 * converted record sits below a higher identifier that is still a legacy row beside it.
 */
test('a converted record parked below a higher leftover row in its section fails', () => {
  const live = moveHeadingRecord(fixture('mixed-transition.md'), 'D003', '## Superseded decisions');
  const result = verify(live);

  assert.deepEqual(result.failureCodes, ['section-order-not-ascending']);
  assert.match(result.messages, /D003 \(heading\) follows D006 \(table-row\)/);
});

/**
 * The other case it let through: whole blocks reordered. Each live sequence ascends and no
 * record changed section, so only the frozen baseline shows that the converted block was
 * hoisted above records it was frozen behind.
 */
test('a converted block hoisted above the records it was frozen behind fails', () => {
  const result = verify(partiallyConverted({ convertedFirst: true }));

  assert.deepEqual(result.failureCodes, ['baseline-order-violation']);
  assert.match(result.messages, /D001 now appears after D006/);
});

test('the same partial conversion passes when the converted block keeps its frozen place', () => {
  const result = verify(partiallyConverted({ convertedFirst: false }));

  assert.deepEqual(result.failureCodes, []);
  assert.equal(result.ordering.state, 'mixed');
  assert.equal(result.classifications.changed, 0);
});

test('an unconverted row moved between structural sections fails', () => {
  const source = fixture('mixed-transition.md');
  const moved = source
    .split('\n')
    .filter((line) => !line.startsWith('| D004 '))
    .join('\n');
  const live = mutate(
    moved,
    rowOf(source, 'D005'),
    `${rowOf(source, 'D004')}\n${rowOf(source, 'D005')}`,
  );

  const result = verify(live);
  assert.deepEqual(result.failureCodes, ['legacy-record-section-changed']);
  assert.match(result.messages, /D004 is still a legacy table row but moved from frozen section/);
});

test('a fully converted register that is not globally ascending fails', () => {
  const result = verify(swapHeadingRecords(fixture('future-headings.md'), 'D003', 'D004'));

  assert.ok(result.failureCodes.includes('not-ascending-document'));
  assert.match(result.messages, /the fully-converted register must be ascending end to end/);
});

test('the fully converted register is held to global order with no transition exception', () => {
  const result = verify(fixture('future-headings.md'));

  assert.equal(result.ordering.state, 'converted');
  assert.equal(result.ordering.legacyRecords, 0);
});

test('a semantic edit made during conversion is still caught', () => {
  const live = mutate(
    fixture('future-headings.md'),
    'must **never** activate a schedule without explicit Owner authority',
    'should avoid activating a schedule without Owner authority',
  );

  const result = verify(live);
  assert.ok(result.failureCodes.includes('operative-text-changed'));
});

test('a hand-edited baseline is detected instead of trusted', () => {
  const baseline = freeze(TABLE);
  baseline.records[0].decision = `${baseline.records[0].decision} quietly appended`;

  const result = runVerification({
    source: TABLE,
    baseline,
    repoRoot: REPO_ROOT,
    scanCitations: false,
  });

  assert.ok(
    result.findings.failures.some((item) => item.code === 'baseline-self-inconsistent'),
    'a digest that disagrees with the frozen text must be reported',
  );
});

test('an unresolved bare citation fails', () => {
  const { byId } = { byId: new Map([['D001', {}]]) };
  const findings = createFindings();

  scanTextForCitations({
    relativePath: 'docs/EXAMPLE.md',
    text: 'follow D001 and also D999\n',
    byId,
    findings,
  });

  const codes = findings.failures.map((item) => item.code);
  assert.deepEqual(codes, ['unresolved-citation']);
  assert.match(findings.failures[0].message, /docs\/EXAMPLE\.md:1 cites D999/);
});

test('range citations fail on a missing endpoint, an interior gap, or a bad direction', () => {
  const byId = new Map([
    ['D001', {}],
    ['D002', {}],
    ['D004', {}],
  ]);

  const cases = [
    ['see D001–D009', 'range-citation-endpoint-missing'],
    ['see D001–D004', 'range-citation-gap'],
    ['see D004–D001', 'range-citation-not-ascending'],
  ];

  for (const [text, expected] of cases) {
    const findings = createFindings();
    scanTextForCitations({ relativePath: 'docs/EXAMPLE.md', text, byId, findings });
    assert.deepEqual(
      findings.failures.map((item) => item.code),
      [expected],
      text,
    );
  }
});

test('a fully resolvable range passes and reports nothing', () => {
  const byId = new Map([
    ['D001', {}],
    ['D002', {}],
    ['D003', {}],
  ]);
  const findings = createFindings();

  scanTextForCitations({ relativePath: 'docs/EXAMPLE.md', text: 'see D001–D003', byId, findings });
  assert.deepEqual(findings.failures, []);
});

test('a named-clause citation is reported for review, and a plain one is not', () => {
  const byId = new Map([
    ['D081', {}],
    ['D106', {}],
    ['D142', {}],
  ]);
  const findings = createFindings();
  const named = new Map();

  scanTextForCitations({
    relativePath: 'docs/EXAMPLE.md',
    text: 'the D081 idempotency intent and the D106 ceiling hold, and D142 is unchanged.',
    byId,
    findings,
    named,
  });

  assert.deepEqual(findings.failures, []);
  assert.deepEqual(
    [...named.values()].map((entry) => `${entry.id} ${entry.qualifier}`),
    ['D081 idempotency intent', 'D106 ceiling hold'],
  );
});

test('the live register verifies green against the committed frozen baseline', () => {
  const result = runVerification({
    registerPath: REGISTER_PATH,
    baselinePath: BASELINE_PATH,
    repoRoot: REPO_ROOT,
    scanCitations: false,
  });

  assert.deepEqual(
    result.findings.failures.map((item) => `${item.code}: ${item.message}`),
    [],
  );
  assert.equal(result.classifications.identical, 165);
  assert.equal(result.highestAssignedId, 'D174');
});
