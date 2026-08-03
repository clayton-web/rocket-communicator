/**
 * Owner date and time presentation (P1.4 / D117).
 *
 * One authority for every Owner-facing timestamp. Pure: no I/O, no environment reads, no
 * clock access beyond what a caller passes in, so it renders identically on the server and
 * in the browser and can be unit-tested under any process timezone.
 *
 * Not a scheduling module. Nothing here computes a next reminder, a recurrence, or a
 * business-day offset. Reminder scheduling lives in the domain package and must stay there:
 * a display helper that quietly did date arithmetic would become a second, untested source
 * of scheduling truth (D117, and the `due_soon`/`overdue` note in STATE_MACHINE.md).
 */

/**
 * The Owner organization's display timezone.
 *
 * D117 requires Owner timestamps to render in the organization's timezone rather than the
 * viewer's or the server's. There is no `Organization` model and no timezone column in the
 * Prisma schema, and P1.4 must not add one, so this is a documented constant for the current
 * single-organization deployment.
 *
 * Deliberately not an environment variable: an env-var timezone can differ between the
 * server that renders a date and the developer who reads a log, and a typo would silently
 * change what every timestamp means. When a second organization exists, this becomes a
 * per-organization field and this constant becomes its default — that is a schema change and
 * belongs to whichever slice introduces multi-organization support.
 */
export const OWNER_DISPLAY_TIME_ZONE = 'America/Vancouver';

/**
 * Rendered when a timestamp cannot be interpreted. Shown instead of a fabricated date,
 * because an invalid instant displayed as "Jan 1, 1970" would be a confident lie.
 */
export const UNKNOWN_DATE_TEXT = 'Unknown date';

/**
 * Fail loudly if the configured timezone is not a real IANA zone.
 *
 * `Intl.DateTimeFormat` throws a `RangeError` for an unknown `timeZone`, but only when the
 * formatter is constructed. Without this check a bad constant would surface as a render
 * crash on an arbitrary page rather than as a clear configuration error, and — worse — a
 * `try`/`catch` around formatting would silently fall back to machine-local time, which is
 * exactly the drift D117 exists to prevent.
 */
function assertSupportedTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
  } catch {
    throw new Error(
      `Owner display timezone "${timeZone}" is not a supported IANA time zone. ` +
        'Owner timestamps must not fall back to machine-local time (D117).',
    );
  }
}

assertSupportedTimeZone(OWNER_DISPLAY_TIME_ZONE);

/**
 * Date only, for instants where a time of day would add noise rather than meaning — a due
 * date, a waiting-until date. No timezone label: no time is shown, so there is nothing for a
 * label to disambiguate.
 */
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: OWNER_DISPLAY_TIME_ZONE,
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

/**
 * Date and time.
 *
 * `timeZoneName: 'short'` is required, not decorative: a bare "2:30 p.m." is ambiguous to
 * anyone who does not already know which zone the application renders in, and it is exactly
 * the reading a Recipient or a support conversation gets wrong. It also resolves daylight
 * saving automatically — PST and PDT are distinguished by `Intl` from the instant itself, so
 * no offset arithmetic appears anywhere in this module.
 */
const dateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: OWNER_DISPLAY_TIME_ZONE,
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

/**
 * Calendar dates, formatted in UTC on purpose (A8.6a).
 *
 * A `YYYY-MM-DD` due date is not an instant. It is already a date in the organization's zone — the
 * Owner picked a day, and D103 stores that day verbatim rather than a moment — so converting it
 * *again* is not a no-op, it is an off-by-one. `Date.parse('2026-08-10')` yields UTC midnight, and
 * rendering that instant in `America/Vancouver` lands on the evening of the 9th, so the Owner is
 * shown a due date one day earlier than the one they saved.
 *
 * Formatting in UTC after parsing the parts in UTC makes the two conversions cancel, which is the
 * whole trick: the calendar date comes back out unchanged, for every zone and across every
 * daylight-saving boundary.
 */
const localDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Format a canonical `YYYY-MM-DD` organization-local date for display, or `UNKNOWN_DATE_TEXT`.
 *
 * Rejects anything that is not exactly a canonical local date rather than coercing it, including a
 * full ISO instant: an instant reaching this function means a caller confused the two date kinds,
 * and silently rendering its UTC day would hide that behind a plausible-looking answer. Round-trips
 * the parsed components to reject a real-looking impossible day such as `2026-02-30`, which the
 * `Date` constructor would otherwise roll forward into March.
 */
export function formatOwnerLocalDate(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return UNKNOWN_DATE_TEXT;
  }
  const match = LOCAL_DATE_PATTERN.exec(value.trim());
  if (match === null) {
    return UNKNOWN_DATE_TEXT;
  }

  const [, year, month, day] = match;
  const instant = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    instant.getUTCFullYear() !== Number(year) ||
    instant.getUTCMonth() !== Number(month) - 1 ||
    instant.getUTCDate() !== Number(day)
  ) {
    return UNKNOWN_DATE_TEXT;
  }

  return localDateFormatter.format(instant);
}

function parseInstant(value: string | null | undefined): Date | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

/** Format an ISO instant as an Owner-timezone date, or `UNKNOWN_DATE_TEXT`. */
export function formatOwnerDate(value: string | null | undefined): string {
  const instant = parseInstant(value);
  return instant === null ? UNKNOWN_DATE_TEXT : dateFormatter.format(instant);
}

/**
 * Format an ISO instant as an Owner-timezone date and time, including a timezone indicator,
 * or `UNKNOWN_DATE_TEXT`.
 */
export function formatOwnerDateTime(value: string | null | undefined): string {
  const instant = parseInstant(value);
  return instant === null ? UNKNOWN_DATE_TEXT : dateTimeFormatter.format(instant);
}

/** Whether an instant can be rendered at all, for callers that omit a field entirely. */
export function isRenderableInstant(value: string | null | undefined): boolean {
  return parseInstant(value) !== null;
}
