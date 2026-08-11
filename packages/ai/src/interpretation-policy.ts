/**
 * Fixed interpretation policy / structured-output contract for context-free input.
 * Versioned separately from A6 EXTRACTION_SCHEMA_INSTRUCTION.
 */

export const INTERPRETATION_SCHEMA_INSTRUCTION = `Return ONLY a JSON object (no markdown fences, no prose) with this exact shape:
{
  "tasks": [
    {
      "summaryPoints": [ /* 1-20 points per task */ ],
      "peopleHints": [ /* zero or more grounded person names */ ],
      "deadlineExpression": string|null
    }
  ]
}

Rules:
- tasks may be empty ([]). Empty tasks means no actionable commitments were found — that is success.
- tasks may contain 1..10 distinct actionable proposals. Prefer splitting independent commitments into separate tasks.
- Do NOT invent tasks unsupported by the input. Non-actionable chatter must not become a task.
- Do NOT invent facts, people, email addresses, recipients, deadlines, amounts, priorities, reminder times, assignment decisions, or completion state.
- Do NOT propose reminders or reminder schedules.
- Do NOT resolve peopleHints to recipients or email addresses. peopleHints are display names grounded in the input only (e.g. "Sharon"). Never invent emails.
- deadlineExpression must preserve the grounded source phrasing when present (e.g. "tomorrow afternoon"). Use null when the input has no grounded deadline. Do NOT invent absolute timestamps. Do NOT invent deadlines.
- Prefer request, next_action, or commitment summaryPoints for actionable work. Each proposed task MUST include at least one such actionable point.
- Do NOT emit deadline-kind summaryPoints for relative phrases; put relative phrasing only in deadlineExpression.
- Prefer not to emit inference points or numeric confidence. Do not invent candidate-level precision.
- Card titles are derived later from summaryPoints — do not invent a separate title field.

Each summaryPoints entry MUST include:
- "id": string (never a number; e.g. "sp_1")
- "kind": one of confirmed_fact|request|commitment|amount|deadline|risk|inference|missing_information|next_action
- "label": string (max 120 chars)
- "order": integer (0-based)

Kind-specific REQUIRED fields:
- confirmed_fact|request|commitment|risk|next_action: "value" (string, max 500) — use "value", NOT "details"/"text"
- inference: "value" (string) AND "confidence" (number 0-1)
- missing_information: "missingItem" (string)
- amount: "amount" (number) AND "currency" (string, e.g. "USD")
- deadline: optional "dueAt" (ISO-8601) and/or "localDate" (YYYY-MM-DD) and/or "timezone" — only when explicitly supported; prefer deadlineExpression for relative phrases

Example (two independent tasks):
{
  "tasks": [
    {
      "summaryPoints": [
        {"id":"sp_1","kind":"next_action","label":"Call","order":0,"value":"Call Sharon about the price"}
      ],
      "peopleHints": ["Sharon"],
      "deadlineExpression": "tomorrow"
    },
    {
      "summaryPoints": [
        {"id":"sp_1","kind":"next_action","label":"Send","order":0,"value":"Send Kevin the updated numbers"}
      ],
      "peopleHints": ["Kevin"],
      "deadlineExpression": null
    }
  ]
}`;
