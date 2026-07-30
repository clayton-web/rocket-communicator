/**
 * Task note presentation (P1.4).
 *
 * Pure and dependency-free. The limit is restated here rather than imported from `@aicaa/db`
 * on purpose: `@aicaa/db` is a Node-only package carrying the Prisma client, and pulling it
 * into a rendering module would link the query engine into the component import graph for the
 * sake of one integer.
 *
 * The two values must not drift, so `p1-4-presentation.test.ts` imports the database constant
 * and asserts they are equal. That keeps the coupling checked without making it structural.
 */

/** Mirror of `TASK_DETAIL_NOTE_LIMIT` in `@aicaa/db`; equality is asserted by test. */
export const OWNER_TASK_NOTE_DISPLAY_LIMIT = 100;

/**
 * Truthful wording for a note list that may have been bounded by the query limit.
 *
 * Returns `null` below the limit, where nothing needs saying.
 *
 * At exactly the limit the honest statement is what was shown, not what was withheld: the Task
 * might have exactly this many notes, or more. Saying "more notes exist" would be a guess, and
 * knowing for certain would require a truncation flag on the response — an OpenAPI change P1.4
 * is not authorized to make.
 */
export function noteBoundNotice(noteCount: number): string | null {
  if (noteCount < OWNER_TASK_NOTE_DISPLAY_LIMIT) {
    return null;
  }
  return `Showing up to the ${OWNER_TASK_NOTE_DISPLAY_LIMIT} most recent notes.`;
}
