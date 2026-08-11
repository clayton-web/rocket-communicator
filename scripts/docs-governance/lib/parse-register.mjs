/**
 * Representation layer for DECISIONS.md.
 *
 * Two representations are understood, and both may appear in the same file at the same
 * time. That matters because the D165 rewrite runs in batches of about 20 IDs: between
 * batch one and the final batch the register is legitimately half wide-table and half
 * heading-per-decision, and the harness has to stay meaningful throughout rather than
 * demanding a single flag-day conversion.
 *
 * Every parsed record is reduced to the same representation-agnostic shape, so the
 * verification model and the frozen baseline never need to know which syntax produced it:
 *
 *   operativeSurfaces  — fields that carry current binding decision law.
 *   supportingSurfaces — supersession/amendment history, rationale, notes.
 *   inertHistory       — text explicitly marked non-operative by the D165 sentinel.
 */

import { isDelimiterRow, isTableRow, splitTableRow } from './markdown-table.mjs';
import { INERT_HISTORY_SENTINEL } from './clauses.mjs';
import { extractIdTokens } from './ids.mjs';
import { wordsOnlyNormalize } from './normalize.mjs';

const HEADING = /^(#{1,6})\s+(.*)$/;
const RECORD_HEADING = /^(#{2,6})\s+(D\d{3})\b\s*(?:[\u2014\u2013:-]\s*)?(.*)$/;
const LABELLED_BLOCK = /^\*\*\s*([^*]+?)\s*\*\*:?\s*([\s\S]*)$/;

const FIELD_ALIASES = new Map([
  ['status', 'status'],
  ['decision', 'decision'],
  ['boundaries', 'boundaries'],
  ['boundary', 'boundaries'],
  ['non-authorization', 'boundaries'],
  ['non-authorisation', 'boundaries'],
  ['current law', 'currentLaw'],
  ['supersession', 'supersession'],
  ['amendment', 'supersession'],
  ['supersession/amendment', 'supersession'],
  ['supersession / amendment', 'supersession'],
  ['supersession and amendment', 'supersession'],
  ['rationale', 'rationale'],
  ['notes', 'notes'],
]);

const OPERATIVE_FIELDS = ['title', 'decision', 'boundaries', 'currentLaw'];
const SUPPORTING_FIELDS = ['supersession', 'rationale', 'notes'];

function sectionKey(title) {
  const lower = title.toLowerCase();
  if (lower.includes('superseded')) return 'superseded';
  if (lower.includes('active')) return 'active';
  return lower.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unsectioned';
}

/**
 * Document-level order of the wide-table sections in the pre-D165 representation.
 *
 * This is the physical layout the parser already understands (`sectionKey` maps the Active
 * and Superseded table headings onto these keys). It is a representation contract for the
 * grandfathered two-table shape — not a status rule and not derived from decision content.
 * Ordering checks consult it only while more than one of these sections still has leftover
 * table rows; once a section is emptied by conversion the constraint drops that section, and
 * once no legacy table row remains the contract is void.
 */
export const LEGACY_TABLE_SECTION_ORDER = ['active', 'superseded'];

/**
 * Splits a Notes cell at the inert-history sentinel. In the current representation inert
 * history is not a separate field; it lives inside Notes behind the sentinel, so the
 * sentinel is the only reliable divider between supporting commentary and inert text.
 */
function splitInertHistory(text) {
  const index = text.indexOf(INERT_HISTORY_SENTINEL);
  if (index === -1) return { supporting: text, inert: null };

  // Include the bold/label punctuation that opens the sentinel, so the isolation check can
  // inspect the label itself (`**Inert history — not current law (withdrawn by D102–D107)**`).
  let start = index;
  while (start > 0 && (text[start - 1] === '*' || text[start - 1] === '_')) start -= 1;

  return { supporting: text.slice(0, start).trim(), inert: text.slice(start).trim() };
}

/**
 * Reduces raw per-field text to the representation-agnostic record shape. Exported so the
 * frozen baseline can be rehydrated through exactly the same path as a live parse.
 */
export function composeRecord({
  id,
  representation,
  section,
  sectionTitle,
  line,
  fields,
  presentFields,
}) {
  const { supporting, inert } =
    fields.inertHistory === undefined
      ? splitInertHistory(fields.notes ?? '')
      : { supporting: fields.notes ?? '', inert: fields.inertHistory };

  const resolved = { ...fields, notes: supporting };

  // A heading title may either carry the operative lead-in that the table row kept inside the
  // Decision cell, or merely repeat it as a label. When it repeats, counting it as operative
  // text would read as duplicated wording, so a title that the Decision body already opens
  // with is treated as a label only.
  const titleRepeatsDecision =
    representation === 'heading' &&
    (resolved.title ?? '').trim() !== '' &&
    wordsOnlyNormalize(resolved.decision ?? '').startsWith(wordsOnlyNormalize(resolved.title));

  const operativeSurfaces = OPERATIVE_FIELDS.filter(
    (name) => (resolved[name] ?? '').trim() !== '' && !(name === 'title' && titleRepeatsDecision),
  ).map((name) => ({ name, text: resolved[name].trim() }));

  const supportingSurfaces = SUPPORTING_FIELDS.filter(
    (name) => (resolved[name] ?? '').trim() !== '',
  ).map((name) => ({ name, text: resolved[name].trim() }));

  return {
    id,
    representation,
    section,
    sectionTitle,
    line,
    status: (resolved.status ?? '').trim(),
    title: (resolved.title ?? '').trim(),
    decision: (resolved.decision ?? '').trim(),
    notes: supporting,
    fields: resolved,
    presentFields,
    operativeSurfaces,
    supportingSurfaces,
    inertHistory:
      inert === null || inert === undefined || inert.trim() === '' ? null : inert.trim(),
  };
}

function parseTableSection(lines, startIndex, section, sectionTitle, records, problems) {
  const header = splitTableRow(lines[startIndex]);
  const lower = header.map((cell) => cell.toLowerCase());

  const columns = {
    id: lower.indexOf('id'),
    decision: lower.findIndex((cell) => cell.startsWith('decision')),
    status: lower.indexOf('status'),
    notes: lower.findIndex((cell) => cell.startsWith('note')),
  };

  if (columns.id === -1 || columns.decision === -1 || columns.status === -1) {
    problems.push({
      line: startIndex + 1,
      message: `table in section "${sectionTitle}" lacks the ID/Decision/Status columns`,
    });
    return startIndex + 1;
  }

  let index = startIndex + 2; // skip header and delimiter rows
  while (index < lines.length && isTableRow(lines[index])) {
    const cells = splitTableRow(lines[index]);
    const id = cells[columns.id] ?? '';

    if (!/^D\d{3}$/.test(id)) {
      problems.push({
        line: index + 1,
        message: `table row in section "${sectionTitle}" has no valid Dxxx identifier (found ${JSON.stringify(id.slice(0, 40))})`,
      });
      index += 1;
      continue;
    }

    const presentFields = ['id', 'decision', 'status'];
    if (columns.notes !== -1) presentFields.push('notes');

    records.push(
      composeRecord({
        id,
        representation: 'table-row',
        section,
        sectionTitle,
        line: index + 1,
        fields: {
          status: cells[columns.status] ?? '',
          decision: cells[columns.decision] ?? '',
          notes: columns.notes === -1 ? '' : (cells[columns.notes] ?? ''),
        },
        presentFields,
      }),
    );
    index += 1;
  }

  return index;
}

/**
 * Reads one heading record body. Two field syntaxes are accepted, because D165 fixes the
 * schema but not the markup: bold labelled paragraphs (`**Status:** Approved`) and nested
 * sub-headings (`#### Status`). Batch one settles which one the register actually uses;
 * until then the harness reads either rather than guessing wrong.
 */
function parseHeadingBody(bodyLines, headingLevel) {
  const fields = {};
  const presentFields = [];
  let currentField = null;

  const assign = (name, value) => {
    if (!presentFields.includes(name)) presentFields.push(name);
    fields[name] = fields[name] === undefined ? value : `${fields[name]}\n\n${value}`.trim();
  };

  const blocks = [];
  let pending = [];
  for (const line of bodyLines) {
    const heading = HEADING.exec(line);
    if (heading && heading[1].length > headingLevel) {
      if (pending.length > 0) blocks.push({ kind: 'text', lines: pending });
      pending = [];
      blocks.push({ kind: 'heading', label: heading[2].trim() });
      continue;
    }
    if (line.trim() === '') {
      if (pending.length > 0) blocks.push({ kind: 'text', lines: pending });
      pending = [];
      continue;
    }
    pending.push(line);
  }
  if (pending.length > 0) blocks.push({ kind: 'text', lines: pending });

  const labelToField = (label) => {
    if (label.includes(INERT_HISTORY_SENTINEL) || /^inert history/i.test(label)) {
      return { field: 'inertHistory', label };
    }
    const key = label.toLowerCase().replace(/:$/, '').trim();
    return { field: FIELD_ALIASES.get(key) ?? null, label };
  };

  for (const block of blocks) {
    if (block.kind === 'heading') {
      const { field } = labelToField(block.label);
      currentField = field ?? null;
      if (field !== null && !presentFields.includes(field)) presentFields.push(field);
      // The sentinel lives in the label itself, so inert history keeps its label as content.
      if (field === 'inertHistory') assign(field, block.label);
      continue;
    }

    const text = block.lines.join('\n').trim();
    const labelled = LABELLED_BLOCK.exec(text);
    if (labelled !== null) {
      const { field } = labelToField(labelled[1]);
      if (field !== null) {
        currentField = field;
        assign(field, field === 'inertHistory' ? text : labelled[2].trim());
        continue;
      }
    }

    if (currentField !== null) {
      assign(currentField, text);
      continue;
    }

    // An unlabelled block before any recognized field is the Decision body.
    assign('decision', text);
  }

  return { fields, presentFields };
}

function parseHeadingRecord(lines, startIndex, section, sectionTitle, records) {
  const match = RECORD_HEADING.exec(lines[startIndex]);
  const level = match[1].length;
  const id = match[2];
  const title = match[3].trim();

  let end = startIndex + 1;
  while (end < lines.length) {
    const heading = HEADING.exec(lines[end]);
    if (heading !== null && heading[1].length <= level) break;
    end += 1;
  }

  const { fields, presentFields } = parseHeadingBody(lines.slice(startIndex + 1, end), level);
  fields.title = title;
  if (title !== '') presentFields.unshift('title');
  presentFields.unshift('id');

  records.push(
    composeRecord({
      id,
      representation: 'heading',
      section,
      sectionTitle,
      line: startIndex + 1,
      fields,
      presentFields,
    }),
  );

  return end;
}

/**
 * Parses a register document into records plus the representations observed.
 *
 * `problems` collects malformed structure that is not attributable to a single record;
 * callers surface it as a hard failure.
 */
export function parseRegister(source) {
  const lines = source.split('\n');
  const records = [];
  const problems = [];
  const representations = new Set();

  let sectionTitle = '';
  let section = 'unsectioned';
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (RECORD_HEADING.test(line)) {
      representations.add('heading');
      index = parseHeadingRecord(lines, index, section, sectionTitle, records);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      sectionTitle = heading[2].trim();
      section = sectionKey(sectionTitle);
      index += 1;
      continue;
    }

    if (isTableRow(line) && index + 1 < lines.length && isDelimiterRow(lines[index + 1])) {
      representations.add('table-row');
      index = parseTableSection(lines, index, section, sectionTitle, records, problems);
      continue;
    }

    index += 1;
  }

  return { records, problems, representations: [...representations].sort() };
}

/** Withdrawing IDs named inside an inert-history label, e.g. `(withdrawn by D102–D107)`. */
export function inertHistoryWithdrawnBy(inertText) {
  const label = inertText.slice(0, inertText.indexOf(INERT_HISTORY_SENTINEL) + 200);
  return extractIdTokens(label);
}
