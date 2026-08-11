/**
 * Decision identifier and citation token handling.
 *
 * Identifiers are always `D` plus exactly three digits. Ranges in this repository are
 * written with an en dash (`D102–D110`, the common form), an em dash, or an ASCII hyphen.
 * A slash-separated pair (`D095/D099`) is two citations, not a range, so `/` is never a
 * range separator.
 */

export const ID_TOKEN = /\bD\d{3}\b/g;

const RANGE_SEPARATORS = '\u2013\u2014-';
const RANGE_TOKEN = new RegExp(`\\bD(\\d{3})\\s?[${RANGE_SEPARATORS}]\\s?D?(\\d{3})\\b`, 'g');

export function formatId(numeric) {
  return `D${String(numeric).padStart(3, '0')}`;
}

export function idToNumber(id) {
  return Number.parseInt(id.slice(1), 10);
}

export function isDecisionId(value) {
  return typeof value === 'string' && /^D\d{3}$/.test(value);
}

/** Every ID between two endpoints inclusive, ascending. */
export function expandRange(startId, endId) {
  const start = idToNumber(startId);
  const end = idToNumber(endId);
  const ids = [];
  for (let n = start; n <= end; n += 1) ids.push(formatId(n));
  return ids;
}

/** Unique IDs mentioned anywhere in `text`, in first-appearance order. */
export function extractIdTokens(text) {
  const seen = new Set();
  for (const match of text.matchAll(ID_TOKEN)) seen.add(match[0]);
  return [...seen];
}

/**
 * Citation tokens in `text`, classified as ranges or bare identifiers.
 *
 * Range spans are claimed first so the two endpoints of `D102–D110` are not also counted
 * as bare citations.
 */
export function extractCitations(text) {
  const ranges = [];
  const claimed = [];

  for (const match of text.matchAll(RANGE_TOKEN)) {
    const startId = formatId(Number.parseInt(match[1], 10));
    const endId = formatId(Number.parseInt(match[2], 10));
    ranges.push({
      kind: 'range',
      raw: match[0],
      startId,
      endId,
      index: match.index,
      ascending: idToNumber(startId) < idToNumber(endId),
    });
    claimed.push([match.index, match.index + match[0].length]);
  }

  const bare = [];
  for (const match of text.matchAll(ID_TOKEN)) {
    const start = match.index;
    const inRange = claimed.some(([from, to]) => start >= from && start < to);
    if (inRange) continue;
    bare.push({ kind: 'bare', raw: match[0], id: match[0], index: start });
  }

  return { ranges, bare };
}
