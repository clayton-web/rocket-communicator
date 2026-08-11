/**
 * Repository-wide Dxxx citation resolution.
 *
 * The file inventory comes from `git ls-files`, which is deterministic, covers every tracked
 * representation the register is cited from — Markdown, TypeScript, Kotlin, YAML/OpenAPI,
 * Prisma, SQL migrations, tests and generated output — and automatically excludes
 * `node_modules`, build output and anything else already ignored.
 *
 * Known exclusions, and why:
 *   · the frozen baseline artifact — it quotes the register verbatim, so its identifiers are
 *     the register itself rather than external citations (required by the task);
 *   · this harness's own tests and fixtures — synthetic register data that deliberately includes
 *     identifiers which do not resolve, which is how the unresolved-citation path is proved;
 *   · lockfiles — machine-generated dependency hashes with no governance citations, where
 *     base64 punctuation could otherwise produce a Dxxx-shaped false positive;
 *   · binary files, detected by a NUL byte rather than by extension.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { expandRange, extractCitations, idToNumber } from '../ids.mjs';

const EXCLUDED_FILES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']);
const MAX_FILE_BYTES = 4 * 1024 * 1024;

/**
 * Words that ordinarily follow a citation as grammar rather than as a named clause. A citation
 * followed by one of these is a plain reference; anything else is reported for human review.
 */
const CITATION_FOLLOWERS = new Set([
  'a',
  'above',
  'additionally',
  'after',
  'against',
  'all',
  'already',
  'also',
  'although',
  'an',
  'and',
  'any',
  'applies',
  'apply',
  'are',
  'as',
  'at',
  'authorizes',
  'because',
  'before',
  'behaviour',
  'below',
  'but',
  'by',
  'can',
  'cannot',
  'confirmed',
  'covers',
  'decision',
  'defines',
  'describes',
  'did',
  'do',
  'does',
  'either',
  'else',
  'entirely',
  'even',
  'every',
  'except',
  'explicitly',
  'first',
  'for',
  'forbids',
  'from',
  'further',
  'governs',
  'had',
  'has',
  'have',
  'however',
  'if',
  'in',
  'includes',
  'instead',
  'is',
  'it',
  'its',
  'itself',
  'just',
  'keeps',
  'made',
  'makes',
  'may',
  'means',
  'must',
  'never',
  'no',
  'nor',
  'not',
  'now',
  'of',
  'on',
  'once',
  'only',
  'onward',
  'or',
  'other',
  'others',
  'owns',
  'per',
  'plus',
  'preserved',
  'preserves',
  'prohibits',
  'rather',
  'record',
  'refers',
  'remain',
  'remains',
  'removed',
  'requires',
  'respectively',
  'said',
  'says',
  'scope',
  'set',
  'shall',
  'should',
  'since',
  'so',
  'stands',
  'states',
  'still',
  'such',
  'supersedes',
  'superseded',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'therefore',
  'these',
  'they',
  'this',
  'those',
  'through',
  'to',
  'unchanged',
  'under',
  'unless',
  'until',
  'up',
  'upon',
  'used',
  'uses',
  'via',
  'was',
  'were',
  'what',
  'when',
  'where',
  'whether',
  'which',
  'while',
  'who',
  'whose',
  'will',
  'with',
  'within',
  'without',
  'would',
  // Verbs and participles that make the following words a sentence rather than a clause name.
  'added',
  'allow',
  'allowed',
  'allows',
  'amended',
  'amends',
  'became',
  'becomes',
  'binds',
  'cited',
  'cites',
  'closes',
  'complements',
  'corrects',
  'created',
  'creates',
  'declared',
  'declares',
  'deferred',
  'delivered',
  'denies',
  'existed',
  'exists',
  'extended',
  'extends',
  'gave',
  'gives',
  'held',
  'holds',
  'honours',
  'honors',
  'introduced',
  'introduces',
  'kept',
  'landed',
  'left',
  'mentioned',
  'mentions',
  'named',
  'names',
  'noted',
  'notes',
  'permits',
  'placed',
  'points',
  'reads',
  'recorded',
  'records',
  'replaced',
  'replaces',
  'restored',
  'restores',
  'retained',
  'retains',
  'returned',
  'said',
  'sets',
  'stated',
  'stays',
  'treated',
  'treats',
  'withdraws',
  'withdrawn',
  'withdrew',
]);

function trackedFiles(repoRoot) {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return output.split('\0').filter((entry) => entry !== '');
}

function isExcluded(relativePath, exclusions) {
  if (EXCLUDED_FILES.has(path.basename(relativePath))) return true;
  return exclusions.some(
    (excluded) => relativePath === excluded || relativePath.startsWith(`${excluded}/`),
  );
}

function readTextFile(absolutePath) {
  const stats = statSync(absolutePath);
  if (!stats.isFile() || stats.size > MAX_FILE_BYTES) return null;

  const buffer = readFileSync(absolutePath);
  const probe = buffer.subarray(0, Math.min(buffer.length, 8000));
  if (probe.includes(0)) return null;

  return buffer.toString('utf8');
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

/** Named or qualified citations such as `D081 idempotency intent`. */
function namedQualifier(text, afterIndex) {
  const tail = text.slice(afterIndex, afterIndex + 80);
  const match = /^[ \t]+([A-Za-z][\w'’-]*(?:[ \t]+[A-Za-z][\w'’-]*){0,2})/.exec(tail);
  if (match === null) return null;

  const words = match[1].split(/[ \t]+/);
  if (CITATION_FOLLOWERS.has(words[0].toLowerCase())) return null;

  // Trailing grammar words belong to the sentence, not to the clause name.
  while (words.length > 1 && CITATION_FOLLOWERS.has(words[words.length - 1].toLowerCase())) {
    words.pop();
  }

  return words.join(' ');
}

export function checkCitations({ repoRoot, byId, exclusions, findings }) {
  const files = trackedFiles(repoRoot).filter((file) => !isExcluded(file, exclusions));

  let scanned = 0;
  let bareCount = 0;
  let rangeCount = 0;
  const named = new Map();

  for (const relativePath of files) {
    const text = readTextFile(path.join(repoRoot, relativePath));
    if (text === null) continue;
    scanned += 1;

    const counts = scanTextForCitations({ relativePath, text, byId, findings, named });
    bareCount += counts.bare;
    rangeCount += counts.ranges;
  }

  reportNamedCitations({ named, findings });

  return {
    filesScanned: scanned,
    bareCitations: bareCount,
    rangeCitations: rangeCount,
    namedCitations: named.size,
  };
}

/** Citation checking for one file's text. Exported so tests can drive it without a git tree. */
export function scanTextForCitations({ relativePath, text, byId, findings, named = new Map() }) {
  const { bare, ranges } = extractCitations(text);

  for (const citation of bare) {
    if (!byId.has(citation.id)) {
      findings.fail(
        'unresolved-citation',
        `${relativePath}:${lineOf(text, citation.index)} cites ${citation.id}, which has no record in the register`,
      );
      continue;
    }

    const qualifier = namedQualifier(text, citation.index + citation.raw.length);
    if (qualifier === null) continue;

    const key = `${citation.id} ${qualifier}`;
    if (!named.has(key)) named.set(key, { id: citation.id, qualifier, locations: [] });
    named.get(key).locations.push(`${relativePath}:${lineOf(text, citation.index)}`);
  }

  for (const range of ranges) {
    const where = `${relativePath}:${lineOf(text, range.index)}`;

    if (!range.ascending) {
      findings.fail(
        'range-citation-not-ascending',
        `${where} cites the range ${range.raw}, whose endpoints do not ascend`,
      );
      continue;
    }

    const missingEndpoints = [range.startId, range.endId].filter((id) => !byId.has(id));
    if (missingEndpoints.length > 0) {
      findings.fail(
        'range-citation-endpoint-missing',
        `${where} cites the range ${range.raw}, whose endpoint(s) ${missingEndpoints.join(', ')} have no record`,
      );
      continue;
    }

    const missingInterior = expandRange(range.startId, range.endId).filter((id) => !byId.has(id));
    if (missingInterior.length > 0) {
      findings.fail(
        'range-citation-gap',
        `${where} cites the range ${range.raw}, but ${missingInterior.length} identifier(s) inside it have no record`,
        { missing: missingInterior },
      );
    }
  }

  return { bare: bare.length, ranges: ranges.length, named };
}

/**
 * Named-clause citations get a deterministic report, never a pass or fail verdict.
 *
 * "D081 idempotency intent", "D099 ENE separation", "D106 ceiling" and "D129 stop" name a
 * clause inside a decision. Proving that the named clause still says what the citing document
 * assumes is a semantic judgement, and no mechanical check can do it honestly. The harness
 * therefore resolves the identifier — which it can prove — and hands the qualifier to a human.
 */
function reportNamedCitations({ named, findings }) {
  const sorted = [...named.values()].sort(
    (a, b) => idToNumber(a.id) - idToNumber(b.id) || a.qualifier.localeCompare(b.qualifier),
  );

  for (const entry of sorted) {
    findings.review(
      'named-clause-citation',
      `"${entry.id} ${entry.qualifier}" names a clause inside ${entry.id}`,
      {
        occurrences: entry.locations.length,
        firstSeen: entry.locations[0],
        note: 'Identifier resolves. Whether the named clause is still present and unchanged is a reviewer judgement.',
      },
    );
  }
}
