-- ---------------------------------------------------------------------------
-- D181 Messages Review persistence
-- ---------------------------------------------------------------------------
--
-- Additive and forward-only. Makes CommunicationEvent.account_id nullable so a Google Messages
-- Review can persist a canonical event without a synthetic CommunicationAccount. Adds
-- `google_messages` to InterpretationSourceKind. Existing Gmail rows are unchanged: every current
-- Gmail event keeps its account_id, and a CHECK keeps Gmail events requiring an account while
-- Google Messages events must not have one.
--
-- A6 claim/lease columns are not rewritten. Application claim queries remain Gmail-only.
-- No second SMS archive, no Exclude Number store, and no Production data change.

-- ---------------------------------------------------------------------------
-- CommunicationEvent.account_id may be null for non-Gmail sources (D181)
-- ---------------------------------------------------------------------------

ALTER TABLE "communication_events"
  ALTER COLUMN "account_id" DROP NOT NULL;

ALTER TABLE "communication_events"
  ADD CONSTRAINT "communication_events_account_id_source_chk"
  CHECK (
    (source_type = 'gmail' AND account_id IS NOT NULL)
    OR (source_type = 'google_messages' AND account_id IS NULL)
    OR (source_type <> 'gmail' AND source_type <> 'google_messages')
  );

-- ---------------------------------------------------------------------------
-- InterpretationSourceKind: authorized Google Messages provenance (D181)
-- ---------------------------------------------------------------------------

ALTER TYPE "InterpretationSourceKind" ADD VALUE 'google_messages';
