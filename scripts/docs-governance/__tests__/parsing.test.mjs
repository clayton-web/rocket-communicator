import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { isDelimiterRow, splitTableRow } from '../lib/markdown-table.mjs';
import { extractCitations, expandRange } from '../lib/ids.mjs';
import {
  proseNormalize,
  segmentText,
  strictNormalize,
  wordsOnlyNormalize,
} from '../lib/normalize.mjs';
import { parseRegister } from '../lib/parse-register.mjs';
import { REGISTER_PATH } from '../paths.mjs';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const fixture = (name) => readFileSync(path.join(FIXTURES, name), 'utf8');

test('escaped pipes do not split a table cell', () => {
  const row = '| D155 | text with `kept \\| assigned` inside | Approved | note |';
  const cells = splitTableRow(row);

  assert.equal(cells.length, 4);
  assert.equal(cells[0], 'D155');
  assert.equal(cells[1], 'text with `kept \\| assigned` inside');
  assert.equal(cells[2], 'Approved');
  assert.equal(cells[3], 'note');
});

test('a naive split would corrupt the same row, which is why the scanner exists', () => {
  const row = '| D155 | text with `kept \\| assigned` inside | Approved | note |';
  assert.notEqual(row.split('|').length - 2, 4);
});

test('an escaped backslash before a pipe still ends the cell', () => {
  const cells = splitTableRow('| D001 | ends with a backslash \\\\ | Approved | note |');
  assert.equal(cells.length, 4);
  assert.equal(cells[1], 'ends with a backslash \\\\');
});

test('delimiter rows are recognized and alignment colons allowed', () => {
  assert.ok(isDelimiterRow('| ---- | ---- | --- | --- |'));
  assert.ok(isDelimiterRow('| :--- | ---: | :-: | --- |'));
  assert.ok(!isDelimiterRow('| D001 | text | Approved | note |'));
});

test('the escaped pipe survives parsing and normalizes to a literal pipe', () => {
  const { records } = parseRegister(fixture('current-table.md'));
  const record = records.find((candidate) => candidate.id === 'D002');

  assert.ok(record.decision.includes('kept \\| assigned'), 'raw text keeps the escape');
  assert.ok(
    strictNormalize(record.decision).includes('kept | assigned'),
    'normalization unescapes the table-only pipe escape',
  );
});

test('strict normalization removes only representation noise', () => {
  assert.equal(strictNormalize('  a   b \n c  '), 'a b c');
  assert.equal(strictNormalize('kept \\| assigned'), 'kept | assigned');
  assert.equal(strictNormalize('**bold** and `code`'), '**bold** and `code`');
  assert.equal(strictNormalize('an escaped \\* star'), 'an escaped \\* star');
});

test('prose normalization strips inline syntax but never underscores in identifiers', () => {
  assert.equal(
    proseNormalize('**must not** use `NEXT_PUBLIC_APP_URL`'),
    'must not use NEXT_PUBLIC_APP_URL',
  );
  assert.equal(
    proseNormalize('see [DATA_RETENTION.md](DATA_RETENTION.md)'),
    'see DATA_RETENTION.md',
  );
  assert.equal(proseNormalize('`task_suggestion_revisions`'), 'task_suggestion_revisions');
});

test('words-only normalization keeps every word and drops decoration', () => {
  assert.equal(
    wordsOnlyNormalize('**Reminder stop (A8.1):** the Owner may stop.'),
    'Reminder stop A81 the Owner may stop',
  );
});

test('segments tile their input exactly, so nothing can hide between them', () => {
  const source = strictNormalize(readFileSync(REGISTER_PATH, 'utf8'));
  const { records } = parseRegister(readFileSync(REGISTER_PATH, 'utf8'));

  assert.ok(source.length > 0);
  for (const record of records) {
    const text = strictNormalize(record.decision);
    const segments = segmentText(text);
    assert.equal(segments.map((segment) => segment.text).join(''), text, `${record.id} round-trip`);
  }
});

test('abbreviations and version numbers are not clause boundaries', () => {
  const segments = segmentText(
    'The A8.1 slice applies, e.g. the reminder path. A second clause follows here.',
  );
  assert.equal(segments.length, 2);
  assert.ok(segments[0].text.includes('e.g. the reminder path.'));
});

test('range citations claim their endpoints so they are not counted twice', () => {
  const { ranges, bare } = extractCitations('follow D102–D110 and also D142');

  assert.equal(ranges.length, 1);
  assert.deepEqual([ranges[0].startId, ranges[0].endId], ['D102', 'D110']);
  assert.deepEqual(
    bare.map((citation) => citation.id),
    ['D142'],
  );
});

test('a slash-separated pair is two citations, not a range', () => {
  const { ranges, bare } = extractCitations('operative model is D095/D099');
  assert.equal(ranges.length, 0);
  assert.deepEqual(
    bare.map((citation) => citation.id),
    ['D095', 'D099'],
  );
});

test('en dash, em dash and hyphen all form ranges', () => {
  for (const separator of ['\u2013', '\u2014', '-']) {
    const { ranges } = extractCitations(`see D102${separator}D106`);
    assert.equal(ranges.length, 1, `separator ${separator.codePointAt(0).toString(16)}`);
  }
  assert.deepEqual(expandRange('D102', 'D105'), ['D102', 'D103', 'D104', 'D105']);
});

test('the current wide-table representation parses into records', () => {
  const { records, problems, representations } = parseRegister(fixture('current-table.md'));

  assert.deepEqual(problems, []);
  assert.deepEqual(representations, ['table-row']);
  // Document order, not numeric order: the superseded section trails the active one, which is
  // why ordering is checked per section while the table representation survives.
  assert.deepEqual(
    records.map((record) => record.id),
    ['D001', 'D002', 'D003', 'D005', 'D006', 'D004'],
  );
  assert.equal(records.find((record) => record.id === 'D004').section, 'superseded');
  assert.equal(records.find((record) => record.id === 'D006').notes, '');
});

test('the future heading representation parses with bold labelled fields', () => {
  const { records, problems, representations } = parseRegister(fixture('future-headings.md'));

  assert.deepEqual(problems, []);
  assert.deepEqual(representations, ['heading']);
  assert.equal(records.length, 6);

  const record = records.find((candidate) => candidate.id === 'D001');
  assert.equal(record.title, 'Repository separation');
  assert.equal(record.status, 'Approved');
  assert.ok(record.decision.startsWith('the fixture repository is separate'));
  assert.deepEqual(
    record.operativeSurfaces.map((surface) => surface.name),
    ['title', 'decision'],
  );
});

test('the future heading representation also parses with nested sub-heading fields', () => {
  const { records, problems } = parseRegister(fixture('future-subheadings.md'));

  assert.deepEqual(problems, []);
  assert.equal(records.length, 2);
  assert.equal(records[0].status, 'Approved');
  assert.ok(records[0].decision.startsWith('the fixture repository is separate'));
});

test('inert history in a heading record keeps its sentinel label as content', () => {
  const { records } = parseRegister(fixture('future-headings.md'));
  const record = records.find((candidate) => candidate.id === 'D003');

  assert.ok(record.inertHistory.includes('Inert history \u2014 not current law'));
  assert.ok(record.inertHistory.includes('Formerly read'));
  assert.ok(!record.decision.includes('Formerly read'), 'inert text stays out of the Decision');
});

test('a heading title that merely repeats the Decision lead-in is not counted twice', () => {
  const { records } = parseRegister(fixture('future-headings.md'));
  const record = records.find((candidate) => candidate.id === 'D004');

  assert.equal(record.title, 'Interval reminders are counted from the delivery clock start');
  assert.deepEqual(
    record.operativeSurfaces.map((surface) => surface.name),
    ['decision'],
  );
});

test('both representations can coexist in one file during the transition', () => {
  const { records, problems, representations } = parseRegister(fixture('mixed-transition.md'));

  assert.deepEqual(problems, []);
  assert.deepEqual(representations, ['heading', 'table-row']);
  assert.equal(records.length, 6);
  assert.equal(records.find((record) => record.id === 'D001').representation, 'heading');
  assert.equal(records.find((record) => record.id === 'D005').representation, 'table-row');
});

test('the real register parses in its fully converted representation with no problems', () => {
  const { records, problems, representations } = parseRegister(readFileSync(REGISTER_PATH, 'utf8'));

  assert.deepEqual(problems, []);
  assert.deepEqual(representations, ['heading']);
  assert.equal(records.length, 179);
  assert.equal(new Set(records.map((record) => record.id)).size, 179);
});

/**
 * Minimal converted block closed by a section-level heading before leftover legacy rows.
 * Headings are the only terminator; the `##` closer is what keeps exterior structure out.
 */
const CORRECTLY_TERMINATED_BLOCK = `# Decision register

## Decision records

### D001 — One

**Status:** Approved

**Decision:** alpha

**Notes:** note one

### D002 — Two

**Status:** Approved

**Decision:** beta

## Leftover legacy

| ID | Decision | Status | Notes |
| ---- | ---- | ---- | ---- |
| D003 | gamma | Approved | note three |
`;

test('a converted block closed by a section-level heading parses cleanly', () => {
  const { records, problems, representations } = parseRegister(CORRECTLY_TERMINATED_BLOCK);

  assert.deepEqual(problems, []);
  assert.deepEqual(representations, ['heading', 'table-row']);
  assert.deepEqual(
    records.map((record) => [record.id, record.representation]),
    [
      ['D001', 'heading'],
      ['D002', 'heading'],
      ['D003', 'table-row'],
    ],
  );
  assert.equal(records.find((record) => record.id === 'D002').notes, '');
  assert.equal(records.find((record) => record.id === 'D002').decision, 'beta');
});

test('a thematic break before the section closer is not absorbed into the final heading record', () => {
  const malformed = CORRECTLY_TERMINATED_BLOCK.replace(
    '## Leftover legacy',
    '---\n\n## Leftover legacy',
  );
  const { records, problems } = parseRegister(malformed);
  const lastHeading = records.find((record) => record.id === 'D002');

  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /D002 would absorb a thematic break/);
  assert.match(problems[0].message, /section-level heading/);
  assert.equal(lastHeading.decision, 'beta');
  assert.equal(lastHeading.notes, '');
  assert.equal(records.find((record) => record.id === 'D003')?.representation, 'table-row');
});

test('a legacy table without a section closer is not absorbed into the final heading record', () => {
  const malformed = CORRECTLY_TERMINATED_BLOCK.replace('\n## Leftover legacy\n\n', '\n');
  const { records, problems } = parseRegister(malformed);
  const lastHeading = records.find((record) => record.id === 'D002');

  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /D002 would absorb a markdown table/);
  assert.equal(lastHeading.decision, 'beta');
  assert.equal(lastHeading.notes, '');
  assert.equal(records.find((record) => record.id === 'D003')?.representation, 'table-row');
});

test('a fully converted heading register still parses with no problems', () => {
  const { records, problems, representations } = parseRegister(fixture('future-headings.md'));

  assert.deepEqual(problems, []);
  assert.deepEqual(representations, ['heading']);
  assert.equal(records.length, 6);
});
