-- ---------------------------------------------------------------------------
-- D178: Owner preference for the existing D105 advance occurrence
-- ---------------------------------------------------------------------------
--
-- Additive and backwards-compatible. One boolean on the existing Task Reminder Schedule; no new
-- table, no planned-occurrence table, no new occurrence kind, no second reminder engine.
--
-- Existing rows receive true via DEFAULT, matching current A8: every previously established
-- schedule armed D105 when the window was still open. New establishments without an explicit
-- preference also default ON. OFF is an explicit Owner act.
--
-- Distinct from due_local_date (the deadline), status (Waiting/stopped), advance_disposition
-- (occurrence outcome), assignment, and D168 responsibility evidence. D106 overdue columns are
-- untouched.
--
-- `not_enabled` records that the preference left the D105 occurrence unarmed. It is not a fake
-- window skip, not Waiting, and not a stopped schedule. The advance due-scan already selects
-- `advance_disposition = 'scheduled'` only, so OFF rows are not claimable without a worker change.
ALTER TABLE "task_reminder_schedules"
  ADD COLUMN "advance_enabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TYPE "ReminderAdvanceDisposition" ADD VALUE IF NOT EXISTS 'not_enabled';
