-- Data-integrity foundation for future screening ingestion.
--
-- This migration intentionally creates no ingestion API, simulator UI, or
-- browser write policies. Integration events and audit events remain
-- service-role-only because RLS is enabled without browser policies.

-- Preflight legacy data before adding uniqueness constraints. These checks
-- fail explicitly so an operator can review and correct source data without
-- deleting records or inventing identifiers.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.bags
    WHERE BTRIM(bhs_uid) = ''
  ) THEN
    RAISE EXCEPTION 'Cannot migrate bags with blank BHS UIDs'
      USING HINT = 'Review with: SELECT id, bhs_uid FROM public.bags WHERE BTRIM(bhs_uid) = ''''; then update each row with its verified BHS UID.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bags
    WHERE bhs_uid = id
  ) THEN
    RAISE EXCEPTION 'Possible bag-ID fallback values exist in bags.bhs_uid'
      USING HINT = 'Review with: SELECT id, bhs_uid FROM public.bags WHERE bhs_uid = id; then replace each fallback with its verified BHS UID before rerunning this migration.';
  END IF;

  IF EXISTS (
    SELECT bhs_uid
    FROM public.bags
    GROUP BY bhs_uid
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate legacy BHS UIDs prevent source-system uniqueness'
      USING HINT = 'Review with: SELECT bhs_uid, array_agg(id) FROM public.bags GROUP BY bhs_uid HAVING COUNT(*) > 1; then correct the source records before rerunning this migration.';
  END IF;

  IF EXISTS (
    SELECT epc
    FROM public.bags
    WHERE epc IS NOT NULL
    GROUP BY epc
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate non-null EPC values prevent EPC uniqueness'
      USING HINT = 'Review with: SELECT epc, array_agg(id) FROM public.bags WHERE epc IS NOT NULL GROUP BY epc HAVING COUNT(*) > 1; then correct the source records before rerunning this migration.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bags
    WHERE iata_code = id
  ) THEN
    RAISE EXCEPTION 'Possible bag-ID fallback values exist in bags.iata_code'
      USING HINT = 'Review with: SELECT id, iata_code FROM public.bags WHERE iata_code = id. For confirmed fallback values, first allow nulls and clear them: ALTER TABLE public.bags ALTER COLUMN iata_code DROP NOT NULL; UPDATE public.bags SET iata_code = NULL WHERE iata_code = id;';
  END IF;
END
$$;

-- iata_code is a baggage licence-plate/barcode, not the application bag ID.
-- It is nullable because not every legacy or inbound record has a verified
-- licence plate. No fallback value is generated.
ALTER TABLE public.bags
  ALTER COLUMN iata_code DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS source_system TEXT NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN IF NOT EXISTS iata_origin TEXT,
  ADD COLUMN IF NOT EXISTS passenger_name TEXT,
  ADD COLUMN IF NOT EXISTS threat_type TEXT,
  ADD COLUMN IF NOT EXISTS threat_level SMALLINT,
  ADD COLUMN IF NOT EXISTS screening_station TEXT,
  ADD COLUMN IF NOT EXISTS screened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS flagged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tagged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- created_at is the best known historical flag timestamp for legacy rows.
-- Rows with no created_at remain null rather than receiving a fabricated time.
UPDATE public.bags
SET flagged_at = created_at
WHERE flagged_at IS NULL
  AND created_at IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bags_source_system_not_blank'
      AND conrelid = 'public.bags'::regclass
  ) THEN
    ALTER TABLE public.bags
      ADD CONSTRAINT bags_source_system_not_blank
      CHECK (BTRIM(source_system) <> '');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bags_iata_origin_format'
      AND conrelid = 'public.bags'::regclass
  ) THEN
    ALTER TABLE public.bags
      ADD CONSTRAINT bags_iata_origin_format
      CHECK (iata_origin IS NULL OR iata_origin ~ '^[A-Za-z]{3}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bags_threat_level_check'
      AND conrelid = 'public.bags'::regclass
  ) THEN
    ALTER TABLE public.bags
      ADD CONSTRAINT bags_threat_level_check
      CHECK (threat_level IS NULL OR threat_level BETWEEN 1 AND 5);
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bags_source_bhs_uid
ON public.bags(source_system, bhs_uid);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bags_epc_unique
ON public.bags(epc)
WHERE epc IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bags_iata_code
ON public.bags(iata_code)
WHERE iata_code IS NOT NULL;

CREATE TABLE public.screening_integration_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL,
  source_system TEXT NOT NULL CHECK (BTRIM(source_system) <> ''),
  event_type TEXT NOT NULL CHECK (event_type = 'BAG_SUSPECTED'),
  schema_version SMALLINT NOT NULL CHECK (schema_version > 0),
  payload_hash TEXT NOT NULL
    CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  processing_status TEXT NOT NULL DEFAULT 'RECEIVED'
    CHECK (
      processing_status IN (
        'RECEIVED',
        'PROCESSING',
        'ACCEPTED',
        'DUPLICATE',
        'CONFLICT',
        'FAILED'
      )
    ),
  bag_id TEXT REFERENCES public.bags(id) ON DELETE SET NULL,
  xray_scan_id UUID REFERENCES public.xray_scans(id) ON DELETE SET NULL,
  error_code TEXT,
  error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  sanitized_metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (JSONB_TYPEOF(sanitized_metadata) = 'object')
);

CREATE UNIQUE INDEX idx_screening_events_source_event
ON public.screening_integration_events(source_system, event_id);

CREATE INDEX idx_screening_events_bag_id
ON public.screening_integration_events(bag_id);

CREATE INDEX idx_screening_events_processing_status
ON public.screening_integration_events(processing_status);

ALTER TABLE public.screening_integration_events ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN public.screening_integration_events.sanitized_metadata IS
  'Sanitized operational metadata only. Never store images, secrets, credentials, or raw vendor payloads.';

CREATE TABLE public.audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL CHECK (BTRIM(action) <> ''),
  actor_type TEXT NOT NULL CHECK (BTRIM(actor_type) <> ''),
  actor_id TEXT,
  canonical_role TEXT,
  bag_id TEXT REFERENCES public.bags(id) ON DELETE SET NULL,
  xray_scan_id UUID REFERENCES public.xray_scans(id) ON DELETE SET NULL,
  integration_event_id UUID
    REFERENCES public.screening_integration_events(id) ON DELETE SET NULL,
  source_system TEXT,
  outcome TEXT NOT NULL CHECK (BTRIM(outcome) <> ''),
  error_code TEXT,
  request_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (JSONB_TYPEOF(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_events_bag_id
ON public.audit_events(bag_id);

CREATE INDEX idx_audit_events_integration_event_id
ON public.audit_events(integration_event_id);

CREATE INDEX idx_audit_events_created_at
ON public.audit_events(created_at);

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.audit_events IS
  'Durable, sanitized operational audit trail. Never store images, secrets, credentials, or raw vendor payloads.';

-- A vendor scan identity may be attached to an unlinked bag once, but it may
-- never be moved from one linked bag/BHS identity to another.
CREATE OR REPLACE FUNCTION public.prevent_xray_scan_identity_reassignment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.external_scan_id IS NOT NULL THEN
    IF NEW.source_system IS DISTINCT FROM OLD.source_system
      OR NEW.external_scan_id IS DISTINCT FROM OLD.external_scan_id
      OR NEW.bhs_uid IS DISTINCT FROM OLD.bhs_uid
      OR (
        OLD.bag_id IS NOT NULL
        AND NEW.bag_id IS DISTINCT FROM OLD.bag_id
      )
    THEN
      RAISE EXCEPTION 'X-ray external identity cannot be reassigned'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_xray_scan_identity_reassignment
BEFORE UPDATE ON public.xray_scans
FOR EACH ROW
EXECUTE FUNCTION public.prevent_xray_scan_identity_reassignment();
