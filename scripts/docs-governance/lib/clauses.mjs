/**
 * Governance vocabularies, derived by inspecting the existing register rather than assumed.
 *
 * The boundary vocabulary is split into two tiers on purpose:
 *
 *   protected   — non-authorization and prohibition formulations. Losing one of these, or
 *                 demoting one into inert history, is a hard failure.
 *   restrictive — scope-narrowing wording ("only", "at most", "solely"). These are reported
 *                 for human review rather than treated as a distinct hard gate, because they
 *                 are already covered by operative-segment preservation and including them
 *                 in the protected tier would mark most of the register as a boundary and
 *                 destroy the signal reviewers need.
 */

import { proseNormalize } from './normalize.mjs';

export const STATUS_VOCABULARY = [
  'Approved',
  'Proposed',
  'Deferred',
  'Open',
  'Superseded',
  'Superseded in part',
];

/** Exact sentinel required by D165. The dash is U+2014 EM DASH. */
export const INERT_HISTORY_SENTINEL = 'Inert history \u2014 not current law';

const PROTECTED_BOUNDARY_MARKERS = [
  ['does-not-authorize', /does\s+not\s+authoriz\w*/i],
  ['authorizes-no', /authoriz\w*\s+no\b/i],
  ['not-authorized', /not\s+authoriz\w*|unauthoriz\w*/i],
  ['must-not', /must\s+not\b/i],
  ['may-not', /may\s+not\b/i],
  ['never', /\bnever\b/i],
  ['cannot', /\bcannot\b|\bcan\s+not\b/i],
  ['do-not', /\bdo\s+not\b|\bdoes\s+not\b/i],
  ['prohibited', /prohibit\w*/i],
  ['forbidden', /forbid\w*/i],
  ['excluded', /\bexclud\w*|\bexclusion\w*/i],
  ['no-action', /\bno\s+(?:longer\s+)?[a-z][\w-]*/i],
  ['out-of-scope', /outside\s+(?:the\s+)?scope|out\s+of\s+scope|sits\s+outside/i],
  ['remains-withheld', /remains?\s+(?:prohibited|unauthoriz\w*|deferred|withheld|gated)/i],
];

const RESTRICTIVE_MARKERS = [
  ['only', /\bonly\b/i],
  ['at-most', /\bat\s+most\b/i],
  ['solely', /\bsolely\b|\bsole\b/i],
  ['no-more-than', /\bno\s+more\s+than\b/i],
];

/**
 * Marker names present in a clause. Matching runs against the prose form so that
 * `must **not**` and `must not` are recognized identically.
 */
function markersIn(text, table) {
  const prose = proseNormalize(text);
  return table.filter(([, pattern]) => pattern.test(prose)).map(([name]) => name);
}

export function protectedBoundaryMarkers(text) {
  return markersIn(text, PROTECTED_BOUNDARY_MARKERS);
}

export function restrictiveMarkers(text) {
  return markersIn(text, RESTRICTIVE_MARKERS);
}

/**
 * Classifies already-segmented operative text into protected boundary clauses and
 * restrictive clauses, keyed by segment index so a reviewer can locate them.
 */
export function classifyClauses(segments) {
  const boundaries = [];
  const restrictive = [];

  segments.forEach((segment, index) => {
    const protectedMarkers = protectedBoundaryMarkers(segment.text);
    if (protectedMarkers.length > 0) {
      boundaries.push({
        segmentIndex: index,
        markers: protectedMarkers,
        proseDigest: segment.proseDigest,
        text: segment.text.trim(),
      });
    }

    const restrictiveFound = restrictiveMarkers(segment.text);
    if (restrictiveFound.length > 0 && protectedMarkers.length === 0) {
      restrictive.push({
        segmentIndex: index,
        markers: restrictiveFound,
        proseDigest: segment.proseDigest,
      });
    }
  });

  return { boundaries, restrictive };
}

const WITHDRAWAL_EVIDENCE = [
  ['withdrawn-clause', /withdraw(?:s|n|ing|al)?\b/i],
  ['superseded-clauses', /supersed\w*\s+clauses?|clauses?\s+(?:are\s+)?withdrawn/i],
  ['removed-from-active-text', /removed\s+from\s+the\s+(?:active|decision)\s+text/i],
];

const REMAINING_OPERATIVE_EVIDENCE = [
  ['still-operative', /still\s+(?:fully\s+)?operative/i],
  ['what-remains', /what\s+remains\b/i],
  ['remains-operative', /remains?\s+operative\b/i],
  ['remains-valid', /remains?\s+valid\b/i],
  ['stands-unchanged', /stands?\s+unchanged|still\s+stands?\b/i],
  ['preserved', /\bpreserved\b|\bpreserves\b|\bsurvives\b/i],
];

export function withdrawalEvidence(text) {
  return markersIn(text, WITHDRAWAL_EVIDENCE);
}

export function remainingOperativeEvidence(text) {
  return markersIn(text, REMAINING_OPERATIVE_EVIDENCE);
}

/**
 * Directional supersession assertions.
 *
 * Only the well-formed status-bearing phrasings are captured. The register also contains
 * sentences such as "Reminder records are superseded, never deleted" (about data, not
 * decisions) and "superseded for post-capture navigation by D150" inside an Approved
 * record, so a looser pattern would manufacture false relationships. Anything not matched
 * here still reaches the citation checks and the human-review report.
 */
const INBOUND_PATTERNS = [
  /(?:amended\s+and\s+)?supersed(?:ed)?\s+in\s+part\s+by\s+([^.;]*)/gi,
  /superseded\s+by\s+([^.;]*)/gi,
  /superseded\s+for\s+product\s+behaviour\s+by\s+([^.;]*)/gi,
];

const OUTBOUND_PATTERNS = [
  /(?:amends\s+and\s+)?supersedes\s+in\s+part\s+([^.;]*)/gi,
  /clarifies\s*\/\s*supersedes\s+in\s+part\s+([^.;]*)/gi,
  /supersedes\s+([^.;]*)/gi,
];

function assertionsFrom(text, patterns) {
  const prose = proseNormalize(text);
  const found = [];
  for (const pattern of patterns) {
    for (const match of prose.matchAll(new RegExp(pattern))) {
      const ids = [...new Set((match[1] ?? '').match(/\bD\d{3}\b/g) ?? [])];
      if (ids.length === 0) continue;
      found.push({ phrase: match[0].trim(), ids, span: match[1].trim() });
    }
  }
  return found;
}

/** "this record was superseded by X" assertions. */
export function inboundSupersessionAssertions(text) {
  return assertionsFrom(text, INBOUND_PATTERNS);
}

/** "this record supersedes X" assertions. */
export function outboundSupersessionAssertions(text) {
  return assertionsFrom(text, OUTBOUND_PATTERNS);
}
