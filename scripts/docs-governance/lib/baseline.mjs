/**
 * The frozen pre-representation baseline.
 *
 * What this artifact is: a normalized, machine-readable snapshot of DECISIONS.md taken at
 * the governance checkpoint where D165 was approved, so that a later representation change
 * can be *proved* not to have altered any decision.
 *
 * What it is not: an authority layer. It originates no law, resolves no ambiguity and
 * supersedes nothing. Where it disagrees with DECISIONS.md, DECISIONS.md is the register
 * and the baseline is evidence that something changed.
 *
 * Wording is copied verbatim. Nothing is paraphrased, summarized, reconstructed or dated.
 * The only transformation applied to the comparison surfaces is documented in
 * `lib/normalize.mjs`, and changing it requires a NORMALIZER_VERSION bump plus a reviewed
 * regeneration.
 */

import { readFileSync } from 'node:fs';

import { analyzeRecord } from './analyze.mjs';
import { INERT_HISTORY_SENTINEL, STATUS_VOCABULARY } from './clauses.mjs';
import { NORMALIZER_VERSION, digest } from './normalize.mjs';
import { formatId, idToNumber } from './ids.mjs';
import { composeRecord } from './parse-register.mjs';

export const BASELINE_FORMAT_VERSION = 1;
export const ARTIFACT_KIND = 'rocket-communicator/decisions-baseline';

const HEADER_NOTE = [
  'Frozen normalized snapshot of docs/DECISIONS.md at the D165 governance checkpoint,',
  'captured before the authorized heading-per-decision representation change.',
  'Evidence only: this artifact is not an authority layer, originates no decision law,',
  'and never overrides docs/DECISIONS.md. Wording is verbatim; nothing is paraphrased,',
  'reconstructed or dated. Regenerating it is a reviewed governance act, not a fix for a',
  'failing check.',
].join(' ');

const CORE_FIELDS = ['title', 'status', 'decision', 'notes', 'inertHistory', 'inertHistoryLabel'];

/**
 * Conditional heading-representation fields (Boundaries, Current law, Supersession,
 * Rationale). Empty for a table-representation freeze, and present only so a baseline could
 * also be frozen from a partly-converted register without losing a field.
 */
function extraFieldsOf(record) {
  const extra = {};
  for (const [name, value] of Object.entries(record.fields)) {
    if (CORE_FIELDS.includes(name)) continue;
    if (typeof value !== 'string' || value.trim() === '') continue;
    extra[name] = value;
  }
  return extra;
}

/** Rebuilds a record from frozen verbatim text, through the live parser's own composer. */
export function recordFromBaseline(entry) {
  return composeRecord({
    id: entry.id,
    representation: entry.representation,
    section: entry.section,
    sectionTitle: entry.section,
    line: null,
    fields: {
      ...(entry.extraFields ?? {}),
      title: entry.title ?? '',
      status: entry.status,
      decision: entry.decision,
      notes: entry.notes,
      inertHistory: entry.inertHistory ?? undefined,
    },
    presentFields: entry.presentFields ?? [],
  });
}

export function buildBaseline({ records, source, sourcePath, commit }) {
  const ordered = [...records].sort((a, b) => idToNumber(a.id) - idToNumber(b.id));

  const baselineRecords = ordered.map((record) => {
    const analysis = analyzeRecord(record);
    return {
      id: record.id,
      status: record.status,
      section: record.section,
      representation: record.representation,
      presentFields: record.presentFields,
      title: record.title === '' ? null : record.title,
      decision: record.decision,
      notes: record.notes,
      inertHistory: record.inertHistory,
      extraFields: extraFieldsOf(record),
      operative: {
        surfaces: analysis.operative.surfaces,
        digest: analysis.operative.digest,
        proseDigest: analysis.operative.proseDigest,
        length: analysis.operative.text.length,
        // Segment text is derivable from the verbatim `decision` above; only the digests are
        // frozen, which keeps the artifact reviewable without storing the corpus twice.
        segments: analysis.operative.segments.map((segment) => ({
          offset: segment.offset,
          length: segment.length,
          strictDigest: segment.strictDigest,
          proseDigest: segment.proseDigest,
        })),
      },
      supporting: {
        surfaces: analysis.supporting.surfaces,
        digest: analysis.supporting.digest,
        proseDigest: analysis.supporting.proseDigest,
      },
      boundaryClauses: analysis.boundaries.operative.map((clause) => ({
        surface: 'operative',
        markers: clause.markers,
        proseDigest: clause.proseDigest,
        text: clause.text,
      })),
      supportingBoundaryClauses: analysis.boundaries.supporting.map((clause) => ({
        surface: 'supporting',
        markers: clause.markers,
        proseDigest: clause.proseDigest,
        text: clause.text,
      })),
      inert:
        analysis.inert === null
          ? null
          : {
              sentinelExact: analysis.inert.sentinelExact,
              withdrawnBy: analysis.inert.withdrawnBy,
              digest: analysis.inert.digest,
              segments: analysis.inert.segments.map((segment) => ({
                strictDigest: segment.strictDigest,
                proseDigest: segment.proseDigest,
                words: segment.words,
              })),
            },
      supersession: {
        citedIds: analysis.supersession.citedIds,
        inbound: analysis.supersession.inbound.map((assertion) => ({
          phrase: assertion.phrase,
          ids: assertion.ids,
        })),
        outbound: analysis.supersession.outbound.map((assertion) => ({
          phrase: assertion.phrase,
          ids: assertion.ids,
        })),
        withdrawalEvidence: analysis.supersession.withdrawalEvidence,
        remainingOperativeEvidence: analysis.supersession.remainingOperativeEvidence,
      },
    };
  });

  const first = baselineRecords[0]?.id ?? null;
  const last = baselineRecords[baselineRecords.length - 1]?.id ?? null;

  return {
    artifact: {
      kind: ARTIFACT_KIND,
      note: HEADER_NOTE,
      formatVersion: BASELINE_FORMAT_VERSION,
      normalizerVersion: NORMALIZER_VERSION,
      authority:
        'Evidence artifact under D165. Not an authority layer; docs/DECISIONS.md remains rank 3.',
      capturedFrom: sourcePath,
      capturedAtCommit: commit,
      sourceSha256: digest(source),
      sourceSha256IsInformationalOnly: true,
      idRange: { first, last, count: baselineRecords.length },
      regenerateWith: 'pnpm docs:decisions:baseline --force',
    },
    statusVocabulary: STATUS_VOCABULARY,
    inertHistorySentinel: INERT_HISTORY_SENTINEL,
    records: baselineRecords,
  };
}

export function serializeBaseline(baseline) {
  return `${JSON.stringify(baseline, null, 2)}\n`;
}

export function loadBaseline(path) {
  const baseline = JSON.parse(readFileSync(path, 'utf8'));

  if (baseline?.artifact?.kind !== ARTIFACT_KIND) {
    throw new Error(`${path}: not a ${ARTIFACT_KIND} artifact`);
  }
  if (baseline.artifact.formatVersion !== BASELINE_FORMAT_VERSION) {
    throw new Error(
      `${path}: baseline formatVersion ${baseline.artifact.formatVersion} but this harness expects ${BASELINE_FORMAT_VERSION}`,
    );
  }
  if (baseline.artifact.normalizerVersion !== NORMALIZER_VERSION) {
    throw new Error(
      `${path}: baseline was frozen with normalizerVersion ${baseline.artifact.normalizerVersion} but this harness normalizes at version ${NORMALIZER_VERSION}. Regenerating the baseline is a reviewed governance act — do not do it to make a check pass.`,
    );
  }
  return baseline;
}

/** Contiguous IDs the baseline claims to cover, used for the disappearance check. */
export function baselineIdRange(baseline) {
  const ids = baseline.records.map((record) => record.id);
  const numbers = ids.map(idToNumber);
  const expected = [];
  for (let n = Math.min(...numbers); n <= Math.max(...numbers); n += 1) expected.push(formatId(n));
  return { ids, expected };
}
