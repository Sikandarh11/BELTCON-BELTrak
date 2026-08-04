-- BELTCON SBTS P2.1 integrity hardening.
--
-- This migration is limited to the existing semantic HTTP/database contracts.
-- It does not add a physical BHS transport, HBSS SDK, RS-232 protocol, or
-- vendor acknowledgement vocabulary.

-- BHS confirmation and tagging readiness are different facts. Migration 024
-- coupled CONFIRMED to tagging_ready_at; loosen that constraint before the
-- richer readiness state is populated.
ALTER TABLE public.bags
  DROP CONSTRAINT IF EXISTS bags_beltcon_bhs_confirmation_timestamps;

ALTER TABLE public.bags
  ADD COLUMN IF NOT EXISTS tagging_readiness_status TEXT NOT NULL DEFAULT 'NOT_READY';

ALTER TABLE public.bags
  DROP CONSTRAINT IF EXISTS bags_beltcon_tagging_readiness_status;
ALTER TABLE public.bags
  ADD CONSTRAINT bags_beltcon_tagging_readiness_status
  CHECK (tagging_readiness_status IN (
    'NOT_READY',
    'AWAITING_BHS',
    'AWAITING_SCREENING',
    'AWAITING_XRAY',
    'READY_FOR_TAGGING',
    'BLOCKED_CONFLICT'
  ));

ALTER TABLE public.bags
  ADD CONSTRAINT bags_beltcon_bhs_confirmation_timestamp
  CHECK (
    bhs_confirmation_status IS DISTINCT FROM 'CONFIRMED'
    OR bhs_confirmed_at IS NOT NULL
  ) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_bags_beltcon_tagging_readiness
ON public.bags(tagging_readiness_status, flagged_at ASC, id ASC)
WHERE status = 'IDENTIFIED';

COMMENT ON COLUMN public.bags.tagging_readiness_status IS
  'Server-calculated tagging gate. BASE_ALWAJH requires canonical non-ACCEPT BHS evidence; ENHANCED_EVIDENCE additionally requires screening, threat, and X-ray evidence.';

CREATE TABLE IF NOT EXISTS public.tagging_readiness_configuration (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  policy TEXT NOT NULL DEFAULT 'BASE_ALWAJH'
    CHECK (policy IN ('BASE_ALWAJH', 'ENHANCED_EVIDENCE')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.tagging_readiness_configuration(singleton, policy)
VALUES(TRUE, 'BASE_ALWAJH')
ON CONFLICT(singleton) DO NOTHING;
ALTER TABLE public.tagging_readiness_configuration ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.tagging_readiness_configuration IS
  'Deployment-wide tagging evidence policy. Changes require a trusted database administration path.';

-- Retain the application-compatible tag fields on bags while also recording
-- one immutable, relational tag association for integrity and traceability.
CREATE TABLE IF NOT EXISTS public.tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bag_id TEXT NOT NULL UNIQUE REFERENCES public.bags(id) ON DELETE RESTRICT,
  epc TEXT NOT NULL CHECK (BTRIM(epc) <> ''),
  rfid_tag_barcode TEXT CHECK (rfid_tag_barcode IS NULL OR BTRIM(rfid_tag_barcode) <> ''),
  iata_lpc TEXT CHECK (iata_lpc IS NULL OR iata_lpc ~ '^\d{10}$'),
  assigned_by TEXT,
  request_id TEXT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_epc_normalized_unique
ON public.tags(UPPER(BTRIM(epc)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_barcode_normalized_unique
ON public.tags(UPPER(BTRIM(rfid_tag_barcode)))
WHERE rfid_tag_barcode IS NOT NULL;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

INSERT INTO public.tags(bag_id, epc, rfid_tag_barcode, iata_lpc, assigned_at, created_at)
SELECT id, epc, rfid_tag_barcode, iata_code, COALESCE(tagged_at, updated_at, NOW()),
       COALESCE(tagged_at, created_at, NOW())
FROM public.bags
WHERE epc IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.prevent_beltcon_tag_identity_mutation_v1()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.bag_id IS DISTINCT FROM OLD.bag_id
    OR NEW.epc IS DISTINCT FROM OLD.epc
    OR NEW.rfid_tag_barcode IS DISTINCT FROM OLD.rfid_tag_barcode
  THEN
    RAISE EXCEPTION 'RFID tag identity is immutable'
      USING ERRCODE='23514', CONSTRAINT='tags_identity_immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS prevent_beltcon_tag_identity_mutation_v1 ON public.tags;
CREATE TRIGGER prevent_beltcon_tag_identity_mutation_v1
BEFORE UPDATE OF bag_id,epc,rfid_tag_barcode ON public.tags
FOR EACH ROW EXECUTE FUNCTION public.prevent_beltcon_tag_identity_mutation_v1();

ALTER TABLE public.xray_scans
  ADD CONSTRAINT xray_scans_beltcon_bhs_uid_format
  CHECK (
    octet_length(bhs_uid)=10
    AND char_length(bhs_uid)=10
    AND bhs_uid ~ '^[ -~]{10}$'
    AND bhs_uid=btrim(bhs_uid)
    AND bhs_uid !~* '^ETB-'
  ) NOT VALID;

ALTER TABLE public.hbss_recall_requests
  DROP CONSTRAINT IF EXISTS hbss_recall_bhs_uid_not_blank;
ALTER TABLE public.hbss_recall_requests
  ADD CONSTRAINT hbss_recall_bhs_uid_format
  CHECK (
    octet_length(bhs_uid)=10
    AND char_length(bhs_uid)=10
    AND bhs_uid ~ '^[ -~]{10}$'
    AND bhs_uid=btrim(bhs_uid)
    AND bhs_uid !~* '^ETB-'
  ) NOT VALID;

CREATE OR REPLACE FUNCTION public.enforce_xray_bag_bhs_correlation_v1()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_bag_bhs_uid TEXT;
BEGIN
  IF NEW.bag_id IS NULL THEN RETURN NEW; END IF;
  SELECT bhs_uid INTO v_bag_bhs_uid FROM public.bags WHERE id=NEW.bag_id;
  IF NOT FOUND OR v_bag_bhs_uid IS DISTINCT FROM NEW.bhs_uid THEN
    RAISE EXCEPTION 'X-ray scan BHS BagID does not match its bag'
      USING ERRCODE='23514', CONSTRAINT='xray_scans_bag_bhs_uid_correlation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.serialize_beltcon_xray_identity_v1()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  -- Direct service-role ingestion and the semantic screening RPC must acquire
  -- the canonical BHS identity lock in the same order before uniqueness and
  -- readiness triggers touch scan/bag rows.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('beltcon:canonical-bhs:' || COALESCE(NEW.bhs_uid,''), 0)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS serialize_beltcon_xray_identity_v1 ON public.xray_scans;
CREATE TRIGGER serialize_beltcon_xray_identity_v1
BEFORE INSERT OR UPDATE OF bag_id,bhs_uid,external_scan_id ON public.xray_scans
FOR EACH ROW EXECUTE FUNCTION public.serialize_beltcon_xray_identity_v1();

DROP TRIGGER IF EXISTS enforce_xray_bag_bhs_correlation_v1 ON public.xray_scans;
CREATE TRIGGER enforce_xray_bag_bhs_correlation_v1
BEFORE INSERT OR UPDATE OF bag_id, bhs_uid ON public.xray_scans
FOR EACH ROW EXECUTE FUNCTION public.enforce_xray_bag_bhs_correlation_v1();

CREATE OR REPLACE FUNCTION public.calculate_beltcon_tagging_readiness_v1(p_bag_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bag public.bags%ROWTYPE;
  v_policy TEXT;
BEGIN
  SELECT * INTO v_bag FROM public.bags WHERE id = p_bag_id;
  IF NOT FOUND THEN RETURN 'NOT_READY'; END IF;
  SELECT policy INTO v_policy
  FROM public.tagging_readiness_configuration
  WHERE singleton=TRUE;
  v_policy := COALESCE(v_policy, 'BASE_ALWAJH');

  -- Conflicts are sticky. Only a future approved repair/supervisor workflow
  -- may clear them; normal integration traffic must never do so silently.
  IF v_bag.tagging_readiness_status = 'BLOCKED_CONFLICT' THEN
    RETURN 'BLOCKED_CONFLICT';
  END IF;

  IF v_bag.status <> 'IDENTIFIED'
    OR v_bag.epc IS NOT NULL
    OR v_bag.rfid_tag_barcode IS NOT NULL
  THEN RETURN 'NOT_READY'; END IF;

  IF v_bag.bhs_confirmation_status IS DISTINCT FROM 'CONFIRMED'
    OR v_bag.bhs_confirmed_at IS NULL
    OR NULLIF(BTRIM(v_bag.bhs_line_id), '') IS NULL
  THEN RETURN 'AWAITING_BHS'; END IF;

  IF v_bag.screening_evaluation IS NULL
    OR v_bag.screening_evaluation = 'ACCEPT'
  THEN RETURN 'AWAITING_SCREENING'; END IF;

  -- The approved Al Wajh base policy is driven by the canonical BHS diversion
  -- message. IATA LPC, threat metadata, HBSS refresh, and a locally stored
  -- X-ray image remain optional unless the enhanced policy is explicitly set.
  IF v_policy = 'BASE_ALWAJH' THEN RETURN 'READY_FOR_TAGGING'; END IF;

  -- The optional enhanced policy requires independently received screening,
  -- threat, and image evidence in addition to the BHS diversion.
  IF v_bag.screening_received_at IS NULL
    OR v_bag.screened_at IS NULL
    OR NULLIF(BTRIM(v_bag.screening_station), '') IS NULL
    OR NULLIF(BTRIM(v_bag.source_system), '') IS NULL
    OR v_bag.threat_level IS NULL
    OR NULLIF(BTRIM(v_bag.threat_type), '') IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.screening_integration_events screening_event
      WHERE screening_event.bag_id=v_bag.id
        AND screening_event.event_type='BAG_SUSPECTED'
        AND screening_event.processing_status='ACCEPTED'
        AND screening_event.xray_scan_id IS NOT NULL
        AND NULLIF(BTRIM(screening_event.source_system),'') IS NOT NULL
    )
  THEN RETURN 'AWAITING_SCREENING'; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.xray_scans scan
    WHERE scan.bag_id = v_bag.id
      AND scan.bhs_uid = v_bag.bhs_uid
      AND scan.status = 'AVAILABLE'
      AND NULLIF(BTRIM(scan.source_system), '') IS NOT NULL
      AND jsonb_array_length(scan.images) > 0
  ) THEN RETURN 'AWAITING_XRAY'; END IF;

  RETURN 'READY_FOR_TAGGING';
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_beltcon_tagging_readiness_v1(p_bag_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bag public.bags%ROWTYPE;
  v_previous TEXT;
  v_next TEXT;
BEGIN
  IF p_bag_id IS NULL THEN RETURN 'NOT_READY'; END IF;
  SELECT * INTO v_bag FROM public.bags WHERE id = p_bag_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOT_READY'; END IF;
  v_previous := v_bag.tagging_readiness_status;
  v_next := public.calculate_beltcon_tagging_readiness_v1(v_bag.id);

  IF v_previous IS DISTINCT FROM v_next THEN
    UPDATE public.bags
    SET tagging_readiness_status = v_next,
        tagging_ready_at = CASE
          WHEN v_next = 'READY_FOR_TAGGING' THEN COALESCE(tagging_ready_at, NOW())
          ELSE NULL
        END
    WHERE id = v_bag.id;

    INSERT INTO public.audit_events(
      action, actor_type, actor_id, bag_id, source_system, outcome, metadata
    ) VALUES (
      'BAG_TAGGING_READINESS_CHANGED', 'SYSTEM', 'READINESS_ENGINE', v_bag.id,
      v_bag.source_system, v_next,
      jsonb_build_object(
        'bhsUid', v_bag.bhs_uid,
        'previousStatus', v_previous,
        'newStatus', v_next
      )
    );
  END IF;
  RETURN v_next;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_beltcon_tagging_readiness_from_bag_v1()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.refresh_beltcon_tagging_readiness_v1(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refresh_beltcon_tagging_readiness_from_bag_v1 ON public.bags;
CREATE TRIGGER refresh_beltcon_tagging_readiness_from_bag_v1
AFTER INSERT OR UPDATE OF
  status, epc, rfid_tag_barcode, bhs_uid, bhs_line_id,
  bhs_confirmation_status, bhs_confirmed_at, screening_received_at,
  screened_at, screening_station, screening_evaluation, threat_level,
  threat_type, source_system
ON public.bags
FOR EACH ROW EXECUTE FUNCTION public.refresh_beltcon_tagging_readiness_from_bag_v1();

CREATE OR REPLACE FUNCTION public.refresh_beltcon_tagging_readiness_from_xray_v1()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_beltcon_tagging_readiness_v1(OLD.bag_id);
    RETURN OLD;
  ELSE
    PERFORM public.refresh_beltcon_tagging_readiness_v1(NEW.bag_id);
    IF TG_OP = 'UPDATE' AND OLD.bag_id IS DISTINCT FROM NEW.bag_id THEN
      PERFORM public.refresh_beltcon_tagging_readiness_v1(OLD.bag_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refresh_beltcon_tagging_readiness_from_xray_v1 ON public.xray_scans;
CREATE TRIGGER refresh_beltcon_tagging_readiness_from_xray_v1
AFTER INSERT OR UPDATE OF bag_id, bhs_uid, status, images, source_system OR DELETE
ON public.xray_scans
FOR EACH ROW EXECUTE FUNCTION public.refresh_beltcon_tagging_readiness_from_xray_v1();

-- Persist an explicit, sticky conflict gate when either semantic ingestion RPC
-- records a canonical identity/decision conflict.
CREATE OR REPLACE FUNCTION public.block_beltcon_tagging_on_integration_conflict_v1()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_previous TEXT;
BEGIN
  IF NEW.processing_status = 'CONFLICT'
    AND NEW.bag_id IS NOT NULL
    AND NEW.error_code IN (
      'BAG_IDENTITY_CONFLICT',
      'BHS_CONFIRMATION_CONFLICT',
      'EXTERNAL_SCAN_ID_CONFLICT',
      'BHS_UID_MISMATCH'
    )
  THEN
    SELECT tagging_readiness_status INTO v_previous
    FROM public.bags WHERE id = NEW.bag_id FOR UPDATE;
    IF FOUND AND v_previous IS DISTINCT FROM 'BLOCKED_CONFLICT' THEN
      UPDATE public.bags
      SET tagging_readiness_status = 'BLOCKED_CONFLICT', tagging_ready_at = NULL
      WHERE id = NEW.bag_id;
      INSERT INTO public.audit_events(
        action, actor_type, actor_id, bag_id, integration_event_id,
        source_system, outcome, error_code, metadata
      ) VALUES (
        'BAG_TAGGING_READINESS_CHANGED', 'SYSTEM', 'READINESS_ENGINE', NEW.bag_id,
        NEW.id, NEW.source_system, 'BLOCKED_CONFLICT', NEW.error_code,
        jsonb_build_object(
          'previousStatus', v_previous,
          'newStatus', 'BLOCKED_CONFLICT'
        )
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS block_beltcon_tagging_on_integration_conflict_v1
ON public.screening_integration_events;
CREATE TRIGGER block_beltcon_tagging_on_integration_conflict_v1
AFTER INSERT OR UPDATE OF processing_status, error_code, bag_id
ON public.screening_integration_events
FOR EACH ROW EXECUTE FUNCTION public.block_beltcon_tagging_on_integration_conflict_v1();

CREATE OR REPLACE FUNCTION public.prevent_false_beltcon_ready_audit_v1()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.action = 'BAG_READY_FOR_TAGGING'
    AND NOT EXISTS (
      SELECT 1 FROM public.bags
      WHERE id = NEW.bag_id
        AND tagging_readiness_status = 'READY_FOR_TAGGING'
    )
  THEN RETURN NULL; END IF;
  IF NEW.action = 'BHS_DIVERSION_CONFIRMED'
    AND EXISTS (
      SELECT 1
      FROM public.screening_integration_events current_event
      JOIN public.screening_integration_events prior_event
        ON prior_event.id <> current_event.id
       AND prior_event.event_type = 'BHS_MESSAGE'
       AND prior_event.sanitized_metadata->>'bhsUid'
         = current_event.sanitized_metadata->>'bhsUid'
       AND prior_event.screening_evaluation_raw
         IS DISTINCT FROM current_event.screening_evaluation_raw
      WHERE current_event.id = NEW.integration_event_id
        AND current_event.event_type = 'BHS_MESSAGE'
    )
  THEN RETURN NULL; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_false_beltcon_ready_audit_v1 ON public.audit_events;
CREATE TRIGGER prevent_false_beltcon_ready_audit_v1
BEFORE INSERT ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_false_beltcon_ready_audit_v1();

-- Backfill through the same server-side calculation used by live triggers.
DO $$
DECLARE v_id TEXT;
BEGIN
  FOR v_id IN SELECT id FROM public.bags LOOP
    PERFORM public.refresh_beltcon_tagging_readiness_v1(v_id);
  END LOOP;
END
$$;

-- Prevent any trusted path from changing the lifecycle to TAGGED unless the
-- evidence gate was ready before the update.
CREATE OR REPLACE FUNCTION public.enforce_beltcon_tagging_readiness_v1()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'TAGGED'
    AND OLD.status IS DISTINCT FROM 'TAGGED'
    AND OLD.tagging_readiness_status IS DISTINCT FROM 'READY_FOR_TAGGING'
  THEN
    RAISE EXCEPTION 'Bag is not ready for RFID tag assignment'
      USING ERRCODE = '23514', CONSTRAINT = 'bags_tagging_readiness_required';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_beltcon_tagging_readiness_v1 ON public.bags;
CREATE TRIGGER enforce_beltcon_tagging_readiness_v1
BEFORE UPDATE OF status ON public.bags
FOR EACH ROW EXECUTE FUNCTION public.enforce_beltcon_tagging_readiness_v1();

-- Redefine the current tag-association RPC with an authoritative readiness
-- check. UI disabled states are presentation only.
CREATE OR REPLACE FUNCTION public.assign_beltcon_rfid_tag_v1(
  p_bag_id TEXT, p_rfid_tag_barcode TEXT, p_epc TEXT, p_iata_lpc TEXT,
  p_expected_version INTEGER, p_actor_id TEXT, p_canonical_role TEXT,
  p_request_id TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_bag_id TEXT := NULLIF(BTRIM(p_bag_id), '');
  v_barcode TEXT := UPPER(BTRIM(COALESCE(p_rfid_tag_barcode, '')));
  v_epc TEXT := UPPER(BTRIM(COALESCE(p_epc, '')));
  v_iata_lpc TEXT := NULLIF(BTRIM(p_iata_lpc), '');
  v_bag public.bags%ROWTYPE; v_constraint_name TEXT;
BEGIN
  IF v_bag_id IS NULL THEN RETURN jsonb_build_object('status','INVALID_BAG_ID','errorMessage','Bag ID is required'); END IF;
  IF v_barcode = '' OR length(v_barcode) > 128 OR v_barcode !~ '^[A-Z0-9][A-Z0-9._:/+-]*$' THEN RETURN jsonb_build_object('status','INVALID_BARCODE','errorMessage','RFID tag barcode is invalid'); END IF;
  IF v_epc = '' OR length(v_epc) > 128 OR v_epc !~ '^[A-Z0-9][A-Z0-9._:-]*$' THEN RETURN jsonb_build_object('status','INVALID_EPC','errorMessage','EPC is invalid'); END IF;
  IF v_iata_lpc IS NOT NULL AND v_iata_lpc !~ '^\d{10}$' THEN RETURN jsonb_build_object('status','INVALID_LPC','errorMessage','IATA Licence Plate Code must be 10 numeric digits'); END IF;
  IF p_expected_version IS NULL OR p_expected_version < 1 THEN RETURN jsonb_build_object('status','INVALID_VERSION','errorMessage','Expected version is required'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('beltcon:tag:' || v_bag_id, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('beltcon:epc:' || v_epc, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('beltcon:barcode:' || v_barcode, 0));
  SELECT * INTO v_bag FROM public.bags WHERE id = v_bag_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','BAG_NOT_FOUND','errorMessage','Bag was not found'); END IF;
  IF v_bag.status='TAGGED'
    AND UPPER(BTRIM(COALESCE(v_bag.epc,'')))=v_epc
    AND UPPER(BTRIM(COALESCE(v_bag.rfid_tag_barcode,'')))=v_barcode
    AND (v_iata_lpc IS NULL OR v_bag.iata_code=v_iata_lpc)
  THEN
    RETURN jsonb_build_object('status','DUPLICATE','bag',to_jsonb(v_bag));
  END IF;
  IF NULLIF(BTRIM(v_bag.bhs_uid), '') IS NULL THEN RETURN jsonb_build_object('status','BHS_UID_REQUIRED','errorMessage','BHS BagID is required'); END IF;
  IF v_bag.version <> p_expected_version THEN RETURN jsonb_build_object('status','VERSION_CONFLICT','errorMessage','Bag changed by another operator'); END IF;
  IF v_bag.tagging_readiness_status IS DISTINCT FROM 'READY_FOR_TAGGING' THEN
    INSERT INTO public.audit_events(action,actor_type,actor_id,canonical_role,bag_id,source_system,outcome,error_code,request_id,metadata)
    VALUES('TAG_ASSIGNMENT_BLOCKED_NOT_READY','USER',NULLIF(BTRIM(p_actor_id),''),NULLIF(BTRIM(p_canonical_role),''),v_bag.id,v_bag.source_system,'REJECTED','TAG_ASSIGNMENT_NOT_READY',NULLIF(BTRIM(p_request_id),''),jsonb_build_object('bhsUid',v_bag.bhs_uid,'readinessStatus',v_bag.tagging_readiness_status));
    RETURN jsonb_build_object('status','TAG_ASSIGNMENT_NOT_READY','errorMessage','Bag does not satisfy the configured tagging-readiness policy');
  END IF;
  IF v_bag.status <> 'IDENTIFIED' OR v_bag.epc IS NOT NULL OR v_bag.rfid_tag_barcode IS NOT NULL OR v_bag.screening_evaluation = 'ACCEPT' THEN RETURN jsonb_build_object('status','BAG_INELIGIBLE','errorMessage','Bag is no longer eligible for RFID tag assignment'); END IF;
  IF EXISTS (SELECT 1 FROM public.bags WHERE id <> v_bag_id AND epc IS NOT NULL AND UPPER(BTRIM(epc)) = v_epc) THEN RETURN jsonb_build_object('status','DUPLICATE_EPC','errorMessage','EPC is already assigned to another bag'); END IF;
  IF EXISTS (SELECT 1 FROM public.bags WHERE id <> v_bag_id AND rfid_tag_barcode IS NOT NULL AND UPPER(BTRIM(rfid_tag_barcode)) = v_barcode AND status <> 'RESOLVED') THEN RETURN jsonb_build_object('status','DUPLICATE_BARCODE','errorMessage','RFID tag barcode is already assigned to another active bag'); END IF;
  UPDATE public.bags SET epc=v_epc,rfid_tag_barcode=v_barcode,iata_code=COALESCE(v_iata_lpc,iata_code),status='TAGGED',tagged_at=v_now,version=version+1,updated_at=v_now WHERE id=v_bag_id AND version=p_expected_version RETURNING * INTO v_bag;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','VERSION_CONFLICT','errorMessage','Bag changed by another operator'); END IF;
  INSERT INTO public.tags(bag_id,epc,rfid_tag_barcode,iata_lpc,assigned_by,request_id,assigned_at)
  VALUES(v_bag.id,v_epc,v_barcode,v_iata_lpc,NULLIF(BTRIM(p_actor_id),''),NULLIF(BTRIM(p_request_id),''),v_now);
  INSERT INTO public.audit_events(action,actor_type,actor_id,canonical_role,bag_id,source_system,outcome,request_id,metadata)
  VALUES('RFID_TAG_ASSIGNED','USER',NULLIF(BTRIM(p_actor_id),''),NULLIF(BTRIM(p_canonical_role),''),v_bag.id,v_bag.source_system,'SUCCESS',NULLIF(BTRIM(p_request_id),''),jsonb_build_object('bhsUid',v_bag.bhs_uid,'bhsLineId',v_bag.bhs_line_id,'screeningEvaluation',v_bag.screening_evaluation,'rfidTagBarcode',v_barcode,'epc',v_epc,'previousStatus','IDENTIFIED','newStatus','TAGGED','previousVersion',p_expected_version,'newVersion',v_bag.version,'taggedAt',v_bag.tagged_at));
  RETURN jsonb_build_object('status','ASSIGNED','bag',to_jsonb(v_bag));
EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
  IF v_constraint_name IN ('idx_bags_epc_normalized_unique','idx_tags_epc_normalized_unique') THEN RETURN jsonb_build_object('status','DUPLICATE_EPC','errorMessage','EPC is already assigned to another bag'); END IF;
  IF v_constraint_name IN ('idx_bags_rfid_tag_barcode_active_unique','idx_tags_barcode_normalized_unique') THEN RETURN jsonb_build_object('status','DUPLICATE_BARCODE','errorMessage','RFID tag barcode is already assigned to another active bag'); END IF;
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.encode_bag_tag_v1(
  p_bag_id TEXT, p_epc TEXT, p_actor_id TEXT, p_canonical_role TEXT,
  p_request_id TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_bag_id TEXT := NULLIF(BTRIM(p_bag_id), '');
  v_normalized_epc TEXT := UPPER(BTRIM(COALESCE(p_epc, '')));
  v_constraint_name TEXT; v_bag public.bags%ROWTYPE;
BEGIN
  IF v_bag_id IS NULL THEN RETURN jsonb_build_object('status','INVALID_BAG_ID','errorMessage','Bag ID is required'); END IF;
  IF v_normalized_epc = '' OR length(v_normalized_epc) > 128 OR v_normalized_epc !~ '^[A-Z0-9][A-Z0-9._:-]*$' THEN RETURN jsonb_build_object('status','INVALID_EPC','errorMessage','EPC contains unsupported characters'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('tagging:bag:' || v_bag_id, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('tagging:epc:' || v_normalized_epc, 0));
  SELECT * INTO v_bag FROM public.bags WHERE id=v_bag_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','BAG_NOT_FOUND','errorMessage','Bag was not found'); END IF;
  IF v_bag.status='TAGGED' AND UPPER(BTRIM(COALESCE(v_bag.epc,'')))=v_normalized_epc THEN
    RETURN jsonb_build_object('status','DUPLICATE','bag',to_jsonb(v_bag));
  END IF;
  IF v_bag.tagging_readiness_status IS DISTINCT FROM 'READY_FOR_TAGGING' THEN RETURN jsonb_build_object('status','TAG_ASSIGNMENT_NOT_READY','errorMessage','Bag does not satisfy the configured tagging-readiness policy'); END IF;
  IF v_bag.status <> 'IDENTIFIED' OR v_bag.epc IS NOT NULL THEN RETURN jsonb_build_object('status','ALREADY_TAGGED','bagStatus',v_bag.status,'errorMessage','Bag is no longer pending RFID encoding'); END IF;
  IF EXISTS (SELECT 1 FROM public.bags WHERE id <> v_bag_id AND epc IS NOT NULL AND UPPER(BTRIM(epc))=v_normalized_epc) THEN RETURN jsonb_build_object('status','DUPLICATE_EPC','errorMessage','EPC is already assigned to another bag'); END IF;
  UPDATE public.bags SET epc=v_normalized_epc,status='TAGGED',tagged_at=v_now,updated_at=v_now WHERE id=v_bag_id AND status='IDENTIFIED' AND epc IS NULL RETURNING * INTO v_bag;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','ALREADY_TAGGED','errorMessage','Bag was encoded by another request'); END IF;
  INSERT INTO public.tags(bag_id,epc,assigned_by,request_id,assigned_at)
  VALUES(v_bag.id,v_normalized_epc,NULLIF(BTRIM(p_actor_id),''),NULLIF(BTRIM(p_request_id),''),v_now);
  INSERT INTO public.audit_events(action,actor_type,actor_id,canonical_role,bag_id,source_system,outcome,request_id,metadata)
  VALUES('TAG_ENCODED','USER',NULLIF(BTRIM(p_actor_id),''),NULLIF(BTRIM(p_canonical_role),''),v_bag.id,v_bag.source_system,'SUCCESS',NULLIF(BTRIM(p_request_id),''),jsonb_build_object('epc',v_normalized_epc,'taggedAt',v_bag.tagged_at));
  RETURN jsonb_build_object('status','ENCODED','bag',to_jsonb(v_bag));
EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS v_constraint_name=CONSTRAINT_NAME;
  IF v_constraint_name IN ('idx_bags_epc_unique','idx_bags_epc_normalized_unique','idx_tags_epc_normalized_unique') THEN RETURN jsonb_build_object('status','DUPLICATE_EPC','errorMessage','EPC is already assigned to another bag'); END IF;
  RAISE;
END;
$$;

-- Replace screening ingestion so all identity preflight checks happen before
-- the first insert/update, and all successful mutations share one transaction.
CREATE OR REPLACE FUNCTION public.ingest_screening_suspect_event_v2(
  p_event JSONB, p_payload_hash TEXT, p_request_id TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_source_system TEXT := NULLIF(BTRIM(p_event ->> 'sourceSystem'), '');
  v_event_id UUID := (p_event ->> 'eventId')::UUID;
  v_bhs_uid TEXT := p_event #>> '{bag,bhsUid}';
  v_external_scan_id TEXT := NULLIF(BTRIM(p_event #>> '{scan,externalScanId}'), '');
  v_scan_status TEXT := NULLIF(BTRIM(p_event #>> '{scan,status}'), '');
  v_evaluation_raw TEXT := COALESCE(NULLIF(BTRIM(p_event #>> '{screening,evaluationRaw}'), ''), 'R');
  v_evaluation TEXT; v_screened_at TIMESTAMPTZ := (p_event #>> '{screening,screenedAt}')::TIMESTAMPTZ;
  v_images JSONB := '[]'::JSONB;
  v_image_count INTEGER := jsonb_array_length(COALESCE(p_event #> '{scan,images}', '[]'::JSONB));
  v_integration_id UUID; v_scan_id UUID;
  v_existing_event public.screening_integration_events%ROWTYPE;
  v_bag public.bags%ROWTYPE; v_existing_scan public.xray_scans%ROWTYPE;
  v_bag_count INTEGER; v_failure_sqlstate TEXT; v_readiness TEXT;
BEGIN
  IF v_source_system IS NULL OR v_event_id IS NULL OR v_external_scan_id IS NULL
    OR v_scan_status NOT IN ('AVAILABLE','PENDING','FAILED','NOT_FOUND')
    OR p_payload_hash !~ '^[0-9a-f]{64}$'
    OR v_bhs_uid IS NULL OR octet_length(v_bhs_uid) <> 10 OR char_length(v_bhs_uid) <> 10
    OR v_bhs_uid !~ '^[ -~]{10}$' OR btrim(v_bhs_uid) = '' OR v_bhs_uid <> btrim(v_bhs_uid) OR v_bhs_uid ~* '^ETB-'
    OR v_evaluation_raw NOT IN ('R','T','N','?')
  THEN RAISE EXCEPTION 'HBSS suspect event violates the BELTCON SBTS correlation contract' USING ERRCODE='22023'; END IF;
  IF v_scan_status='AVAILABLE' AND v_image_count=0 THEN RAISE EXCEPTION 'AVAILABLE screening scans require an image reference' USING ERRCODE='22023'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_event #> '{scan,images}','[]'::JSONB)) image
    WHERE image->>'imageRef' !~ '^/mock-xray/' OR image->>'imageRef' ~ '(^|/)\.\.(/|$)'
      OR image->>'mimeType' NOT IN ('image/jpeg','image/png')
  ) THEN RAISE EXCEPTION 'Invalid screening image reference' USING ERRCODE='22023'; END IF;
  v_evaluation := CASE v_evaluation_raw WHEN 'R' THEN 'REJECT' WHEN 'T' THEN 'TIMEOUT' WHEN 'N' THEN 'NO_DECISION' WHEN '?' THEN 'MISTRACK' END;
  PERFORM pg_advisory_xact_lock(hashtextextended('screening:event:'||v_source_system||':'||v_event_id::TEXT,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('beltcon:canonical-bhs:'||v_bhs_uid,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('screening:scan:'||v_source_system||':'||v_external_scan_id,0));

  SELECT * INTO v_existing_event FROM public.screening_integration_events WHERE source_system=v_source_system AND event_id=v_event_id FOR UPDATE;
  IF FOUND THEN
    IF v_existing_event.payload_hash <> p_payload_hash THEN RETURN jsonb_build_object('status','CONFLICT','eventId',v_event_id,'bagId',v_existing_event.bag_id,'scanId',v_existing_event.xray_scan_id,'scanStatus',NULL,'screeningReceived',FALSE,'bhsConfirmationStatus',NULL,'canAssignTag',FALSE,'errorCode','EVENT_ID_PAYLOAD_CONFLICT','errorMessage','Event ID was already used with a different payload'); END IF;
    SELECT * INTO v_bag FROM public.bags WHERE id=v_existing_event.bag_id;
    SELECT * INTO v_existing_scan FROM public.xray_scans WHERE id=v_existing_event.xray_scan_id;
    UPDATE public.screening_integration_events SET processing_attempt_count=processing_attempt_count+1 WHERE id=v_existing_event.id;
    INSERT INTO public.audit_events(action,actor_type,actor_id,bag_id,xray_scan_id,integration_event_id,source_system,outcome,request_id,metadata)
    VALUES('HBSS_SUSPECT_DETECTED','INTEGRATION',v_source_system,v_existing_event.bag_id,v_existing_event.xray_scan_id,v_existing_event.id,v_source_system,'DUPLICATE',NULLIF(BTRIM(p_request_id),''),jsonb_build_object('eventId',v_event_id,'bhsUid',v_bhs_uid));
    RETURN jsonb_build_object('status','DUPLICATE','eventId',v_event_id,'bagId',v_existing_event.bag_id,'scanId',v_existing_event.xray_scan_id,'scanStatus',v_existing_scan.status,'screeningReceived',v_bag.screening_received_at IS NOT NULL,'bhsConfirmationStatus',v_bag.bhs_confirmation_status,'canAssignTag',v_bag.tagging_readiness_status='READY_FOR_TAGGING','errorCode',NULL,'errorMessage',NULL);
  END IF;

  -- No mutation before all identity/lifecycle preflight checks complete.
  SELECT count(*) INTO v_bag_count FROM public.bags WHERE bhs_uid=v_bhs_uid;
  IF v_bag_count > 1 THEN RETURN jsonb_build_object('status','CONFLICT','eventId',v_event_id,'bagId',NULL,'scanId',NULL,'scanStatus',NULL,'screeningReceived',FALSE,'bhsConfirmationStatus',NULL,'canAssignTag',FALSE,'errorCode','BAG_IDENTITY_CONFLICT','errorMessage','BHS BagID has unresolved duplicate bag records'); END IF;
  SELECT * INTO v_bag FROM public.bags WHERE bhs_uid=v_bhs_uid FOR UPDATE;
  IF FOUND THEN
    IF v_bag.status IN ('TAGGED','IN_TRANSIT','IN_ARRIVAL_HALL','AT_EXIT','ALARMED','UNDER_RECHECK','AT_RECHECK','RESOLVED','MISSING','ESCAPE_ALERT','ESCALATED') THEN RETURN jsonb_build_object('status','CONFLICT','eventId',v_event_id,'bagId',v_bag.id,'scanId',NULL,'scanStatus',NULL,'screeningReceived',FALSE,'bhsConfirmationStatus',v_bag.bhs_confirmation_status,'canAssignTag',FALSE,'errorCode','BAG_LIFECYCLE_CONFLICT','errorMessage','The existing bag lifecycle cannot be reset'); END IF;
    IF v_bag.screening_evaluation_raw IS NOT NULL AND v_bag.screening_evaluation_raw <> v_evaluation_raw THEN RETURN jsonb_build_object('status','CONFLICT','eventId',v_event_id,'bagId',v_bag.id,'scanId',NULL,'scanStatus',NULL,'screeningReceived',FALSE,'bhsConfirmationStatus',v_bag.bhs_confirmation_status,'canAssignTag',FALSE,'errorCode','BHS_CONFIRMATION_CONFLICT','errorMessage','HBSS screening evaluation conflicts with the canonical bag'); END IF;
  END IF;
  SELECT * INTO v_existing_scan FROM public.xray_scans WHERE source_system=v_source_system AND external_scan_id=v_external_scan_id FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('status','CONFLICT','eventId',v_event_id,'bagId',v_existing_scan.bag_id,'scanId',v_existing_scan.id,'scanStatus',v_existing_scan.status,'screeningReceived',FALSE,'bhsConfirmationStatus',CASE WHEN v_bag.id IS NULL THEN NULL ELSE v_bag.bhs_confirmation_status END,'canAssignTag',FALSE,'errorCode',CASE WHEN v_existing_scan.bhs_uid<>v_bhs_uid THEN 'BHS_UID_MISMATCH' ELSE 'EXTERNAL_SCAN_ID_CONFLICT' END,'errorMessage','External scan identity is already assigned');
  END IF;

  INSERT INTO public.screening_integration_events(event_id,source_system,event_type,schema_version,payload_hash,processing_status,received_at,sanitized_metadata,screening_evaluation,screening_evaluation_raw)
  VALUES(v_event_id,v_source_system,'BAG_SUSPECTED',(p_event->>'schemaVersion')::SMALLINT,p_payload_hash,'PROCESSING',v_now,jsonb_build_object('eventId',v_event_id,'bhsUid',v_bhs_uid,'screeningStation',p_event #>> '{screening,station}','imageReferencesOnly',TRUE),v_evaluation,v_evaluation_raw)
  RETURNING id INTO v_integration_id;

  IF v_bag.id IS NOT NULL THEN
    UPDATE public.bags SET
      iata_code=COALESCE(iata_code,NULLIF(BTRIM(p_event #>> '{bag,iataCode}'),'')),
      iata_origin=COALESCE(iata_origin,NULLIF(BTRIM(p_event #>> '{bag,iataOrigin}'),'')),
      flight=COALESCE(flight,NULLIF(BTRIM(p_event #>> '{bag,flightNo}'),'')),
      passenger_name=COALESCE(passenger_name,NULLIF(BTRIM(p_event #>> '{bag,passengerName}'),'')),
      threat_type=COALESCE(threat_type,NULLIF(BTRIM(p_event #>> '{threat,type}'),'')),
      threat_level=COALESCE(threat_level,(p_event #>> '{threat,level}')::SMALLINT),
      screening_station=COALESCE(screening_station,NULLIF(BTRIM(p_event #>> '{screening,station}'),'')),
      screened_at=COALESCE(screened_at,v_screened_at),screening_received_at=COALESCE(screening_received_at,v_now),
      screening_evaluation_raw=COALESCE(screening_evaluation_raw,v_evaluation_raw),screening_evaluation=COALESCE(screening_evaluation,v_evaluation),
      bhs_confirmation_status=CASE WHEN bhs_confirmation_status='CONFIRMED' THEN 'CONFIRMED' ELSE 'AWAITING_BHS_CONFIRMATION' END,
      updated_at=v_now,version=version+1
    WHERE id=v_bag.id RETURNING * INTO v_bag;
  ELSE
    INSERT INTO public.bags(id,source_system,bhs_uid,iata_code,iata_origin,flight,passenger_name,threat_type,threat_level,screening_station,screened_at,screening_received_at,screening_evaluation_raw,screening_evaluation,bhs_confirmation_status,flagged_at,notes,is_suspect,status,current_zone,created_at,updated_at)
    VALUES('ETB-'||UPPER(SUBSTRING(MD5(v_source_system||':'||v_event_id::TEXT) FROM 1 FOR 12)),v_source_system,v_bhs_uid,NULLIF(BTRIM(p_event #>> '{bag,iataCode}'),''),NULLIF(BTRIM(p_event #>> '{bag,iataOrigin}'),''),NULLIF(BTRIM(p_event #>> '{bag,flightNo}'),''),NULLIF(BTRIM(p_event #>> '{bag,passengerName}'),''),NULLIF(BTRIM(p_event #>> '{threat,type}'),''),(p_event #>> '{threat,level}')::SMALLINT,NULLIF(BTRIM(p_event #>> '{screening,station}'),''),v_screened_at,v_now,v_evaluation_raw,v_evaluation,'AWAITING_BHS_CONFIRMATION',(p_event->>'occurredAt')::TIMESTAMPTZ,NULLIF(BTRIM(p_event #>> '{screening,notes}'),''),TRUE,'IDENTIFIED','TAGGING_STATION',(p_event->>'occurredAt')::TIMESTAMPTZ,v_now)
    RETURNING * INTO v_bag;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',image->>'imageId','label',image->>'label','url',image->>'imageRef','mimeType',image->>'mimeType') ORDER BY image_order),'[]'::JSONB)
  INTO v_images FROM jsonb_array_elements(COALESCE(p_event #> '{scan,images}','[]'::JSONB)) WITH ORDINALITY images(image,image_order);
  INSERT INTO public.xray_scans(bag_id,bhs_uid,external_scan_id,source_system,status,images,threat_level,threat_type,captured_at,received_at,error_code,error_message,metadata,created_at,updated_at)
  VALUES(v_bag.id,v_bhs_uid,v_external_scan_id,v_source_system,v_scan_status,v_images,(p_event #>> '{threat,level}')::SMALLINT,NULLIF(BTRIM(p_event #>> '{threat,type}'),''),v_screened_at,v_now,CASE WHEN v_scan_status='FAILED' THEN 'SCREENING_REPORTED_FAILED' ELSE NULL END,CASE WHEN v_scan_status='FAILED' THEN 'Screening system reported scan failure' ELSE NULL END,jsonb_build_object('integrationEventId',v_integration_id,'imageReferencesOnly',TRUE),v_now,v_now)
  RETURNING id INTO v_scan_id;
  UPDATE public.screening_integration_events SET processing_status='ACCEPTED',bag_id=v_bag.id,xray_scan_id=v_scan_id,processed_at=v_now WHERE id=v_integration_id;
  v_readiness := public.refresh_beltcon_tagging_readiness_v1(v_bag.id);
  SELECT * INTO v_bag FROM public.bags WHERE id=v_bag.id;
  INSERT INTO public.audit_events(action,actor_type,actor_id,bag_id,xray_scan_id,integration_event_id,source_system,outcome,request_id,metadata)
  VALUES('HBSS_SUSPECT_DETECTED','INTEGRATION',v_source_system,v_bag.id,v_scan_id,v_integration_id,v_source_system,'SUCCESS',NULLIF(BTRIM(p_request_id),''),jsonb_build_object('bhsUid',v_bhs_uid,'screeningEvaluation',v_evaluation,'screeningEvaluationRaw',v_evaluation_raw));
  RETURN jsonb_build_object('status','ACCEPTED','eventId',v_event_id,'bagId',v_bag.id,'scanId',v_scan_id,'scanStatus',v_scan_status,'screeningReceived',TRUE,'bhsConfirmationStatus',v_bag.bhs_confirmation_status,'canAssignTag',v_readiness='READY_FOR_TAGGING','errorCode',NULL,'errorMessage',NULL);
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_failure_sqlstate=RETURNED_SQLSTATE;
  INSERT INTO public.audit_events(action,actor_type,actor_id,source_system,outcome,error_code,request_id,metadata)
  VALUES('SUSPECT_EVENT_FAILED','INTEGRATION',v_source_system,v_source_system,'FAILED','SCREENING_TRANSACTION_FAILED',NULLIF(BTRIM(p_request_id),''),jsonb_build_object('eventId',v_event_id,'databaseCode',v_failure_sqlstate));
  RETURN jsonb_build_object('status','FAILED','eventId',COALESCE(v_event_id::TEXT,'00000000-0000-0000-0000-000000000000'),'bagId',NULL,'scanId',NULL,'scanStatus',NULL,'screeningReceived',FALSE,'bhsConfirmationStatus',NULL,'canAssignTag',FALSE,'errorCode','SCREENING_TRANSACTION_FAILED','errorMessage','Screening event could not be processed');
END;
$$;

-- Preserve the migration-024 transaction implementation behind a private
-- wrapper, then correct its readiness response from the authoritative bag
-- state calculated by the new triggers. taggingEligible remains the BHS
-- decision classification; canAssignTag is the complete evidence gate.
ALTER FUNCTION public.ingest_beltcon_bhs_message_v2(JSONB,TEXT,TEXT,TEXT,UUID,TEXT)
RENAME TO ingest_beltcon_bhs_message_v2_pre_readiness;
REVOKE ALL ON FUNCTION public.ingest_beltcon_bhs_message_v2_pre_readiness(JSONB,TEXT,TEXT,TEXT,UUID,TEXT)
FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ingest_beltcon_bhs_message_v2(
  p_message JSONB,
  p_source_system TEXT,
  p_message_fingerprint TEXT,
  p_payload_hash TEXT,
  p_event_id UUID,
  p_request_id TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_result JSONB;
  v_readiness TEXT;
  v_conflicting_event_id UUID;
BEGIN
  v_result := public.ingest_beltcon_bhs_message_v2_pre_readiness(
    p_message,p_source_system,p_message_fingerprint,p_payload_hash,p_event_id,p_request_id
  );
  IF NULLIF(v_result->>'bagId','') IS NULL THEN
    RETURN v_result || jsonb_build_object('canAssignTag',FALSE,'taggingReadinessStatus',NULL);
  END IF;

  -- The upstream semantic message contains no vendor sequence or occurrence
  -- timestamp. Make opposite evaluations deterministic in either receipt
  -- order by retaining the one canonical bag and requiring manual review.
  IF v_result->>'status' = 'ACCEPTED' THEN
    SELECT prior_event.id INTO v_conflicting_event_id
    FROM public.screening_integration_events prior_event
    WHERE prior_event.id <> (v_result->>'integrationEventId')::UUID
      AND prior_event.event_type = 'BHS_MESSAGE'
      AND prior_event.sanitized_metadata->>'bhsUid' = p_message->>'bhsUid'
      AND prior_event.screening_evaluation_raw IS DISTINCT FROM p_message->>'evaluation'
    ORDER BY prior_event.received_at ASC, prior_event.id ASC
    LIMIT 1;

    IF v_conflicting_event_id IS NOT NULL THEN
      UPDATE public.screening_integration_events
      SET processing_status='CONFLICT',
          error_code='BHS_CONFIRMATION_CONFLICT',
          error_message='BHS confirmation conflicts with an earlier semantic evaluation',
          acknowledgement_outcome='REJECTED',
          acknowledgement_timing='AFTER_DURABLE_COMMIT',
          acknowledged_at=NOW()
      WHERE id=(v_result->>'integrationEventId')::UUID;
      INSERT INTO public.audit_events(
        action,actor_type,actor_id,bag_id,integration_event_id,source_system,
        outcome,error_code,request_id,metadata
      ) VALUES (
        'BHS_MESSAGE_REJECTED','INTEGRATION',p_source_system,v_result->>'bagId',
        (v_result->>'integrationEventId')::UUID,p_source_system,'CONFLICT',
        'BHS_CONFIRMATION_CONFLICT',NULLIF(BTRIM(p_request_id),''),
        jsonb_build_object(
          'bhsUid',p_message->>'bhsUid',
          'lineId',p_message->>'lineId',
          'conflictingIntegrationEventId',v_conflicting_event_id,
          'orderingBasis','SERVER_RECEIPT_ONLY'
        )
      );
      RETURN v_result || jsonb_build_object(
        'status','CONFLICT','taggingEligible',FALSE,'canAssignTag',FALSE,
        'taggingReadinessStatus','BLOCKED_CONFLICT',
        'errorCode','BHS_CONFIRMATION_CONFLICT',
        'errorMessage','BHS confirmation conflicts with an earlier semantic evaluation'
      );
    END IF;
  END IF;

  SELECT tagging_readiness_status INTO v_readiness
  FROM public.bags WHERE id=v_result->>'bagId';
  RETURN v_result || jsonb_build_object(
    'canAssignTag',COALESCE(v_readiness='READY_FOR_TAGGING',FALSE),
    'taggingReadinessStatus',v_readiness
  );
END;
$$;

-- Recall command state is independent from X-ray image availability.
UPDATE public.hbss_recall_requests
SET status='REQUEST_SENT'
WHERE status IN ('SENT','ACKNOWLEDGED','COMPLETED');
ALTER TABLE public.hbss_recall_requests DROP CONSTRAINT IF EXISTS hbss_recall_status_check;
ALTER TABLE public.hbss_recall_requests ADD CONSTRAINT hbss_recall_status_check
CHECK (status IN ('PENDING','REQUEST_SENT','FAILED','UNAVAILABLE','SIMULATED','TIMED_OUT','CANCELLED'));
ALTER TABLE public.hbss_recall_requests DROP CONSTRAINT IF EXISTS hbss_recall_error_for_failure_check;
ALTER TABLE public.hbss_recall_requests ADD CONSTRAINT hbss_recall_error_for_failure_check
CHECK (status NOT IN ('FAILED','UNAVAILABLE','TIMED_OUT','CANCELLED') OR error_code IS NOT NULL OR error_message IS NOT NULL);

CREATE OR REPLACE FUNCTION public.complete_beltcon_hbss_recall_v1(
  p_recall_id UUID,p_status TEXT,p_error_code TEXT,p_error_message TEXT,
  p_response_metadata JSONB,p_request_id TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_recall public.hbss_recall_requests%ROWTYPE; v_action TEXT;
BEGIN
  SELECT * INTO v_recall FROM public.hbss_recall_requests WHERE id=p_recall_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','NOT_FOUND'); END IF;
  IF p_status NOT IN ('REQUEST_SENT','FAILED','UNAVAILABLE','SIMULATED','TIMED_OUT','CANCELLED') THEN RETURN jsonb_build_object('status','INVALID_STATUS'); END IF;
  IF v_recall.status=p_status THEN RETURN jsonb_build_object('status','DUPLICATE','recall',to_jsonb(v_recall)); END IF;
  IF v_recall.status<>'PENDING' THEN RETURN jsonb_build_object('status','INVALID_TRANSITION','recall',to_jsonb(v_recall)); END IF;
  UPDATE public.hbss_recall_requests SET
    status=p_status,
    completed_at=NOW(),
    error_code=NULLIF(BTRIM(p_error_code),''),
    error_message=NULLIF(BTRIM(p_error_message),''),
    response_metadata=COALESCE(p_response_metadata,'{}'::JSONB)
  WHERE id=p_recall_id RETURNING * INTO v_recall;
  v_action := CASE p_status WHEN 'SIMULATED' THEN 'HBSS_RECALL_SIMULATED' WHEN 'REQUEST_SENT' THEN 'HBSS_RECALL_REQUEST_SENT' WHEN 'UNAVAILABLE' THEN 'HBSS_RECALL_UNAVAILABLE' WHEN 'TIMED_OUT' THEN 'HBSS_RECALL_TIMED_OUT' WHEN 'CANCELLED' THEN 'HBSS_RECALL_CANCELLED' ELSE 'HBSS_RECALL_FAILED' END;
  INSERT INTO public.audit_events(action,actor_type,actor_id,bag_id,outcome,request_id,metadata)
  VALUES(v_action,'INTEGRATION',v_recall.adapter_type,v_recall.bag_id,p_status,p_request_id,jsonb_build_object('alarmId',v_recall.alarm_id,'recallRequestId',v_recall.id,'adapterType',v_recall.adapter_type));
  RETURN jsonb_build_object('status','UPDATED','recall',to_jsonb(v_recall));
END;
$$;

-- Remove browser mutation paths while preserving existing authenticated read
-- policies. All operational writes use trusted server clients or the approved
-- SECURITY DEFINER RPCs above.
DROP POLICY IF EXISTS "auth_write_bags" ON public.bags;
DROP POLICY IF EXISTS "auth_update_bags" ON public.bags;
DROP POLICY IF EXISTS "auth_write_alarms" ON public.alarms;
DROP POLICY IF EXISTS "auth_update_alarms" ON public.alarms;
DROP POLICY IF EXISTS "auth_write_events" ON public.rfid_events;
DROP POLICY IF EXISTS "auth_update_events" ON public.rfid_events;
DROP POLICY IF EXISTS "auth_write_resolutions" ON public.resolutions;
DROP POLICY IF EXISTS "auth_write_readers" ON public.readers;
DROP POLICY IF EXISTS "auth_update_readers" ON public.readers;

REVOKE INSERT, UPDATE, DELETE ON public.bags FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.alarms FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.rfid_events FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.resolutions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.readers FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.xray_scans FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.screening_integration_events FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.hbss_recall_requests FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.audit_events FROM anon, authenticated;
REVOKE ALL ON public.tagging_readiness_configuration FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF to_regclass('public.tags') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON public.tags FROM PUBLIC, anon, authenticated';
  END IF;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bags TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.alarms TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rfid_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resolutions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.readers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.xray_scans TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.screening_integration_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hbss_recall_requests TO service_role;
REVOKE UPDATE, DELETE ON public.audit_events FROM service_role;
GRANT SELECT, INSERT ON public.audit_events TO service_role;
REVOKE INSERT, UPDATE, DELETE ON public.tags FROM service_role;
GRANT SELECT ON public.tags TO service_role;
GRANT SELECT ON public.tagging_readiness_configuration TO service_role;

REVOKE ALL ON FUNCTION public.calculate_beltcon_tagging_readiness_v1(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_beltcon_tagging_readiness_v1(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_beltcon_rfid_tag_v1(TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.encode_bag_tag_v1(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ingest_screening_suspect_event_v2(JSONB,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ingest_beltcon_bhs_message_v2(JSONB,TEXT,TEXT,TEXT,UUID,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_beltcon_hbss_recall_v1(UUID,TEXT,TEXT,TEXT,JSONB,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_beltcon_rfid_tag_v1(TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.encode_bag_tag_v1(TEXT,TEXT,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.ingest_screening_suspect_event_v2(JSONB,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.ingest_beltcon_bhs_message_v2(JSONB,TEXT,TEXT,TEXT,UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_beltcon_hbss_recall_v1(UUID,TEXT,TEXT,TEXT,JSONB,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_beltcon_tagging_readiness_v1(TEXT) TO service_role;
