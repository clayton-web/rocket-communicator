/**
 * Deterministic normalization used for every text comparison in the harness.
 *
 * Two levels exist, and the difference between them is the whole basis of the
 * "representation change versus semantic change" distinction:
 *
 *   strict  — removes *only* representation noise that the table/heading choice forces:
 *             Unicode form, the table-only `\|` pipe escape, and whitespace runs
 *             (a wide table cell is one line; a heading body may be hard-wrapped).
 *             Emphasis, punctuation, links, code spans and wording are all preserved,
 *             so a strict digest match is byte-for-byte preservation of meaningful text.
 *
 *   prose   — strict, plus inline Markdown *syntax* removal (emphasis markers, code-span
 *             backticks, link syntax reduced to its visible text). Used only to classify
 *             a failure more precisely, never to excuse one.
 *
 * Any change to the rules below is a governance-visible event: bump NORMALIZER_VERSION so
 * the frozen baseline must be regenerated and re-reviewed rather than silently reinterpreted.
 */

import { createHash } from 'node:crypto';

export const NORMALIZER_VERSION = 1;

/**
 * Removes the table-only pipe escape. Every other backslash escape (`\*`, `\_`) is needed
 * in both representations and is therefore meaningful content, not noise.
 */
export function unescapeTablePipes(text) {
  return text.replace(/\\\|/g, '|');
}

export function strictNormalize(text) {
  return unescapeTablePipes(text.normalize('NFC')).replace(/\s+/g, ' ').trim();
}

/**
 * Inline-syntax removal. Underscores are deliberately left alone: this corpus is full of
 * identifiers such as `task_suggestion_revisions` and `NEXT_PUBLIC_APP_URL`, and treating
 * `_` as emphasis would corrupt them.
 */
export function proseNormalize(text) {
  return strictNormalize(text)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*+/g, '')
    .replace(/`/g, '')
    .replace(/~~/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Words and numbers only.
 *
 * This is the most tolerant tier and exists for one reason: when a bold lead-in such as
 * `**Reminder stop (A8.1):**` becomes a heading title, the emphasis and the trailing colon
 * necessarily disappear even though not one word changed. Matching at this tier lets the
 * harness say "the clause survived, its decoration did not" instead of misreporting a word
 * as lost. It is never used to decide that two texts are equal — only to locate a clause and
 * to compare word bags.
 */
export function wordsOnlyNormalize(text) {
  return proseNormalize(text)
    .replace(/[^\p{L}\p{N}\s]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function digest(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function shortDigest(text) {
  return digest(text).slice(0, 16);
}

/**
 * Comparable word bag, used to prove no word was dropped or introduced.
 *
 * Built from the words-only tier so that relocating a bold lead-in into a heading does not
 * read as a lost word. Punctuation changes are consequently invisible here; they are caught
 * by the strict digest and by clause-level containment instead.
 */
export function tokenBag(text) {
  const bag = new Map();
  for (const token of wordsOnlyNormalize(text).split(' ')) {
    if (token === '') continue;
    bag.set(token, (bag.get(token) ?? 0) + 1);
  }
  return bag;
}

/** Words present in `a` but not `b`, honouring repetition counts. */
export function bagDifference(a, b) {
  const missing = [];
  for (const [token, count] of a) {
    const other = b.get(token) ?? 0;
    for (let i = 0; i < count - other; i += 1) missing.push(token);
  }
  return missing;
}

/**
 * The longest run of at least `minWords` consecutive words from `sourceText` that also appears
 * in `targetText`, or null.
 *
 * Used to prove that withdrawn text has not been resurrected. Containment of a whole clause is
 * not enough: inert history is usually stored as `Formerly read: "…"`, so a resurrected
 * fragment sits *inside* the inert clause rather than matching it. Comparing at the words-only
 * tier means re-emphasising or repunctuating the fragment does not hide the reuse.
 */
export function findSharedWordRun(sourceText, targetText, minWords) {
  const source = wordsOnlyNormalize(sourceText).split(' ').filter(Boolean);
  const target = ` ${wordsOnlyNormalize(targetText)} `;

  for (let start = 0; start + minWords <= source.length; start += 1) {
    let longest = null;
    for (let end = start + minWords; end <= source.length; end += 1) {
      const candidate = source.slice(start, end).join(' ');
      if (!target.includes(` ${candidate} `)) break;
      longest = candidate;
    }
    if (longest !== null) return longest;
  }

  return null;
}

const ABBREVIATIONS = new Set([
  'e.g',
  'i.e',
  'etc',
  'cf',
  'vs',
  'no',
  'approx',
  'incl',
  'ca',
  'fig',
]);

const CLAUSE_OPENERS = /[A-Z0-9(\[*`_"\u201c\u00a7\u2014\u2013]/;
const MIN_SEGMENT_WORDS = 3;

/**
 * Splits strict-normalized text into clause segments.
 *
 * Segmentation only sets the *granularity* at which relocation and boundary loss are
 * reported. It can never hide a change, because whole-field digests and word-bag
 * comparison run independently. Segments tile the input contiguously, so joining them
 * reproduces the input exactly — the tests assert this.
 */
export function segmentText(strictText) {
  if (strictText === '') return [];

  const cuts = [];
  for (let i = 0; i < strictText.length - 1; i += 1) {
    if (!'.;!?'.includes(strictText[i])) continue;
    if (strictText[i + 1] !== ' ') continue;

    const next = strictText[i + 2];
    if (next === undefined || !CLAUSE_OPENERS.test(next)) continue;

    if (strictText[i] === '.') {
      const before = strictText.slice(0, i);
      const lastWord = (before.match(/[^\s(*`"']+$/) ?? [''])[0].toLowerCase();
      // `A8.1`, `0..N` and `e.g.` must not become clause boundaries.
      if (ABBREVIATIONS.has(lastWord)) continue;
      if (/^\d+$/.test(lastWord) || lastWord.endsWith('.')) continue;
      if (/^[a-z]$/.test(lastWord)) continue;
    }

    cuts.push(i + 2);
  }

  const segments = [];
  let start = 0;
  for (const cut of [...cuts, strictText.length]) {
    const text = strictText.slice(start, cut);
    const words = text.trim().split(' ').filter(Boolean).length;
    if (words < MIN_SEGMENT_WORDS && segments.length > 0) {
      // Merge a fragment such as `(6)` into the clause it belongs to.
      const previous = segments[segments.length - 1];
      previous.text += text;
      previous.length = previous.text.length;
    } else {
      segments.push({ offset: start, length: text.length, text });
    }
    start = cut;
  }

  return segments.map((segment) => ({
    offset: segment.offset,
    length: segment.length,
    text: segment.text,
    strictDigest: shortDigest(segment.text.trim()),
    proseDigest: shortDigest(proseNormalize(segment.text)),
  }));
}
