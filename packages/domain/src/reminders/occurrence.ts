/**
 * Resolving organization-local wall-clock times to absolute instants (A8.2, D103).
 *
 * Two directions, both requiring an **explicit** IANA zone:
 *
 * - a local calendar date plus a wall-clock hour becomes the UTC instant a reminder executes at;
 * - a UTC instant becomes the local calendar date it falls on.
 *
 * The zone is always a parameter. There is no default, no fallback, and no read of the process
 * or machine timezone anywhere in this module: a leaked machine zone would not fail loudly, it
 * would quietly send every reminder at the wrong hour, and on a server in a different zone it
 * would send on the wrong *day* (D103).
 *
 * `Intl.DateTimeFormat` is the only timezone authority used, because it is backed by the
 * runtime's IANA database and therefore already knows every historical and future transition.
 * No timezone dependency is added.
 */

import { DomainError, validationError } from '../errors/domain-errors.js';
import { parseUtcInstant, toUtcInstant, type UtcInstant } from '../types/timestamps.js';
import { localDateFromParts, localDateParts, type LocalDate } from './local-date.js';

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

/**
 * How far either side of the target the zone offset is sampled.
 *
 * Wider than the largest real UTC offset (±14 hours), so the true instant always lies inside the
 * sampled span and a transition adjacent to the target is observed from both sides. Narrow
 * enough that no real zone has two transitions within it.
 */
const OFFSET_PROBE_WINDOW_MS = 26 * MS_PER_HOUR;

/**
 * Iteration bound for the transition search.
 *
 * A halving search over a gap of at most a few hours converges in roughly 23 steps; 64 leaves
 * generous headroom for an unusual zone without ever looping unboundedly. Reaching the bound is
 * treated as a failure to resolve, not as a result — this module must not guess. There is
 * deliberately no assumption that a fixed number of offset-correction passes suffices.
 */
const MAX_TRANSITION_SEARCH_STEPS = 64;

/**
 * How a requested wall-clock time related to the zone's transitions.
 *
 * - `exact` — the requested wall time exists once.
 * - `skipped_forward` — it does not exist (a forward transition jumped over it); the resolved
 *   instant is the first valid instant at or after it.
 * - `repeated_earliest` — it exists twice (a backward transition repeated it); the resolved
 *   instant is the earlier of the two.
 */
export type LocalWallClockResolutionKind = 'exact' | 'skipped_forward' | 'repeated_earliest';

export interface LocalWallClockInput {
  readonly localDate: LocalDate;
  readonly hour: number;
  readonly minute?: number;
  /** Explicit IANA zone. Required: there is no implicit organization or machine zone here. */
  readonly timeZone: string;
}

export interface LocalWallClockResolution {
  readonly instant: UtcInstant;
  readonly epochMs: number;
  readonly kind: LocalWallClockResolutionKind;
  readonly timeZone: string;
  readonly requestedLocalDate: LocalDate;
  readonly requestedHour: number;
  readonly requestedMinute: number;
  /**
   * The wall-clock fields the resolved instant actually lands on. Equal to the request for
   * `exact` and `repeated_earliest`; later than the request for `skipped_forward`. Recorded so a
   * caller can state truthfully what was scheduled rather than what was asked for.
   */
  readonly resolvedLocalDate: LocalDate;
  readonly resolvedHour: number;
  readonly resolvedMinute: number;
}

interface ZonedFields {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/**
 * Formatters are memoized because constructing one is orders of magnitude more expensive than
 * formatting with it, and the transition search formats dozens of instants in the same zone.
 * The cache is keyed by zone and holds no request state, so it cannot change a result.
 */
const zonedFormatters = new Map<string, Intl.DateTimeFormat>();

function zonedFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = zonedFormatters.get(timeZone);
  if (cached !== undefined) {
    return cached;
  }

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    // An unknown zone must fail loudly. A catch that fell back to the default zone would
    // reintroduce exactly the machine-local dependency D103 forbids.
    throw validationError(`Scheduling timezone "${timeZone}" is not a supported IANA time zone.`, [
      { field: 'timeZone', message: 'Unsupported IANA time zone.' },
    ]);
  }

  zonedFormatters.set(timeZone, formatter);
  return formatter;
}

function resolutionFailure(message: string): DomainError {
  return new DomainError('INTERNAL_ERROR', message);
}

function zonedFieldsAt(epochMs: number, timeZone: string): ZonedFields {
  const parts = zonedFormatter(timeZone).formatToParts(new Date(epochMs));
  const field = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    if (part === undefined) {
      throw resolutionFailure(`Timezone "${timeZone}" produced no ${type} field.`);
    }
    const numeric = Number(part.value);
    if (!Number.isInteger(numeric)) {
      throw resolutionFailure(`Timezone "${timeZone}" produced a non-numeric ${type} field.`);
    }
    return numeric;
  };

  const hour = field('hour');
  return {
    year: field('year'),
    month: field('month'),
    day: field('day'),
    // Some runtimes report midnight as hour 24 rather than 0.
    hour: hour === 24 ? 0 : hour,
    minute: field('minute'),
    second: field('second'),
  };
}

/** Calendar fields read as if they were UTC — the standard offset-measurement trick. */
function fieldsAsUtcMs(fields: ZonedFields): number {
  return Date.UTC(
    fields.year,
    fields.month - 1,
    fields.day,
    fields.hour,
    fields.minute,
    fields.second,
  );
}

/** The zone's UTC offset, in milliseconds, in effect at `epochMs`. */
function zoneOffsetMsAt(epochMs: number, timeZone: string): number {
  return fieldsAsUtcMs(zonedFieldsAt(epochMs, timeZone)) - epochMs;
}

function assertWholeNumberInRange(
  value: number,
  min: number,
  max: number,
  field: string,
  label: string,
): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw validationError(`${label} must be a whole number between ${min} and ${max}.`, [
      { field, message: `${label} must be a whole number between ${min} and ${max}.` },
    ]);
  }
}

/**
 * The first instant at or after a wall-clock time that a forward transition skipped.
 *
 * The requested wall time never occurs, so no offset reproduces it. What does exist is the
 * transition itself: the moment the local clock jumps from before the requested time to after
 * it. It is found by halving the interval between the instant computed with the pre-transition
 * offset and the one computed with the post-transition offset, which brackets the boundary.
 */
function firstInstantAfterSkippedWallClock(
  targetAsUtcMs: number,
  candidateOffsetsMs: readonly number[],
  timeZone: string,
): number {
  const offsetBeforeMs = Math.min(...candidateOffsetsMs);
  const offsetAfterMs = Math.max(...candidateOffsetsMs);
  if (offsetBeforeMs === offsetAfterMs) {
    throw resolutionFailure(
      `Wall-clock time is unreachable in "${timeZone}" but the zone reports no transition near it.`,
    );
  }

  let low = targetAsUtcMs - offsetAfterMs;
  let high = targetAsUtcMs - offsetBeforeMs;
  if (
    zoneOffsetMsAt(low, timeZone) !== offsetBeforeMs ||
    zoneOffsetMsAt(high, timeZone) !== offsetAfterMs
  ) {
    throw resolutionFailure(
      `Could not bracket the timezone transition for "${timeZone}" near the requested wall-clock time.`,
    );
  }

  let steps = 0;
  while (high - low > 1) {
    if (steps >= MAX_TRANSITION_SEARCH_STEPS) {
      throw resolutionFailure(
        `Timezone transition search in "${timeZone}" exceeded ${MAX_TRANSITION_SEARCH_STEPS} steps.`,
      );
    }
    steps += 1;
    const middle = low + Math.floor((high - low) / 2);
    if (zoneOffsetMsAt(middle, timeZone) === offsetAfterMs) {
      high = middle;
    } else {
      low = middle;
    }
  }

  return high;
}

/**
 * Resolve a local calendar date and wall-clock time in an explicit IANA zone to a UTC instant.
 *
 * Candidate instants are derived from the offsets the zone actually reports around the target and
 * then **verified** by reading their local fields back: an offset alone is not trusted. The
 * verification is what makes the transition cases deterministic rather than incidental.
 *
 * @throws DomainError `VALIDATION_ERROR` for an unsupported zone or out-of-range wall-clock
 * fields, `INTERNAL_ERROR` when the bounded search cannot produce a verified instant.
 */
export function resolveLocalWallClock(input: LocalWallClockInput): LocalWallClockResolution {
  const { localDate, hour, timeZone } = input;
  const minute = input.minute ?? 0;
  assertWholeNumberInRange(hour, 0, 23, 'hour', 'Wall-clock hour');
  assertWholeNumberInRange(minute, 0, 59, 'minute', 'Wall-clock minute');

  const { year, month, day } = localDateParts(localDate);
  const targetAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0);

  const candidateOffsetsMs = [
    ...new Set(
      [
        targetAsUtcMs - OFFSET_PROBE_WINDOW_MS,
        targetAsUtcMs,
        targetAsUtcMs + OFFSET_PROBE_WINDOW_MS,
      ].map((probe) => zoneOffsetMsAt(probe, timeZone)),
    ),
  ];

  const verified = [...new Set(candidateOffsetsMs.map((offset) => targetAsUtcMs - offset))]
    .filter((candidate) => {
      const fields = zonedFieldsAt(candidate, timeZone);
      return (
        fields.year === year &&
        fields.month === month &&
        fields.day === day &&
        fields.hour === hour &&
        fields.minute === minute &&
        fields.second === 0
      );
    })
    .sort((left, right) => left - right);

  if (verified.length > 0) {
    // More than one verified instant means a backward transition repeated the wall time; the
    // earliest is chosen so the same request always resolves to the same instant.
    const epochMs = verified[0];
    return buildResolution({
      epochMs,
      kind: verified.length > 1 ? 'repeated_earliest' : 'exact',
      timeZone,
      requestedLocalDate: localDate,
      requestedHour: hour,
      requestedMinute: minute,
    });
  }

  return buildResolution({
    epochMs: firstInstantAfterSkippedWallClock(targetAsUtcMs, candidateOffsetsMs, timeZone),
    kind: 'skipped_forward',
    timeZone,
    requestedLocalDate: localDate,
    requestedHour: hour,
    requestedMinute: minute,
  });
}

function buildResolution(input: {
  epochMs: number;
  kind: LocalWallClockResolutionKind;
  timeZone: string;
  requestedLocalDate: LocalDate;
  requestedHour: number;
  requestedMinute: number;
}): LocalWallClockResolution {
  const fields = zonedFieldsAt(input.epochMs, input.timeZone);
  return {
    instant: toUtcInstant(new Date(input.epochMs)),
    epochMs: input.epochMs,
    kind: input.kind,
    timeZone: input.timeZone,
    requestedLocalDate: input.requestedLocalDate,
    requestedHour: input.requestedHour,
    requestedMinute: input.requestedMinute,
    resolvedLocalDate: localDateFromParts(fields.year, fields.month, fields.day),
    resolvedHour: fields.hour,
    resolvedMinute: fields.minute,
  };
}

/** The local calendar date an instant falls on, in an explicit IANA zone. */
export function localDateOfInstant(instant: UtcInstant, timeZone: string): LocalDate {
  const fields = zonedFieldsAt(parseUtcInstant(instant).getTime(), timeZone);
  return localDateFromParts(fields.year, fields.month, fields.day);
}
