/**
 * Transition ordering.
 *
 * D165's final representation is **one globally ascending Dxxx sequence regardless of
 * status**. The register cannot be in that shape yet, so ordering is verified against the
 * state the document is actually in, and the accommodation shrinks by itself as the rewrite
 * proceeds:
 *
 *   legacy     every record is still a wide-table row. The physical split into an Active
 *              table and a Superseded table predates D165 and is grandfathered as
 *              *representation evidence only* — it is the shape the baseline was frozen
 *              from, not a rule the register is entitled to keep. Global ascending order is
 *              impossible in it, because the Superseded table sits last while holding
 *              identifiers lower than the ones above it.
 *   mixed      heading records and leftover legacy tables coexist. This is a controlled
 *              migration accommodation with its own protections (below), not a licence to
 *              move records around while the file is half-converted.
 *   converted  no legacy table row remains. The accommodation is void automatically at that
 *              moment and strict end-to-end ascending order is mandatory.
 *
 * The mixed-state protections are deliberately *baseline-relative* rather than semantic. The
 * harness never reasons about what Active or Superseded ought to mean; it compares placement
 * against the frozen baseline, which already records the structural section each record was
 * captured in, and against the legacy representation contract for the two-table layout:
 *
 *   1. while more than one legacy table section still has rows, those sections keep the
 *      document-level relative order fixed by `LEGACY_TABLE_SECTION_ORDER` — Active table
 *      before Superseded table — so the grandfathered structure cannot be rearranged under
 *      cover of the transition (`legacy-section-order-violation`);
 *   2. a record that is still a legacy table row must still be in its frozen section, so a
 *      row cannot be moved between the Active and Superseded tables under cover of a
 *      representation batch (`legacy-record-section-changed`);
 *   3. every ordering group — each legacy section, and the converted heading records as one
 *      sequence — stays ascending (`not-ascending`);
 *   4. one structural section is ascending across *both* representations, so a converted
 *      record cannot be parked below a leftover row of a higher identifier inside the same
 *      section (`section-order-not-ascending`);
 *   5. records that share a frozen section keep their frozen relative order in the document,
 *      wherever conversion has since placed them. This is what stops a converted block from
 *      being hoisted above records it followed in the baseline while every local sequence
 *      still reads as ascending (`baseline-order-violation`);
 *   6. once no legacy row remains, the whole document must ascend (`not-ascending-document`).
 *
 * Rule 1 expires a section the moment that section has no leftover table rows, and expires
 * entirely once no legacy table row remains. Rules 2 and 5 anchor to the baseline, so they
 * cover only identifiers the baseline froze. Identifiers assigned after the checkpoint are
 * unanchored and are held to rules 3, 4 and 6.
 */

import { idToNumber } from '../ids.mjs';
import { LEGACY_TABLE_SECTION_ORDER } from '../parse-register.mjs';

const LEGACY_REPRESENTATION = 'table-row';

/** Each legacy section is one sequence; every converted record shares a single sequence. */
function orderingGroupKey(record) {
  return record.representation === 'heading' ? 'heading-records' : `table:${record.section}`;
}

function groupBy(records, keyOf) {
  const groups = new Map();
  for (const record of records) {
    const key = keyOf(record);
    if (key === null) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return groups;
}

export function checkOrdering({ records, baseline, findings }) {
  // Array order is the baseline's own canonical order, fixed when the artifact was frozen.
  const anchors = new Map(
    baseline.records.map((entry, index) => [entry.id, { section: entry.section, index }]),
  );

  const legacyRecords = records.filter((record) => record.representation === LEGACY_REPRESENTATION);
  const convertedRecords = records.filter(
    (record) => record.representation !== LEGACY_REPRESENTATION,
  );

  const state =
    records.length === 0
      ? 'empty'
      : legacyRecords.length === 0
        ? 'converted'
        : convertedRecords.length === 0
          ? 'legacy'
          : 'mixed';

  // One descent is reported once, under the most specific rule that saw it, so a single
  // misplaced record does not turn into three findings that read like three problems.
  const reported = new Set();
  const reportDescent = (code, before, after, message, detail) => {
    const key = `${before.id}@${before.line}>${after.id}@${after.line}`;
    if (reported.has(key)) return;
    reported.add(key);
    findings.fail(code, message, detail);
  };

  checkLegacySectionOrder({ legacyRecords, findings });
  checkLegacySectionAnchoring({ legacyRecords, anchors, findings });
  checkGroupOrder({ records, reportDescent });
  checkStructuralSectionOrder({ records, reportDescent });
  checkBaselineRelativeOrder({ records, anchors, reportDescent });
  checkConvertedDocumentOrder({ records, legacyRecords, findings });

  const groups = groupBy(records, orderingGroupKey);
  findings.info(
    `ordering state: ${state} — ${legacyRecords.length} legacy table row(s), ${convertedRecords.length} converted record(s), ${groups.size} ordering group(s)`,
    {
      groups: [...groups.entries()].map(([key, group]) => `${key} (${group.length})`),
      rule:
        state === 'converted'
          ? 'strict global ascending order is mandatory: no legacy table row remains'
          : 'the two-table split is grandfathered in its existing physical order; baseline-relative placement applies until the last legacy row is converted',
    },
  );

  return {
    state,
    legacyRecords: legacyRecords.length,
    convertedRecords: convertedRecords.length,
    groups: groups.size,
  };
}

/**
 * Remaining legacy table sections keep the physical order of the pre-D165 two-table layout.
 * Judged only from which sections still have table rows and where those rows sit — never from
 * status vocabulary — and only while more than one contracted section still has rows.
 */
function checkLegacySectionOrder({ legacyRecords, findings }) {
  const sectionPositions = new Map();
  for (const record of legacyRecords) {
    const previous = sectionPositions.get(record.section);
    if (previous !== undefined && previous.line <= record.line) continue;
    sectionPositions.set(record.section, {
      line: record.line,
      sectionTitle: record.sectionTitle,
    });
  }

  const remaining = LEGACY_TABLE_SECTION_ORDER.filter((section) => sectionPositions.has(section));
  if (remaining.length < 2) return;

  for (let i = 1; i < remaining.length; i += 1) {
    const earlier = remaining[i - 1];
    const later = remaining[i];
    const earlierPos = sectionPositions.get(earlier);
    const laterPos = sectionPositions.get(later);
    if (earlierPos.line < laterPos.line) continue;

    findings.fail(
      'legacy-section-order-violation',
      `legacy table section "${later}" (line ${laterPos.line}) appears before "${earlier}" (line ${earlierPos.line}); remaining legacy sections must keep the pre-D165 representation order (${LEGACY_TABLE_SECTION_ORDER.join(' → ')})`,
      {
        note: 'The two-table split is grandfathered only in its existing physical order. Moving one leftover legacy section past another is a register rearrangement, not the representation change D165 authorizes.',
        expectedOrder: LEGACY_TABLE_SECTION_ORDER.join(' → '),
        observedOrder: remaining
          .slice()
          .sort((a, b) => sectionPositions.get(a).line - sectionPositions.get(b).line)
          .join(' → '),
        line: laterPos.line,
      },
    );
  }
}

/**
 * A record that has not been converted has no representation reason to move. Only the
 * conversion itself may take a record out of its frozen structural section.
 */
function checkLegacySectionAnchoring({ legacyRecords, anchors, findings }) {
  for (const record of legacyRecords) {
    const anchor = anchors.get(record.id);
    if (anchor === undefined) continue;
    if (anchor.section === record.section) continue;

    findings.fail(
      'legacy-record-section-changed',
      `${record.id} is still a legacy table row but moved from frozen section "${anchor.section}" to "${record.section}"`,
      {
        note: 'Moving an unconverted row between structural sections is a register change, not the representation change D165 authorizes.',
        line: record.line,
      },
    );
  }
}

function checkGroupOrder({ records, reportDescent }) {
  for (const [key, group] of groupBy(records, orderingGroupKey)) {
    for (let i = 1; i < group.length; i += 1) {
      if (idToNumber(group[i].id) > idToNumber(group[i - 1].id)) continue;
      reportDescent(
        'not-ascending',
        group[i - 1],
        group[i],
        `${group[i].id} follows ${group[i - 1].id} in ${key}; records must be in ascending numeric order`,
        { line: group[i].line },
      );
    }
  }
}

/**
 * Ascending order inside one structural section, across both representations. Only pairs that
 * span ordering groups are reported here; the rest are already covered above.
 */
function checkStructuralSectionOrder({ records, reportDescent }) {
  for (const [section, group] of groupBy(records, (record) => record.section)) {
    for (let i = 1; i < group.length; i += 1) {
      const [before, after] = [group[i - 1], group[i]];
      if (orderingGroupKey(before) === orderingGroupKey(after)) continue;
      if (idToNumber(after.id) > idToNumber(before.id)) continue;

      reportDescent(
        'section-order-not-ascending',
        before,
        after,
        `${after.id} (${after.representation}) follows ${before.id} (${before.representation}) in section "${section}"; a section must ascend across both representations during the transition`,
        {
          note: 'Converting a record does not authorize placing it below a higher identifier that is still a legacy row.',
          line: after.line,
        },
      );
    }
  }
}

/**
 * Records frozen in the same structural section must still appear in the document in their
 * frozen relative order, wherever conversion has since placed them.
 */
function checkBaselineRelativeOrder({ records, anchors, reportDescent }) {
  const anchoredSection = (record) => anchors.get(record.id)?.section ?? null;

  for (const [section, group] of groupBy(records, anchoredSection)) {
    for (let i = 1; i < group.length; i += 1) {
      const [before, after] = [group[i - 1], group[i]];
      if (anchors.get(after.id).index > anchors.get(before.id).index) continue;

      reportDescent(
        'baseline-order-violation',
        before,
        after,
        `${after.id} now appears after ${before.id}, reversing the order the frozen baseline captured for section "${section}"`,
        {
          note: 'Representation conversion may change how a record is written, never where it sits relative to the records it was frozen alongside.',
          frozenOrder: `${after.id} before ${before.id}`,
          line: after.line,
        },
      );
    }
  }
}

/** The transition accommodation ends the moment the last legacy table row is converted. */
function checkConvertedDocumentOrder({ records, legacyRecords, findings }) {
  if (records.length === 0 || legacyRecords.length > 0) return;

  for (let i = 1; i < records.length; i += 1) {
    if (idToNumber(records[i].id) > idToNumber(records[i - 1].id)) continue;
    findings.fail(
      'not-ascending-document',
      `${records[i].id} follows ${records[i - 1].id}; the fully-converted register must be ascending end to end`,
      {
        note: 'No legacy table row remains, so the mixed-transition accommodation no longer applies: D165 requires one ascending sequence regardless of status.',
        line: records[i].line,
      },
    );
  }
}
