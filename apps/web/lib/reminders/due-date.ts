/** Canonical organization-local calendar date, exactly the shape the reminder contract accepts. */
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reject a due date the server would reject, without restating the server's rules (A8.6b).
 *
 * Deliberately shallow. It checks shape and calendar reality, and nothing else: whether a date is
 * permitted for *this* Task is a domain question the route answers, and a client that tried to
 * predict it would eventually forbid something the server allows.
 *
 * The date never becomes a `Date` in the browser's timezone. It is compared as text and, for the
 * calendar-reality check, constructed in UTC and read back in UTC, so no local-midnight arithmetic
 * can shift `2026-09-01` to the thirty-first of August for an Owner east of the organization —
 * the failure mode a naive `new Date(value)` round-trip produces (D117, D122).
 *
 * A well-behaved `<input type="date">` blanks an impossible date before it reaches here, which is
 * why the empty case gets its own sentence. The calendar check still earns its place: the value can
 * also arrive from a paste, an autofill, or a browser whose date control is a plain text field.
 */
export function dueDateProblem(value: string): string | null {
  if (value === '') {
    return 'Choose a due date.';
  }
  if (!LOCAL_DATE_PATTERN.test(value)) {
    return 'Enter the due date as a calendar date.';
  }

  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const instant = new Date(Date.UTC(year, month - 1, day));
  if (
    instant.getUTCFullYear() !== year ||
    instant.getUTCMonth() !== month - 1 ||
    instant.getUTCDate() !== day
  ) {
    return 'That is not a real calendar date.';
  }

  return null;
}
