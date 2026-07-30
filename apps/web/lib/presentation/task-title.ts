import type { components } from '@aicaa/contracts/schema';

type TaskSummaryPoint = components['schemas']['TaskSummaryPoint'];

/**
 * Task title derivation (P1.4).
 *
 * A Task has no title field — it has summary points — so every surface that needs to name a
 * Task derives one. Before P1.4 the Owner list, the Owner detail heading, and the Recipient
 * capability page each derived it differently, which meant the same Task could be called
 * three things depending on where you looked.
 *
 * Pure and dependency-free so it can be shared by server components, client components, and
 * the Recipient capability surface without dragging anything with it.
 */

/** Longest rendered title before truncation, in characters. */
const MAX_TITLE_LENGTH = 120;

/** Text of a summary point, whichever variant it is. */
export function summaryPointText(point: TaskSummaryPoint): string {
  if ('value' in point && typeof point.value === 'string' && point.value.trim() !== '') {
    return point.value.trim();
  }
  return typeof point.label === 'string' ? point.label.trim() : '';
}

/**
 * A stable, human-meaningful name for a Task.
 *
 * Uses the first summary point that actually carries text, rather than strictly the first
 * point: a leading point with an empty value would otherwise produce a blank heading.
 *
 * Falls back to a short identifier prefix. The fallback must stay deterministic — the same
 * Task always yields the same title — because it appears in headings, links, and confirmation
 * copy, and an unstable one would look like the Task had changed.
 */
export function deriveTaskTitle(task: { id: string; summaryPoints: TaskSummaryPoint[] }): string {
  for (const point of task.summaryPoints) {
    const text = summaryPointText(point);
    if (text !== '') {
      return text.length > MAX_TITLE_LENGTH ? `${text.slice(0, MAX_TITLE_LENGTH - 1)}…` : text;
    }
  }

  // Matches the pre-P1.4 fallback exactly, so no existing Task is renamed by this refactor.
  return `Task ${task.id.slice(0, 8)}`;
}
