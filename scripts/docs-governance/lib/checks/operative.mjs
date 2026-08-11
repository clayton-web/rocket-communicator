/**
 * Operative-text preservation, plus boundary and inert-history safeguards.
 *
 * How a change is classified — strictest outcome wins, nothing passes silently:
 *
 *   identical                     strict digests match. Byte-for-byte preservation of
 *                                 meaningful text. This is the expected result for every
 *                                 record the current batch did not touch.
 *   operative-text-changed        the word bag differs, so a word was removed or introduced.
 *                                 Hard failure. Paraphrase always lands here, because a
 *                                 paraphrase both drops and adds words.
 *   operative-inline-syntax-changed
 *                                 same words in the same order, different Markdown emphasis,
 *                                 code spans or link syntax. Hard failure: D165 authorizes no
 *                                 modernization of operative text, and emphasis in this
 *                                 register marks what binds.
 *   operative-clause-rearranged   same words, but a frozen clause can no longer be found
 *                                 intact, so words moved *within* a clause. Hard failure,
 *                                 because reordering can invert meaning
 *                                 ("A must not depend on B" versus "B must not depend on A").
 *   operative-decoration-changed  same words and clauses, but a clause lost or gained
 *                                 punctuation or emphasis decoration — what happens when a
 *                                 bold lead-in becomes a heading title. Human-review item.
 *   operative-relocated           same words, every frozen clause still intact, only the
 *                                 field or clause order changed. This is exactly the
 *                                 relocation D165 authorizes, so it is a human-review item
 *                                 rather than a failure — and it is always reported.
 *
 * The two review outcomes are never silent: both are printed with the affected clause. In-place
 * restyling with no relocation is a failure; decoration lost *because* text moved is a review
 * item, because the format change forces it.
 */

import { analyzeRecord, locateClause } from '../analyze.mjs';
import { INERT_HISTORY_SENTINEL } from '../clauses.mjs';
import { bagDifference, findSharedWordRun, tokenBag } from '../normalize.mjs';
import { recordFromBaseline } from '../baseline.mjs';

/**
 * Shared wording shorter than this is too generic to prove resurrection from — governance prose
 * repeats phrases like "without explicit Owner authority" legitimately.
 */
const MIN_RESURRECTION_WORDS = 8;

const excerpt = (text, length = 180) =>
  text.length <= length ? text : `${text.slice(0, length)}…`;

export function checkOperativeText({ baseline, byId, findings }) {
  const classifications = { identical: 0, relocated: 0, changed: 0, absent: 0 };

  for (const entry of baseline.records) {
    const live = byId.get(entry.id);
    if (live === undefined) {
      classifications.absent += 1; // already reported by the structural check
      continue;
    }

    const frozen = analyzeRecord(recordFromBaseline(entry));

    if (frozen.operative.digest !== entry.operative.digest) {
      findings.fail(
        'baseline-self-inconsistent',
        `${entry.id}: the frozen digest does not match the frozen verbatim text — the baseline artifact was hand-edited or the normalizer changed without a version bump`,
      );
      continue;
    }

    const liveAnalysis = analyzeRecord(live);

    if (entry.status !== live.status) {
      findings.fail(
        'status-changed',
        `${entry.id} status changed from ${JSON.stringify(entry.status)} to ${JSON.stringify(live.status)}`,
        {
          note: 'A representation batch must never change a status. A genuine later status change requires a reviewed baseline regeneration.',
          line: live.line,
        },
      );
    }

    if (entry.representation !== live.representation) {
      findings.info(`${entry.id} representation ${entry.representation} → ${live.representation}`);
    }

    classifyOperativeChange({ entry, live, frozen, liveAnalysis, findings, classifications });
    checkBoundaryPreservation({ entry, live, liveAnalysis, findings });
    checkSupportingPreservation({ entry, frozen, liveAnalysis, findings });
    checkInertNonResurrection({ entry, live, frozen, liveAnalysis, findings });
  }

  return classifications;
}

function classifyOperativeChange({ entry, live, frozen, liveAnalysis, findings, classifications }) {
  if (frozen.operative.digest === liveAnalysis.operative.digest) {
    classifications.identical += 1;
    return;
  }

  const frozenBag = tokenBag(frozen.operative.text);
  const liveBag = tokenBag(liveAnalysis.operative.text);
  const removed = bagDifference(frozenBag, liveBag);
  const added = bagDifference(liveBag, frozenBag);

  const located = frozen.operative.segments.map((segment) => ({
    segment,
    ...locateClause(segment.text, liveAnalysis.operative.tiers),
  }));
  const lost = located.filter((entry) => !entry.found).map((entry) => entry.segment);
  const decorated = located.filter((entry) => entry.tier === 'words');

  if (removed.length > 0 || added.length > 0) {
    classifications.changed += 1;
    findings.fail('operative-text-changed', `${entry.id} operative Decision text changed`, {
      wordsRemoved: removed.length === 0 ? '(none)' : excerpt(removed.join(' '), 300),
      wordsAdded: added.length === 0 ? '(none)' : excerpt(added.join(' '), 300),
      firstAffectedClause:
        lost.length === 0 ? '(clause boundaries unchanged)' : excerpt(lost[0].text.trim()),
      line: live.line,
    });
    return;
  }

  if (frozen.operative.proseDigest === liveAnalysis.operative.proseDigest) {
    classifications.changed += 1;
    findings.fail(
      'operative-inline-syntax-changed',
      `${entry.id} operative Decision wording is unchanged but its Markdown emphasis, code spans or link syntax were altered`,
      {
        note: 'D165 authorizes no modernization of operative text; emphasis marks what binds.',
        line: live.line,
      },
    );
    return;
  }

  if (lost.length > 0) {
    classifications.changed += 1;
    findings.fail(
      'operative-clause-rearranged',
      `${entry.id} keeps every word but ${lost.length} frozen clause(s) can no longer be found intact, so words moved within a clause`,
      { firstAffectedClause: excerpt(lost[0].text.trim()), line: live.line },
    );
    return;
  }

  classifications.relocated += 1;

  if (decorated.length > 0) {
    findings.review(
      'operative-decoration-changed',
      `${entry.id} keeps every word and clause, but ${decorated.length} clause(s) lost or gained punctuation or emphasis decoration`,
      {
        frozenSurfaces: entry.operative.surfaces,
        liveSurfaces: liveAnalysis.operative.surfaces,
        firstAffectedClause: excerpt(decorated[0].segment.text.trim()),
        note: 'Expected where a bold lead-in became a heading title. Confirm no operative meaning depended on the removed decoration (D165).',
        line: live.line,
      },
    );
    return;
  }

  findings.review(
    'operative-relocated',
    `${entry.id} operative text was relocated without changing any word or clause`,
    {
      frozenSurfaces: entry.operative.surfaces,
      liveSurfaces: liveAnalysis.operative.surfaces,
      note: 'Representation-only relocation as authorized by D165. Confirm the destination field is correct for this batch.',
      line: live.line,
    },
  );
}

/**
 * Boundary preservation.
 *
 * A frozen non-authorization clause must still exist in the record, and must not have been
 * demoted into inert history — inert history is never current law, so moving a live
 * prohibition there would silently repeal it.
 */
function checkBoundaryPreservation({ entry, live, liveAnalysis, findings }) {
  const clauses = [...(entry.boundaryClauses ?? []), ...(entry.supportingBoundaryClauses ?? [])];
  if (clauses.length === 0) return;

  const empty = { strict: '', prose: '', words: '' };
  const inertTiers = liveAnalysis.inert?.tiers ?? empty;

  for (const clause of clauses) {
    const inOperative = locateClause(clause.text, liveAnalysis.operative.tiers);
    const inSupporting = locateClause(clause.text, liveAnalysis.supporting.tiers);
    const inInert = locateClause(clause.text, inertTiers);

    if (inOperative.found || inSupporting.found) continue;

    if (inInert.found) {
      findings.fail(
        'boundary-demoted-to-inert-history',
        `${entry.id}: boundary clause moved into inert history, which is never current law`,
        { markers: clause.markers, clause: excerpt(clause.text), line: live.line },
      );
      continue;
    }

    findings.fail(
      'boundary-clause-lost',
      `${entry.id}: boundary clause no longer appears anywhere in the record`,
      { markers: clause.markers, clause: excerpt(clause.text), line: live.line },
    );
  }
}

/**
 * Supporting text (Notes, and later Supersession/Amendment and Rationale).
 *
 * Loss here is a review item, not a failure: D165 explicitly authorizes reference-shift
 * removal of duplicated specification from this material, provided each removal is
 * classified individually and names its destination. Surfacing every removal is what lets
 * that per-removal classification actually happen. Boundary clauses inside Notes are
 * excluded from this leniency — they are covered by the hard check above.
 */
function checkSupportingPreservation({ entry, frozen, liveAnalysis, findings }) {
  if (frozen.supporting.digest === liveAnalysis.supporting.digest) return;

  const removed = bagDifference(
    tokenBag(frozen.supporting.text),
    tokenBag(liveAnalysis.supporting.text),
  );
  const added = bagDifference(
    tokenBag(liveAnalysis.supporting.text),
    tokenBag(frozen.supporting.text),
  );

  if (removed.length === 0 && added.length === 0) return;

  findings.review(
    'supporting-text-changed',
    `${entry.id} supporting history text changed (${removed.length} word(s) removed, ${added.length} added)`,
    {
      wordsRemoved: removed.length === 0 ? '(none)' : excerpt(removed.join(' '), 240),
      wordsAdded: added.length === 0 ? '(none)' : excerpt(added.join(' '), 240),
      note: 'Every reference-shift removal must name its authoritative destination and prove no loss (D165).',
    },
  );
}

/**
 * Withdrawn-clause non-resurrection and inert-history isolation.
 *
 * Both the frozen inert text and the live inert text are tested against the live operative
 * surface, so deleting the inert block does not let its content reappear as law.
 */
function checkInertNonResurrection({ entry, live, frozen, liveAnalysis, findings }) {
  const sources = [
    { origin: 'frozen', body: frozen.inert?.body ?? '' },
    { origin: 'live', body: liveAnalysis.inert?.body ?? '' },
  ];

  const reported = new Set();
  for (const { origin, body } of sources) {
    if (body === '') continue;

    const shared = findSharedWordRun(body, liveAnalysis.operative.text, MIN_RESURRECTION_WORDS);
    if (shared === null || reported.has(shared)) continue;

    reported.add(shared);
    findings.fail(
      'withdrawn-clause-resurrected',
      `${entry.id}: text preserved as inert history also appears as operative Decision law`,
      {
        origin: `${origin} inert history`,
        sharedWording: excerpt(shared),
        line: live.line,
      },
    );
  }

  if (liveAnalysis.inert !== null && !liveAnalysis.inert.sentinelExact) {
    findings.fail(
      'inert-sentinel-not-exact',
      `${live.id}: inert history does not carry the exact sentinel ${JSON.stringify(INERT_HISTORY_SENTINEL)}`,
      { found: excerpt(liveAnalysis.inert.label, 120), line: live.line },
    );
  }
}

/**
 * The sentinel must not appear inside the operative Decision field, because that would mean
 * inert history is no longer structurally separate from current law.
 *
 * A *quoted* mention is different from a use: D165's own Decision text names the sentinel in
 * quotation marks while defining the schema. Only unquoted occurrences are failures.
 */
export function checkInertIsolation({ records, findings }) {
  for (const record of records) {
    isolationOfRecord(record, findings);
  }
}

function isolationOfRecord(record, findings) {
  const prose = analyzeRecord(record).operative.tiers.prose;
  let from = 0;

  for (;;) {
    const at = prose.indexOf(INERT_HISTORY_SENTINEL, from);
    if (at === -1) return;
    from = at + INERT_HISTORY_SENTINEL.length;

    const before = prose.slice(Math.max(0, at - 2), at);
    const quoted = /[\u201c"'\u2018]/.test(before);
    if (quoted) continue;

    findings.fail(
      'inert-history-not-isolated',
      `${record.id}: the inert-history sentinel appears inside the operative Decision field`,
      {
        context: excerpt(prose.slice(Math.max(0, at - 60), at + 80), 160),
        line: record.line,
      },
    );
  }
}

/** Records that carry inert history but never actually declare the sentinel field. */
export function checkInertSentinelUsage({ records, findings }) {
  for (const record of records) {
    const hasNearMiss =
      record.inertHistory === null &&
      /inert\s+history/i.test(`${record.notes} ${record.decision}`) &&
      !`${record.notes} ${record.decision}`.includes(INERT_HISTORY_SENTINEL);

    if (!hasNearMiss) continue;

    findings.fail(
      'inert-sentinel-near-miss',
      `${record.id} mentions inert history without the exact sentinel ${JSON.stringify(INERT_HISTORY_SENTINEL)}`,
      { line: record.line },
    );
  }
}
