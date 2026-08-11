/**
 * Derives the comparable structure of one record.
 *
 * The frozen baseline and every live verification run go through this same function, so a
 * baseline can never be compared against a differently-derived live view.
 */

import {
  classifyClauses,
  inboundSupersessionAssertions,
  outboundSupersessionAssertions,
  remainingOperativeEvidence,
  withdrawalEvidence,
  INERT_HISTORY_SENTINEL,
} from './clauses.mjs';
import { extractIdTokens } from './ids.mjs';
import { inertHistoryWithdrawnBy } from './parse-register.mjs';
import {
  digest,
  proseNormalize,
  segmentText,
  strictNormalize,
  wordsOnlyNormalize,
} from './normalize.mjs';

function joinSurfaces(surfaces) {
  return surfaces.map((surface) => strictNormalize(surface.text)).join(' ');
}

/**
 * Inert history without its sentinel label.
 *
 * The label names the withdrawing decision and is not itself withdrawn wording, so it is
 * excluded before testing for resurrection — otherwise the label's own words would be compared
 * against the record's operative text.
 */
function inertHistoryBody(inertText) {
  const sentinelAt = inertText.indexOf(INERT_HISTORY_SENTINEL);
  if (sentinelAt === -1) return inertText;

  const afterSentinel = sentinelAt + INERT_HISTORY_SENTINEL.length;
  const emphasisEnd = inertText.indexOf('**', afterSentinel);
  if (emphasisEnd !== -1) return inertText.slice(emphasisEnd + 2).trim();

  const punctuationEnd = inertText.slice(afterSentinel).search(/[.:]\s/);
  if (punctuationEnd !== -1) return inertText.slice(afterSentinel + punctuationEnd + 1).trim();

  return inertText.slice(afterSentinel).trim();
}

export function analyzeRecord(record) {
  const operativeText = joinSurfaces(record.operativeSurfaces);
  const supportingText = joinSurfaces(record.supportingSurfaces);
  const segments = segmentText(operativeText);
  const { boundaries, restrictive } = classifyClauses(segments);

  const supportingSegments = segmentText(supportingText);
  const supportingClauses = classifyClauses(supportingSegments);

  const evidenceText = `${operativeText} ${supportingText}`;

  let inert = null;
  if (record.inertHistory !== null) {
    const inertStrict = strictNormalize(record.inertHistory);
    inert = {
      text: inertStrict,
      body: inertHistoryBody(inertStrict),
      tiers: surfaceOf(inertStrict),
      sentinelExact: inertStrict.includes(INERT_HISTORY_SENTINEL),
      label: inertStrict.slice(0, Math.min(inertStrict.length, 160)),
      withdrawnBy: inertHistoryWithdrawnBy(inertStrict),
      digest: digest(inertStrict),
      segments: segmentText(inertStrict).map((segment) => ({
        strictDigest: segment.strictDigest,
        proseDigest: segment.proseDigest,
        words: segment.text.trim().split(' ').filter(Boolean).length,
        text: segment.text.trim(),
      })),
    };
  }

  return {
    operative: {
      surfaces: record.operativeSurfaces.map((surface) => surface.name),
      text: operativeText,
      tiers: surfaceOf(operativeText),
      digest: digest(operativeText),
      proseDigest: digest(proseNormalize(operativeText)),
      segments,
    },
    supporting: {
      surfaces: record.supportingSurfaces.map((surface) => surface.name),
      text: supportingText,
      tiers: surfaceOf(supportingText),
      digest: digest(supportingText),
      proseDigest: digest(proseNormalize(supportingText)),
      segments: supportingSegments,
    },
    boundaries: {
      operative: boundaries,
      supporting: supportingClauses.boundaries,
      restrictiveCount: restrictive.length + supportingClauses.restrictive.length,
    },
    inert,
    supersession: {
      citedIds: extractIdTokens(evidenceText).filter((id) => id !== record.id),
      inbound: inboundSupersessionAssertions(evidenceText),
      outbound: outboundSupersessionAssertions(evidenceText),
      withdrawalEvidence: withdrawalEvidence(evidenceText),
      remainingOperativeEvidence: remainingOperativeEvidence(evidenceText),
    },
  };
}

/**
 * Locates a clause inside a surface, reporting how tolerant the match had to be.
 *
 * Containment is used rather than digest equality because the rewrite may legitimately
 * re-segment text — merging two sentences into one paragraph must not read as clause loss.
 * Tiers are tried strictest first, and the tier that succeeded is what the caller reports:
 *
 *   strict — identical meaningful text.
 *   prose  — Markdown emphasis, code spans or link syntax differ.
 *   words  — punctuation or decoration differs, every word intact (a relocated lead-in).
 *   null   — the clause is gone, or its words were rearranged inside it.
 */
export function locateClause(clauseText, surface) {
  const strict = strictNormalize(clauseText);
  if (strict === '') return { found: true, tier: 'strict' };
  if (surface.strict.includes(strict)) return { found: true, tier: 'strict' };

  const prose = proseNormalize(clauseText);
  if (prose !== '' && surface.prose.includes(prose)) return { found: true, tier: 'prose' };

  const words = wordsOnlyNormalize(clauseText);
  if (words !== '' && surface.words.includes(words)) return { found: true, tier: 'words' };

  return { found: false, tier: null };
}

/** The three comparison tiers of one text, ready for `locateClause`. */
export function surfaceOf(text) {
  return {
    strict: strictNormalize(text),
    prose: proseNormalize(text),
    words: wordsOnlyNormalize(text),
  };
}
