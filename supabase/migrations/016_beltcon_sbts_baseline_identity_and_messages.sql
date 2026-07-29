-- BELTCON SBTS Baseline V1 identity and semantic-message foundation.
--
-- This is deliberately additive. It preserves the legacy screening simulator
-- and does not implement BHS ingestion, acknowledgements, Profinet, or HBSS
-- serial I/O. Phase 3 will write the strict baseline fields atomically.

ALTER TABLE public.bags
  ADD COLUMN IF NOT EXISTS bhs_line_id TEXT,
  ADD COLUMN IF NOT EXISTS screening_evaluation TEXT,
  ADD COLUMN IF NOT EXISTS screening_evaluation_raw TEXT,
  ADD COLUMN IF NOT EXISTS rfid_tag_barcode TEXT,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bags_beltcon_sbts_bhs_uid_format'
      AND conrelid = 'public.bags'::regclass
  ) THEN
    -- Legacy rows do not carry a raw BHS evaluation. Once a Phase 3 semantic
    -- BHS message supplies one, its external BagID must meet the V1 contract.
    ALTER TABLE public.bags
      ADD CONSTRAINT bags_beltcon_sbts_bhs_uid_format
      CHECK (
        screening_evaluation_raw IS NULL
        OR (
          bhs_uid IS NOT NULL
          AND octet_length(bhs_uid) = 10
          AND char_length(bhs_uid) = 10
          AND bhs_uid ~ '^[ -~]{10}$'
          AND btrim(bhs_uid) <> ''
          AND bhs_uid <> id
          AND bhs_uid !~* '^ETB-'
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bags_beltcon_sbts_bhs_line_id_format'
      AND conrelid = 'public.bags'::regclass
  ) THEN
    ALTER TABLE public.bags
      ADD CONSTRAINT bags_beltcon_sbts_bhs_line_id_format
      CHECK (
        bhs_line_id IS NULL
        OR (
          octet_length(bhs_line_id) = 2
          AND char_length(bhs_line_id) = 2
          AND bhs_line_id ~ '^[ -~]{2}$'
          AND bhs_line_id = btrim(bhs_line_id)
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bags_beltcon_sbts_screening_evaluation_pair'
      AND conrelid = 'public.bags'::regclass
  ) THEN
    ALTER TABLE public.bags
      ADD CONSTRAINT bags_beltcon_sbts_screening_evaluation_pair
      CHECK (
        (screening_evaluation_raw IS NULL AND screening_evaluation IS NULL)
        OR (screening_evaluation_raw = 'A' AND screening_evaluation = 'ACCEPT')
        OR (screening_evaluation_raw = 'R' AND screening_evaluation = 'REJECT')
        OR (screening_evaluation_raw = 'T' AND screening_evaluation = 'TIMEOUT')
        OR (screening_evaluation_raw = 'N' AND screening_evaluation = 'NO_DECISION')
        OR (screening_evaluation_raw = '?' AND screening_evaluation = 'MISTRACK')
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bags_beltcon_sbts_iata_lpc_format'
      AND conrelid = 'public.bags'::regclass
  ) THEN
    ALTER TABLE public.bags
      ADD CONSTRAINT bags_beltcon_sbts_iata_lpc_format
      CHECK (iata_code IS NULL OR iata_code ~ '^[0-9]{10}$') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bags_beltcon_sbts_rfid_tag_barcode_format'
      AND conrelid = 'public.bags'::regclass
  ) THEN
    ALTER TABLE public.bags
      ADD CONSTRAINT bags_beltcon_sbts_rfid_tag_barcode_format
      CHECK (
        rfid_tag_barcode IS NULL
        OR (
          btrim(rfid_tag_barcode) <> ''
          AND char_length(rfid_tag_barcode) <= 128
          AND rfid_tag_barcode !~ '[[:cntrl:]]'
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bags_beltcon_sbts_version_minimum'
      AND conrelid = 'public.bags'::regclass
  ) THEN
    ALTER TABLE public.bags
      ADD CONSTRAINT bags_beltcon_sbts_version_minimum
      CHECK (version >= 1);
  END IF;
END
$$;

-- Existing deployed uniqueness is source-system plus BHS BagID. The airport
-- has not yet confirmed whether future BHS BagIDs are global or line/site scoped.
COMMENT ON INDEX public.idx_bags_source_bhs_uid IS
  'Current BHS BagID uniqueness scope is (source_system, bhs_uid). Do not change scope without airport/vendor confirmation.';

CREATE INDEX IF NOT EXISTS idx_bags_beltcon_sbts_tagging_queue
ON public.bags(screening_evaluation, bhs_line_id, flagged_at ASC, id ASC)
WHERE status = 'IDENTIFIED';

CREATE INDEX IF NOT EXISTS idx_bags_rfid_tag_barcode
ON public.bags(rfid_tag_barcode)
WHERE rfid_tag_barcode IS NOT NULL;

COMMENT ON COLUMN public.bags.bhs_uid IS
  'External BHS BagID used to correlate BHS, screening, RFID and HBSS recall. Must never be replaced by the internal ETB display ID.';
COMMENT ON COLUMN public.bags.iata_code IS
  'Optional ten-digit IATA baggage Licence Plate Code. Not an airport code.';
COMMENT ON COLUMN public.bags.epc IS
  'RFID electronic identifier associated with the bag.';
COMMENT ON COLUMN public.bags.rfid_tag_barcode IS
  'Barcode printed on/scanned from the physical RFID label. Distinct from EPC.';
COMMENT ON COLUMN public.bags.bhs_line_id IS
  'Two-character BHS line identifier received from the BHS message.';
COMMENT ON COLUMN public.bags.screening_evaluation IS
  'Normalized screening result used by BELTCON SBTS.';
COMMENT ON COLUMN public.bags.screening_evaluation_raw IS
  'Original one-character screening evaluation received from BHS.';
COMMENT ON COLUMN public.bags.version IS
  'Optimistic-lock version for future authoritative mutations.';

ALTER TABLE public.screening_integration_events
  ADD COLUMN IF NOT EXISTS protocol_name TEXT,
  ADD COLUMN IF NOT EXISTS protocol_version TEXT,
  ADD COLUMN IF NOT EXISTS message_type INTEGER,
  ADD COLUMN IF NOT EXISTS message_direction TEXT,
  ADD COLUMN IF NOT EXISTS bhs_line_id TEXT,
  ADD COLUMN IF NOT EXISTS screening_evaluation TEXT,
  ADD COLUMN IF NOT EXISTS screening_evaluation_raw TEXT,
  ADD COLUMN IF NOT EXISTS message_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS acknowledgement_outcome TEXT,
  ADD COLUMN IF NOT EXISTS acknowledgement_timing TEXT,
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processing_attempt_count INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'screening_events_beltcon_sbts_message_type'
      AND conrelid = 'public.screening_integration_events'::regclass
  ) THEN
    ALTER TABLE public.screening_integration_events
      ADD CONSTRAINT screening_events_beltcon_sbts_message_type
      CHECK (message_type IS NULL OR message_type IN (2001, 2002)) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'screening_events_beltcon_sbts_message_direction'
      AND conrelid = 'public.screening_integration_events'::regclass
  ) THEN
    ALTER TABLE public.screening_integration_events
      ADD CONSTRAINT screening_events_beltcon_sbts_message_direction
      CHECK (message_direction IS NULL OR message_direction IN ('INBOUND', 'OUTBOUND')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'screening_events_beltcon_sbts_protocol_name'
      AND conrelid = 'public.screening_integration_events'::regclass
  ) THEN
    ALTER TABLE public.screening_integration_events
      ADD CONSTRAINT screening_events_beltcon_sbts_protocol_name
      CHECK (
        protocol_name IS NULL
        OR protocol_name IN ('LEGACY_SCREENING_JSON', 'BELTCON_SBTS_SEMANTIC_V1', 'PROFINET', 'SIMULATED')
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'screening_events_beltcon_sbts_evaluation_pair'
      AND conrelid = 'public.screening_integration_events'::regclass
  ) THEN
    ALTER TABLE public.screening_integration_events
      ADD CONSTRAINT screening_events_beltcon_sbts_evaluation_pair
      CHECK (
        (screening_evaluation_raw IS NULL AND screening_evaluation IS NULL)
        OR (screening_evaluation_raw = 'A' AND screening_evaluation = 'ACCEPT')
        OR (screening_evaluation_raw = 'R' AND screening_evaluation = 'REJECT')
        OR (screening_evaluation_raw = 'T' AND screening_evaluation = 'TIMEOUT')
        OR (screening_evaluation_raw = 'N' AND screening_evaluation = 'NO_DECISION')
        OR (screening_evaluation_raw = '?' AND screening_evaluation = 'MISTRACK')
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'screening_events_beltcon_sbts_acknowledgement'
      AND conrelid = 'public.screening_integration_events'::regclass
  ) THEN
    ALTER TABLE public.screening_integration_events
      ADD CONSTRAINT screening_events_beltcon_sbts_acknowledgement
      CHECK (
        (acknowledgement_outcome IS NULL AND acknowledgement_timing IS NULL)
        OR (
          acknowledgement_outcome IN ('ACCEPTED', 'DUPLICATE', 'REJECTED', 'FAILED')
          AND acknowledgement_timing = 'AFTER_DURABLE_COMMIT'
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'screening_events_beltcon_sbts_acknowledged_at'
      AND conrelid = 'public.screening_integration_events'::regclass
  ) THEN
    ALTER TABLE public.screening_integration_events
      ADD CONSTRAINT screening_events_beltcon_sbts_acknowledged_at
      CHECK (
        acknowledged_at IS NULL
        OR (
          acknowledgement_outcome IS NOT NULL
          AND acknowledged_at >= received_at
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'screening_events_beltcon_sbts_attempt_count'
      AND conrelid = 'public.screening_integration_events'::regclass
  ) THEN
    ALTER TABLE public.screening_integration_events
      ADD CONSTRAINT screening_events_beltcon_sbts_attempt_count
      CHECK (processing_attempt_count >= 0);
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_screening_events_bhs_message_fingerprint
ON public.screening_integration_events(source_system, message_fingerprint)
WHERE message_type = 2001
  AND message_fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_screening_events_beltcon_sbts_lookup
ON public.screening_integration_events(source_system, message_type, processing_status, received_at);

COMMENT ON COLUMN public.screening_integration_events.protocol_name IS
  'Transport or semantic protocol name. Real Profinet layout remains unresolved.';
COMMENT ON COLUMN public.screening_integration_events.message_type IS
  'BELTCON SBTS semantic BHS message type: 2001 inbound bag message or 2002 acknowledgement.';
COMMENT ON COLUMN public.screening_integration_events.message_fingerprint IS
  'Deterministic semantic idempotency key. It is scoped by source_system for BHS 2001 messages.';
COMMENT ON COLUMN public.screening_integration_events.acknowledgement_timing IS
  'Semantic acknowledgement timing. Baseline acknowledgement is only AFTER_DURABLE_COMMIT.';
COMMENT ON COLUMN public.screening_integration_events.processing_attempt_count IS
  'Number of durable processing attempts for a future integration worker.';

-- Later, after verification queries show no violations, validate each named
-- NOT VALID constraint with ALTER TABLE ... VALIDATE CONSTRAINT. Do not do so
-- in this migration because legacy/demo records may not be baseline shaped.
