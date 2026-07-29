-- BELTCON SBTS: correlate HBSS suspect detection and BHS diversion confirmation.
--
-- Single-airport V1 identity is one valid BHS BagID to one canonical bags.id.
-- Integration source remains part of screening_integration_events idempotency;
-- it is not part of physical bag identity. This migration intentionally does
-- not merge live duplicate records automatically.

ALTER TABLE public.bags
  ADD COLUMN IF NOT EXISTS screening_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bhs_confirmation_status TEXT,
  ADD COLUMN IF NOT EXISTS bhs_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tagging_ready_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bhs_confirmation_event_id UUID
    REFERENCES public.screening_integration_events(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bags_beltcon_bhs_confirmation_status'
      AND conrelid = 'public.bags'::regclass
  ) THEN
    ALTER TABLE public.bags ADD CONSTRAINT bags_beltcon_bhs_confirmation_status
      CHECK (
        bhs_confirmation_status IS NULL
        OR bhs_confirmation_status IN ('AWAITING_BHS_CONFIRMATION', 'CONFIRMED')
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bags_beltcon_bhs_confirmation_timestamps'
      AND conrelid = 'public.bags'::regclass
  ) THEN
    ALTER TABLE public.bags ADD CONSTRAINT bags_beltcon_bhs_confirmation_timestamps
      CHECK (
        bhs_confirmation_status IS DISTINCT FROM 'CONFIRMED'
        OR (bhs_confirmed_at IS NOT NULL AND tagging_ready_at IS NOT NULL)
      ) NOT VALID;
  END IF;
END
$$;

-- Existing rows deliberately keep NULL readiness until an operator confirms
-- them or uses the guarded repair procedure below. This partial index protects
-- all V1 rows created after this migration without failing on legacy duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bags_beltcon_canonical_bhs_uid_ready
ON public.bags (bhs_uid)
WHERE bhs_confirmation_status IN ('AWAITING_BHS_CONFIRMATION', 'CONFIRMED')
  AND octet_length(bhs_uid) = 10
  AND char_length(bhs_uid) = 10
  AND bhs_uid ~ '^[ -~]{10}$'
  AND btrim(bhs_uid) <> ''
  AND bhs_uid !~* '^ETB-';

CREATE INDEX IF NOT EXISTS idx_bags_beltcon_bhs_pending_confirmation
ON public.bags (screening_received_at ASC, id ASC)
WHERE status = 'IDENTIFIED'
  AND bhs_confirmation_status = 'AWAITING_BHS_CONFIRMATION'
  AND epc IS NULL
  AND rfid_tag_barcode IS NULL;

COMMENT ON COLUMN public.bags.bhs_confirmation_status IS
  'Separate BHS routing/diversion confirmation state. It does not replace the operational bag lifecycle.';
COMMENT ON INDEX public.idx_bags_beltcon_canonical_bhs_uid_ready IS
  'V1 canonical BHS BagID uniqueness for readiness-managed bags in the single-airport BELTCON SBTS baseline.';

-- A legacy duplicate with NULL readiness cannot make the new partial index
-- unsafe. The trigger still prevents any future insert/update from creating a
-- second canonical identity. The repair procedure sets this local flag only
-- while repointing verified-safe references.
CREATE OR REPLACE FUNCTION public.enforce_beltcon_canonical_bhs_uid_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_setting('beltcon.identity_repair', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.bhs_uid IS NULL
    OR octet_length(NEW.bhs_uid) <> 10
    OR char_length(NEW.bhs_uid) <> 10
    OR NEW.bhs_uid !~ '^[ -~]{10}$'
    OR btrim(NEW.bhs_uid) = ''
    OR NEW.bhs_uid ~* '^ETB-'
  THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('beltcon:canonical-bhs:' || NEW.bhs_uid, 0));
  IF EXISTS (
    SELECT 1
    FROM public.bags other_bag
    WHERE other_bag.id <> NEW.id
      AND other_bag.bhs_uid = NEW.bhs_uid
  ) THEN
    RAISE EXCEPTION 'BHS BagID already maps to another canonical bag'
      USING ERRCODE = '23505', CONSTRAINT = 'bags_beltcon_canonical_bhs_uid';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_beltcon_canonical_bhs_uid_v1 ON public.bags;
CREATE TRIGGER enforce_beltcon_canonical_bhs_uid_v1
BEFORE INSERT OR UPDATE OF bhs_uid ON public.bags
FOR EACH ROW EXECUTE FUNCTION public.enforce_beltcon_canonical_bhs_uid_v1();

-- Permit only the tightly-scoped repair function to repoint an immutable X-ray
-- reference. All normal application updates retain the original protection.
CREATE OR REPLACE FUNCTION public.prevent_xray_scan_identity_reassignment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('beltcon.identity_repair', true) = 'true' THEN
    RETURN NEW;
  END IF;
  IF OLD.external_scan_id IS NOT NULL THEN
    IF NEW.source_system IS DISTINCT FROM OLD.source_system
      OR NEW.external_scan_id IS DISTINCT FROM OLD.external_scan_id
      OR NEW.bhs_uid IS DISTINCT FROM OLD.bhs_uid
      OR (OLD.bag_id IS NOT NULL AND NEW.bag_id IS DISTINCT FROM OLD.bag_id)
    THEN
      RAISE EXCEPTION 'X-ray external identity cannot be reassigned' USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Report first; do not execute a destructive merge merely because this
-- migration is deployed. This view is safe for an administrator to review.
CREATE OR REPLACE VIEW public.beltcon_bhs_duplicate_identity_report_v1 AS
SELECT
  bhs_uid,
  array_agg(id ORDER BY created_at NULLS LAST, id) AS bag_ids,
  count(*) AS duplicate_count,
  bool_or(epc IS NOT NULL) AS has_epc,
  bool_or(rfid_tag_barcode IS NOT NULL) AS has_rfid_tag_barcode,
  bool_or(status <> 'IDENTIFIED') AS has_later_lifecycle,
  count(DISTINCT bhs_line_id) FILTER (WHERE bhs_line_id IS NOT NULL) AS line_count,
  count(DISTINCT screening_evaluation_raw) FILTER (WHERE screening_evaluation_raw IS NOT NULL) AS evaluation_count
FROM public.bags
WHERE bhs_uid IS NOT NULL
  AND octet_length(bhs_uid) = 10
  AND char_length(bhs_uid) = 10
  AND bhs_uid ~ '^[ -~]{10}$'
  AND btrim(bhs_uid) <> ''
  AND bhs_uid !~* '^ETB-'
GROUP BY bhs_uid
HAVING count(*) > 1;

CREATE OR REPLACE FUNCTION public.repair_beltcon_safe_bhs_duplicate_v1(
  p_bhs_uid TEXT,
  p_actor_id TEXT,
  p_canonical_role TEXT,
  p_request_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bhs_uid TEXT := p_bhs_uid;
  v_canonical public.bags%ROWTYPE;
  v_duplicate public.bags%ROWTYPE;
  v_count INTEGER;
  v_unsafe_reason TEXT;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF v_bhs_uid IS NULL
    OR octet_length(v_bhs_uid) <> 10
    OR char_length(v_bhs_uid) <> 10
    OR v_bhs_uid !~ '^[ -~]{10}$'
    OR btrim(v_bhs_uid) = ''
    OR v_bhs_uid ~* '^ETB-'
  THEN
    RETURN jsonb_build_object('status', 'INVALID_BHS_UID');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('beltcon:canonical-bhs:' || v_bhs_uid, 0));
  SELECT count(*) INTO v_count FROM public.bags WHERE bhs_uid = v_bhs_uid;
  IF v_count < 2 THEN
    RETURN jsonb_build_object('status', 'NO_DUPLICATES', 'bhsUid', v_bhs_uid);
  END IF;
  IF v_count <> 2 THEN
    v_unsafe_reason := 'MORE_THAN_TWO_DUPLICATES';
  END IF;

  SELECT * INTO v_canonical
  FROM public.bags
  WHERE bhs_uid = v_bhs_uid
  ORDER BY (bhs_confirmation_status = 'CONFIRMED') DESC, created_at ASC NULLS LAST, id ASC
  LIMIT 1 FOR UPDATE;
  SELECT * INTO v_duplicate
  FROM public.bags
  WHERE bhs_uid = v_bhs_uid AND id <> v_canonical.id
  ORDER BY created_at ASC NULLS LAST, id ASC
  LIMIT 1 FOR UPDATE;

  IF v_unsafe_reason IS NULL AND (
    v_canonical.status <> 'IDENTIFIED' OR v_duplicate.status <> 'IDENTIFIED'
    OR v_canonical.epc IS NOT NULL OR v_duplicate.epc IS NOT NULL
    OR v_canonical.rfid_tag_barcode IS NOT NULL OR v_duplicate.rfid_tag_barcode IS NOT NULL
    OR (v_canonical.bhs_line_id IS NOT NULL AND v_duplicate.bhs_line_id IS NOT NULL AND v_canonical.bhs_line_id <> v_duplicate.bhs_line_id)
    OR (v_canonical.screening_evaluation_raw IS NOT NULL AND v_duplicate.screening_evaluation_raw IS NOT NULL AND v_canonical.screening_evaluation_raw <> v_duplicate.screening_evaluation_raw)
    OR EXISTS (SELECT 1 FROM public.alarms WHERE bag_id IN (v_canonical.id, v_duplicate.id))
    OR EXISTS (SELECT 1 FROM public.resolutions WHERE bag_id IN (v_canonical.id, v_duplicate.id))
    OR EXISTS (SELECT 1 FROM public.hbss_recall_requests WHERE bag_id IN (v_canonical.id, v_duplicate.id))
    OR EXISTS (SELECT 1 FROM public.rfid_events WHERE bag_id IN (v_canonical.id, v_duplicate.id))
  ) THEN
    v_unsafe_reason := 'UNSAFE_OPERATIONAL_OR_IDENTITY_CONFLICT';
  END IF;

  IF v_unsafe_reason IS NOT NULL THEN
    INSERT INTO public.audit_events (action, actor_type, actor_id, canonical_role, source_system, outcome, error_code, request_id, metadata)
    VALUES ('BAG_IDENTITY_CONFLICT', 'USER', NULLIF(BTRIM(p_actor_id), ''), NULLIF(BTRIM(p_canonical_role), ''), 'ADMIN_REPAIR', 'CONFLICT', 'BAG_IDENTITY_CONFLICT', NULLIF(BTRIM(p_request_id), ''), jsonb_build_object('bhsUid', v_bhs_uid, 'canonicalBagId', v_canonical.id, 'duplicateBagId', v_duplicate.id, 'reason', v_unsafe_reason));
    RETURN jsonb_build_object('status', 'CONFLICT', 'errorCode', 'BAG_IDENTITY_CONFLICT', 'bhsUid', v_bhs_uid, 'canonicalBagId', v_canonical.id, 'duplicateBagId', v_duplicate.id, 'reason', v_unsafe_reason);
  END IF;

  PERFORM set_config('beltcon.identity_repair', 'true', true);
  UPDATE public.bags SET
    iata_code = COALESCE(v_canonical.iata_code, v_duplicate.iata_code),
    iata_origin = COALESCE(v_canonical.iata_origin, v_duplicate.iata_origin),
    flight = COALESCE(v_canonical.flight, v_duplicate.flight),
    passenger_name = COALESCE(v_canonical.passenger_name, v_duplicate.passenger_name),
    threat_type = COALESCE(v_canonical.threat_type, v_duplicate.threat_type),
    threat_level = COALESCE(v_canonical.threat_level, v_duplicate.threat_level),
    screening_station = COALESCE(v_canonical.screening_station, v_duplicate.screening_station),
    screened_at = COALESCE(v_canonical.screened_at, v_duplicate.screened_at),
    screening_received_at = COALESCE(v_canonical.screening_received_at, v_duplicate.screening_received_at),
    bhs_line_id = COALESCE(v_canonical.bhs_line_id, v_duplicate.bhs_line_id),
    screening_evaluation_raw = COALESCE(v_canonical.screening_evaluation_raw, v_duplicate.screening_evaluation_raw),
    screening_evaluation = COALESCE(v_canonical.screening_evaluation, v_duplicate.screening_evaluation),
    bhs_confirmation_status = CASE WHEN v_canonical.bhs_confirmation_status = 'CONFIRMED' OR v_duplicate.bhs_confirmation_status = 'CONFIRMED' THEN 'CONFIRMED' ELSE COALESCE(v_canonical.bhs_confirmation_status, v_duplicate.bhs_confirmation_status) END,
    bhs_confirmed_at = COALESCE(v_canonical.bhs_confirmed_at, v_duplicate.bhs_confirmed_at),
    tagging_ready_at = COALESCE(v_canonical.tagging_ready_at, v_duplicate.tagging_ready_at),
    bhs_confirmation_event_id = COALESCE(v_canonical.bhs_confirmation_event_id, v_duplicate.bhs_confirmation_event_id),
    updated_at = v_now,
    version = GREATEST(v_canonical.version, v_duplicate.version) + 1
  WHERE id = v_canonical.id;

  UPDATE public.screening_integration_events SET bag_id = v_canonical.id WHERE bag_id = v_duplicate.id;
  UPDATE public.xray_scans SET bag_id = v_canonical.id WHERE bag_id = v_duplicate.id;
  UPDATE public.audit_events SET bag_id = v_canonical.id WHERE bag_id = v_duplicate.id;
  UPDATE public.rfid_events SET bag_id = v_canonical.id WHERE bag_id = v_duplicate.id;

  IF EXISTS (SELECT 1 FROM public.screening_integration_events WHERE bag_id = v_duplicate.id)
    OR EXISTS (SELECT 1 FROM public.xray_scans WHERE bag_id = v_duplicate.id)
    OR EXISTS (SELECT 1 FROM public.rfid_events WHERE bag_id = v_duplicate.id)
  THEN
    RAISE EXCEPTION 'Duplicate references were not fully repointed' USING ERRCODE = '23505';
  END IF;
  DELETE FROM public.bags WHERE id = v_duplicate.id;

  INSERT INTO public.audit_events (action, actor_type, actor_id, canonical_role, bag_id, source_system, outcome, request_id, metadata)
  VALUES ('BAG_IDENTITY_MERGED', 'USER', NULLIF(BTRIM(p_actor_id), ''), NULLIF(BTRIM(p_canonical_role), ''), v_canonical.id, 'ADMIN_REPAIR', 'SUCCESS', NULLIF(BTRIM(p_request_id), ''), jsonb_build_object('bhsUid', v_bhs_uid, 'canonicalBagId', v_canonical.id, 'mergedBagId', v_duplicate.id, 'selection', 'PREFER_CONFIRMED_THEN_OLDEST'));
  RETURN jsonb_build_object('status', 'MERGED', 'bhsUid', v_bhs_uid, 'canonicalBagId', v_canonical.id, 'mergedBagId', v_duplicate.id);
END;
$$;

REVOKE ALL ON FUNCTION public.repair_beltcon_safe_bhs_duplicate_v1(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_beltcon_safe_bhs_duplicate_v1(TEXT, TEXT, TEXT, TEXT) TO service_role;

-- The authoritative RFID association transaction is intentionally redefined
-- rather than trusting UI disabled states.
CREATE OR REPLACE FUNCTION public.assign_beltcon_rfid_tag_v1(
  p_bag_id TEXT, p_rfid_tag_barcode TEXT, p_epc TEXT, p_iata_lpc TEXT,
  p_expected_version INTEGER, p_actor_id TEXT, p_canonical_role TEXT, p_request_id TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW(); v_bag_id TEXT := NULLIF(BTRIM(p_bag_id), '');
  v_barcode TEXT := UPPER(BTRIM(COALESCE(p_rfid_tag_barcode, ''))); v_epc TEXT := UPPER(BTRIM(COALESCE(p_epc, '')));
  v_iata_lpc TEXT := NULLIF(BTRIM(p_iata_lpc), ''); v_bag public.bags%ROWTYPE; v_constraint_name TEXT;
BEGIN
  IF v_bag_id IS NULL THEN RETURN jsonb_build_object('status','INVALID_BAG_ID','errorMessage','Bag ID is required'); END IF;
  IF v_barcode = '' OR length(v_barcode) > 128 OR v_barcode !~ '^[A-Z0-9][A-Z0-9._:/+-]*$' THEN RETURN jsonb_build_object('status','INVALID_BARCODE','errorMessage','RFID tag barcode is invalid'); END IF;
  IF v_epc = '' OR length(v_epc) > 128 OR v_epc !~ '^[A-Z0-9][A-Z0-9._:-]*$' THEN RETURN jsonb_build_object('status','INVALID_EPC','errorMessage','EPC is invalid'); END IF;
  IF v_iata_lpc IS NOT NULL AND v_iata_lpc !~ '^\\d{10}$' THEN RETURN jsonb_build_object('status','INVALID_LPC','errorMessage','IATA Licence Plate Code must be 10 numeric digits'); END IF;
  IF p_expected_version IS NULL OR p_expected_version < 1 THEN RETURN jsonb_build_object('status','INVALID_VERSION','errorMessage','Expected version is required'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('beltcon:tag:' || v_bag_id, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('beltcon:epc:' || v_epc, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('beltcon:barcode:' || v_barcode, 0));
  SELECT * INTO v_bag FROM public.bags WHERE id = v_bag_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','BAG_NOT_FOUND','errorMessage','Bag was not found'); END IF;
  IF NULLIF(BTRIM(v_bag.bhs_uid), '') IS NULL THEN RETURN jsonb_build_object('status','BHS_UID_REQUIRED','errorMessage','BHS BagID is required'); END IF;
  IF v_bag.version <> p_expected_version THEN RETURN jsonb_build_object('status','VERSION_CONFLICT','errorMessage','Bag changed by another operator'); END IF;
  IF v_bag.bhs_confirmation_status IS DISTINCT FROM 'CONFIRMED' THEN
    INSERT INTO public.audit_events(action,actor_type,actor_id,canonical_role,bag_id,source_system,outcome,error_code,request_id,metadata) VALUES ('TAG_ASSIGNMENT_BLOCKED_BHS_CONFIRMATION_REQUIRED','USER',NULLIF(BTRIM(p_actor_id),''),NULLIF(BTRIM(p_canonical_role),''),v_bag.id,v_bag.source_system,'REJECTED','TAG_ASSIGNMENT_BHS_CONFIRMATION_REQUIRED',NULLIF(BTRIM(p_request_id),''),jsonb_build_object('bhsUid',v_bag.bhs_uid,'confirmationStatus',v_bag.bhs_confirmation_status));
    RETURN jsonb_build_object('status','TAG_ASSIGNMENT_BHS_CONFIRMATION_REQUIRED','errorMessage','BHS diversion confirmation is required before assigning an RFID tag');
  END IF;
  IF v_bag.status <> 'IDENTIFIED' OR v_bag.epc IS NOT NULL OR v_bag.rfid_tag_barcode IS NOT NULL OR v_bag.screening_evaluation = 'ACCEPT' THEN RETURN jsonb_build_object('status','BAG_INELIGIBLE','errorMessage','Bag is no longer eligible for RFID tag assignment'); END IF;
  IF EXISTS (SELECT 1 FROM public.bags WHERE id <> v_bag_id AND epc IS NOT NULL AND UPPER(BTRIM(epc)) = v_epc) THEN RETURN jsonb_build_object('status','DUPLICATE_EPC','errorMessage','EPC is already assigned to another bag'); END IF;
  IF EXISTS (SELECT 1 FROM public.bags WHERE id <> v_bag_id AND rfid_tag_barcode IS NOT NULL AND UPPER(BTRIM(rfid_tag_barcode)) = v_barcode AND status <> 'RESOLVED') THEN RETURN jsonb_build_object('status','DUPLICATE_BARCODE','errorMessage','RFID tag barcode is already assigned to another active bag'); END IF;
  UPDATE public.bags SET epc=v_epc,rfid_tag_barcode=v_barcode,iata_code=COALESCE(v_iata_lpc,iata_code),status='TAGGED',tagged_at=v_now,version=version+1,updated_at=v_now WHERE id=v_bag_id AND version=p_expected_version RETURNING * INTO v_bag;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','VERSION_CONFLICT','errorMessage','Bag changed by another operator'); END IF;
  INSERT INTO public.audit_events(action,actor_type,actor_id,canonical_role,bag_id,source_system,outcome,request_id,metadata) VALUES ('RFID_TAG_ASSIGNED','USER',NULLIF(BTRIM(p_actor_id),''),NULLIF(BTRIM(p_canonical_role),''),v_bag.id,v_bag.source_system,'SUCCESS',NULLIF(BTRIM(p_request_id),''),jsonb_build_object('bhsUid',v_bag.bhs_uid,'bhsLineId',v_bag.bhs_line_id,'screeningEvaluation',v_bag.screening_evaluation,'rfidTagBarcode',v_barcode,'epc',v_epc,'previousStatus','IDENTIFIED','newStatus','TAGGED','previousVersion',p_expected_version,'newVersion',v_bag.version,'taggedAt',v_bag.tagged_at));
  RETURN jsonb_build_object('status','ASSIGNED','bag',to_jsonb(v_bag));
EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
  IF v_constraint_name = 'idx_bags_epc_normalized_unique' THEN RETURN jsonb_build_object('status','DUPLICATE_EPC','errorMessage','EPC is already assigned to another bag'); END IF;
  IF v_constraint_name = 'idx_bags_rfid_tag_barcode_active_unique' THEN RETURN jsonb_build_object('status','DUPLICATE_BARCODE','errorMessage','RFID tag barcode is already assigned to another active bag'); END IF;
  RAISE;
END;
$$;

-- Canonical HBSS suspect ingestion. Event identity remains source-scoped, but
-- physical bag matching is serialized by the external BHS BagID alone.
CREATE OR REPLACE FUNCTION public.ingest_screening_suspect_event_v2(
  p_event JSONB,
  p_payload_hash TEXT,
  p_request_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_source_system TEXT := NULLIF(BTRIM(p_event ->> 'sourceSystem'), '');
  v_event_id UUID := (p_event ->> 'eventId')::UUID;
  v_bhs_uid TEXT := p_event #>> '{bag,bhsUid}';
  v_external_scan_id TEXT := NULLIF(BTRIM(p_event #>> '{scan,externalScanId}'), '');
  v_scan_status TEXT := NULLIF(BTRIM(p_event #>> '{scan,status}'), '');
  v_evaluation_raw TEXT := COALESCE(NULLIF(BTRIM(p_event #>> '{screening,evaluationRaw}'), ''), 'R');
  v_evaluation TEXT;
  v_screened_at TIMESTAMPTZ := (p_event #>> '{screening,screenedAt}')::TIMESTAMPTZ;
  v_images JSONB := '[]'::JSONB;
  v_image_count INTEGER := jsonb_array_length(COALESCE(p_event #> '{scan,images}', '[]'::JSONB));
  v_integration_id UUID;
  v_scan_id UUID;
  v_existing_event public.screening_integration_events%ROWTYPE;
  v_bag public.bags%ROWTYPE;
  v_existing_scan public.xray_scans%ROWTYPE;
  v_bag_count INTEGER;
  v_is_duplicate BOOLEAN := FALSE;
  v_failure_sqlstate TEXT;
BEGIN
  IF v_source_system IS NULL OR v_event_id IS NULL OR v_external_scan_id IS NULL
    OR v_scan_status NOT IN ('AVAILABLE', 'PENDING', 'FAILED', 'NOT_FOUND')
    OR p_payload_hash !~ '^[0-9a-f]{64}$'
    OR v_bhs_uid IS NULL OR octet_length(v_bhs_uid) <> 10 OR char_length(v_bhs_uid) <> 10
    OR v_bhs_uid !~ '^[ -~]{10}$' OR btrim(v_bhs_uid) = '' OR v_bhs_uid ~* '^ETB-'
    OR v_evaluation_raw NOT IN ('R', 'T', 'N', '?')
  THEN
    RAISE EXCEPTION 'HBSS suspect event violates the BELTCON SBTS correlation contract' USING ERRCODE = '22023';
  END IF;
  IF v_scan_status = 'AVAILABLE' AND v_image_count = 0 THEN
    RAISE EXCEPTION 'AVAILABLE screening scans require an image reference' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_event #> '{scan,images}', '[]'::JSONB)) image
    WHERE image ->> 'imageRef' !~ '^/mock-xray/'
      OR image ->> 'imageRef' ~ '(^|/)\.\.(/|$)'
      OR image ->> 'mimeType' NOT IN ('image/jpeg', 'image/png')
  ) THEN RAISE EXCEPTION 'Invalid screening image reference' USING ERRCODE = '22023'; END IF;

  v_evaluation := CASE v_evaluation_raw WHEN 'R' THEN 'REJECT' WHEN 'T' THEN 'TIMEOUT' WHEN 'N' THEN 'NO_DECISION' WHEN '?' THEN 'MISTRACK' END;
  PERFORM pg_advisory_xact_lock(hashtextextended('screening:event:' || v_source_system || ':' || v_event_id::TEXT, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('beltcon:canonical-bhs:' || v_bhs_uid, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('screening:scan:' || v_source_system || ':' || v_external_scan_id, 0));

  SELECT * INTO v_existing_event FROM public.screening_integration_events
  WHERE source_system = v_source_system AND event_id = v_event_id FOR UPDATE;
  IF FOUND THEN
    IF v_existing_event.payload_hash <> p_payload_hash THEN
      RETURN jsonb_build_object('status','CONFLICT','eventId',v_event_id,'bagId',v_existing_event.bag_id,'scanId',v_existing_event.xray_scan_id,'scanStatus',NULL,'screeningReceived',FALSE,'bhsConfirmationStatus',NULL,'canAssignTag',FALSE,'errorCode','EVENT_ID_PAYLOAD_CONFLICT','errorMessage','Event ID was already used with a different payload');
    END IF;
    SELECT * INTO v_bag FROM public.bags WHERE id = v_existing_event.bag_id;
    SELECT * INTO v_existing_scan FROM public.xray_scans WHERE id = v_existing_event.xray_scan_id;
    UPDATE public.screening_integration_events SET processing_attempt_count = processing_attempt_count + 1 WHERE id = v_existing_event.id;
    INSERT INTO public.audit_events(action,actor_type,actor_id,bag_id,xray_scan_id,integration_event_id,source_system,outcome,request_id,metadata)
    VALUES ('HBSS_SUSPECT_DETECTED','INTEGRATION',v_source_system,v_existing_event.bag_id,v_existing_event.xray_scan_id,v_existing_event.id,v_source_system,'DUPLICATE',NULLIF(BTRIM(p_request_id),''),jsonb_build_object('eventId',v_event_id,'bhsUid',v_bhs_uid));
    RETURN jsonb_build_object('status','DUPLICATE','eventId',v_event_id,'bagId',v_existing_event.bag_id,'scanId',v_existing_event.xray_scan_id,'scanStatus',v_existing_scan.status,'screeningReceived',v_bag.screening_received_at IS NOT NULL,'bhsConfirmationStatus',v_bag.bhs_confirmation_status,'canAssignTag',v_bag.status='IDENTIFIED' AND v_bag.bhs_confirmation_status='CONFIRMED' AND v_bag.screening_evaluation <> 'ACCEPT' AND v_bag.epc IS NULL AND v_bag.rfid_tag_barcode IS NULL,'errorCode',NULL,'errorMessage',NULL);
  END IF;

  INSERT INTO public.screening_integration_events(event_id,source_system,event_type,schema_version,payload_hash,processing_status,received_at,sanitized_metadata,screening_evaluation,screening_evaluation_raw)
  VALUES(v_event_id,v_source_system,'BAG_SUSPECTED',(p_event ->> 'schemaVersion')::SMALLINT,p_payload_hash,'PROCESSING',v_now,jsonb_build_object('eventId',v_event_id,'bhsUid',v_bhs_uid,'screeningStation',p_event #>> '{screening,station}','imageReferencesOnly',TRUE),v_evaluation,v_evaluation_raw)
  RETURNING id INTO v_integration_id;

  SELECT count(*) INTO v_bag_count FROM public.bags WHERE bhs_uid = v_bhs_uid;
  IF v_bag_count > 1 THEN
    UPDATE public.screening_integration_events SET processing_status='CONFLICT',error_code='BAG_IDENTITY_CONFLICT',error_message='BHS BagID has unresolved duplicate bag records',processed_at=v_now WHERE id=v_integration_id;
    INSERT INTO public.audit_events(action,actor_type,actor_id,integration_event_id,source_system,outcome,error_code,request_id,metadata)
    VALUES ('BAG_IDENTITY_CONFLICT','INTEGRATION',v_source_system,v_integration_id,v_source_system,'CONFLICT','BAG_IDENTITY_CONFLICT',NULLIF(BTRIM(p_request_id),''),jsonb_build_object('bhsUid',v_bhs_uid));
    RETURN jsonb_build_object('status','CONFLICT','eventId',v_event_id,'bagId',NULL,'scanId',NULL,'scanStatus',NULL,'screeningReceived',FALSE,'bhsConfirmationStatus',NULL,'canAssignTag',FALSE,'errorCode','BAG_IDENTITY_CONFLICT','errorMessage','BHS BagID has unresolved duplicate bag records');
  END IF;

  SELECT * INTO v_bag FROM public.bags WHERE bhs_uid = v_bhs_uid FOR UPDATE;
  IF FOUND THEN
    IF v_bag.status IN ('TAGGED','IN_TRANSIT','IN_ARRIVAL_HALL','AT_EXIT','ALARMED','UNDER_RECHECK','AT_RECHECK','RESOLVED','MISSING','ESCAPE_ALERT','ESCALATED') THEN
      UPDATE public.screening_integration_events SET processing_status='CONFLICT',bag_id=v_bag.id,error_code='BAG_LIFECYCLE_CONFLICT',error_message='The existing bag lifecycle cannot be reset',processed_at=v_now WHERE id=v_integration_id;
      RETURN jsonb_build_object('status','CONFLICT','eventId',v_event_id,'bagId',v_bag.id,'scanId',NULL,'scanStatus',NULL,'screeningReceived',FALSE,'bhsConfirmationStatus',v_bag.bhs_confirmation_status,'canAssignTag',FALSE,'errorCode','BAG_LIFECYCLE_CONFLICT','errorMessage','The existing bag lifecycle cannot be reset');
    END IF;
    IF v_bag.screening_evaluation_raw IS NOT NULL AND v_bag.screening_evaluation_raw <> v_evaluation_raw THEN
      UPDATE public.screening_integration_events SET processing_status='CONFLICT',bag_id=v_bag.id,error_code='BHS_CONFIRMATION_CONFLICT',error_message='HBSS screening evaluation conflicts with the canonical bag',processed_at=v_now WHERE id=v_integration_id;
      INSERT INTO public.audit_events(action,actor_type,actor_id,bag_id,integration_event_id,source_system,outcome,error_code,request_id,metadata) VALUES ('BAG_IDENTITY_CONFLICT','INTEGRATION',v_source_system,v_bag.id,v_integration_id,v_source_system,'CONFLICT','BHS_CONFIRMATION_CONFLICT',NULLIF(BTRIM(p_request_id),''),jsonb_build_object('bhsUid',v_bhs_uid,'existingEvaluation',v_bag.screening_evaluation_raw,'receivedEvaluation',v_evaluation_raw));
      RETURN jsonb_build_object('status','CONFLICT','eventId',v_event_id,'bagId',v_bag.id,'scanId',NULL,'scanStatus',NULL,'screeningReceived',FALSE,'bhsConfirmationStatus',v_bag.bhs_confirmation_status,'canAssignTag',FALSE,'errorCode','BHS_CONFIRMATION_CONFLICT','errorMessage','HBSS screening evaluation conflicts with the canonical bag');
    END IF;
    UPDATE public.bags SET
      iata_code=COALESCE(iata_code,NULLIF(BTRIM(p_event #>> '{bag,iataCode}'),'')),iata_origin=COALESCE(iata_origin,NULLIF(BTRIM(p_event #>> '{bag,iataOrigin}'),'')),flight=COALESCE(flight,NULLIF(BTRIM(p_event #>> '{bag,flightNo}'),'')),passenger_name=COALESCE(passenger_name,NULLIF(BTRIM(p_event #>> '{bag,passengerName}'),'')),threat_type=COALESCE(threat_type,NULLIF(BTRIM(p_event #>> '{threat,type}'),'')),threat_level=COALESCE(threat_level,(p_event #>> '{threat,level}')::SMALLINT),screening_station=COALESCE(screening_station,NULLIF(BTRIM(p_event #>> '{screening,station}'),'')),screened_at=COALESCE(screened_at,v_screened_at),screening_received_at=COALESCE(screening_received_at,v_now),screening_evaluation_raw=COALESCE(screening_evaluation_raw,v_evaluation_raw),screening_evaluation=COALESCE(screening_evaluation,v_evaluation),bhs_confirmation_status=CASE WHEN bhs_confirmation_status='CONFIRMED' THEN 'CONFIRMED' ELSE 'AWAITING_BHS_CONFIRMATION' END,updated_at=v_now,version=version+1
    WHERE id=v_bag.id RETURNING * INTO v_bag;
  ELSE
    INSERT INTO public.bags(id,source_system,bhs_uid,iata_code,iata_origin,flight,passenger_name,threat_type,threat_level,screening_station,screened_at,screening_received_at,screening_evaluation_raw,screening_evaluation,bhs_confirmation_status,flagged_at,notes,is_suspect,status,current_zone,created_at,updated_at)
    VALUES('ETB-' || UPPER(SUBSTRING(MD5(v_source_system || ':' || v_event_id::TEXT) FROM 1 FOR 12)),v_source_system,v_bhs_uid,NULLIF(BTRIM(p_event #>> '{bag,iataCode}'),''),NULLIF(BTRIM(p_event #>> '{bag,iataOrigin}'),''),NULLIF(BTRIM(p_event #>> '{bag,flightNo}'),''),NULLIF(BTRIM(p_event #>> '{bag,passengerName}'),''),NULLIF(BTRIM(p_event #>> '{threat,type}'),''),(p_event #>> '{threat,level}')::SMALLINT,NULLIF(BTRIM(p_event #>> '{screening,station}'),''),v_screened_at,v_now,v_evaluation_raw,v_evaluation,'AWAITING_BHS_CONFIRMATION',(p_event ->> 'occurredAt')::TIMESTAMPTZ,NULLIF(BTRIM(p_event #>> '{screening,notes}'),''),TRUE,'IDENTIFIED','TAGGING_STATION',(p_event ->> 'occurredAt')::TIMESTAMPTZ,v_now)
    RETURNING * INTO v_bag;
  END IF;

  SELECT * INTO v_existing_scan FROM public.xray_scans WHERE source_system=v_source_system AND external_scan_id=v_external_scan_id FOR UPDATE;
  IF FOUND THEN
    UPDATE public.screening_integration_events SET processing_status='CONFLICT',bag_id=v_existing_scan.bag_id,xray_scan_id=v_existing_scan.id,error_code='EXTERNAL_SCAN_ID_CONFLICT',error_message='External scan ID is already assigned to another bag',processed_at=v_now WHERE id=v_integration_id;
    RETURN jsonb_build_object('status','CONFLICT','eventId',v_event_id,'bagId',v_existing_scan.bag_id,'scanId',v_existing_scan.id,'scanStatus',v_existing_scan.status,'screeningReceived',FALSE,'bhsConfirmationStatus',v_bag.bhs_confirmation_status,'canAssignTag',FALSE,'errorCode','EXTERNAL_SCAN_ID_CONFLICT','errorMessage','External scan ID is already assigned to another bag');
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',image->>'imageId','label',image->>'label','url',image->>'imageRef','mimeType',image->>'mimeType') ORDER BY image_order),'[]'::JSONB) INTO v_images FROM jsonb_array_elements(COALESCE(p_event #> '{scan,images}','[]'::JSONB)) WITH ORDINALITY images(image,image_order);
  INSERT INTO public.xray_scans(bag_id,bhs_uid,external_scan_id,source_system,status,images,threat_level,threat_type,captured_at,received_at,error_code,error_message,metadata,created_at,updated_at)
  VALUES(v_bag.id,v_bhs_uid,v_external_scan_id,v_source_system,v_scan_status,v_images,(p_event #>> '{threat,level}')::SMALLINT,NULLIF(BTRIM(p_event #>> '{threat,type}'),''),v_screened_at,v_now,CASE WHEN v_scan_status='FAILED' THEN 'SCREENING_REPORTED_FAILED' ELSE NULL END,CASE WHEN v_scan_status='FAILED' THEN 'Screening system reported scan failure' ELSE NULL END,jsonb_build_object('integrationEventId',v_integration_id,'imageReferencesOnly',TRUE),v_now,v_now) RETURNING id INTO v_scan_id;
  UPDATE public.screening_integration_events SET processing_status='ACCEPTED',bag_id=v_bag.id,xray_scan_id=v_scan_id,processed_at=v_now WHERE id=v_integration_id;
  INSERT INTO public.audit_events(action,actor_type,actor_id,bag_id,xray_scan_id,integration_event_id,source_system,outcome,request_id,metadata) VALUES ('HBSS_SUSPECT_DETECTED','INTEGRATION',v_source_system,v_bag.id,v_scan_id,v_integration_id,v_source_system,'SUCCESS',NULLIF(BTRIM(p_request_id),''),jsonb_build_object('bhsUid',v_bhs_uid,'screeningEvaluation',v_evaluation,'screeningEvaluationRaw',v_evaluation_raw));
  IF v_bag.bhs_confirmation_status = 'AWAITING_BHS_CONFIRMATION' THEN INSERT INTO public.audit_events(action,actor_type,actor_id,bag_id,integration_event_id,source_system,outcome,request_id,metadata) VALUES ('BAG_AWAITING_BHS_CONFIRMATION','INTEGRATION',v_source_system,v_bag.id,v_integration_id,v_source_system,'SUCCESS',NULLIF(BTRIM(p_request_id),''),jsonb_build_object('bhsUid',v_bhs_uid)); END IF;
  RETURN jsonb_build_object('status','ACCEPTED','eventId',v_event_id,'bagId',v_bag.id,'scanId',v_scan_id,'scanStatus',v_scan_status,'screeningReceived',TRUE,'bhsConfirmationStatus',v_bag.bhs_confirmation_status,'canAssignTag',v_bag.status='IDENTIFIED' AND v_bag.bhs_confirmation_status='CONFIRMED' AND v_bag.epc IS NULL AND v_bag.rfid_tag_barcode IS NULL,'errorCode',NULL,'errorMessage',NULL);
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_failure_sqlstate = RETURNED_SQLSTATE;
  INSERT INTO public.audit_events(action,actor_type,actor_id,source_system,outcome,error_code,request_id,metadata) VALUES ('SUSPECT_EVENT_FAILED','INTEGRATION',v_source_system,v_source_system,'FAILED','SCREENING_TRANSACTION_FAILED',NULLIF(BTRIM(p_request_id),''),jsonb_build_object('eventId',v_event_id,'databaseCode',v_failure_sqlstate));
  RETURN jsonb_build_object('status','FAILED','eventId',COALESCE(v_event_id::TEXT,'00000000-0000-0000-0000-000000000000'),'bagId',NULL,'scanId',NULL,'scanStatus',NULL,'screeningReceived',FALSE,'bhsConfirmationStatus',NULL,'canAssignTag',FALSE,'errorCode','SCREENING_TRANSACTION_FAILED','errorMessage','Screening event could not be processed');
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_screening_suspect_event_v2(JSONB, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_screening_suspect_event_v2(JSONB, TEXT, TEXT) TO service_role;

-- Canonical semantic BHS 2001 ingestion. It deliberately calls no transport
-- adapter; the server service constructs message 2001 for the simulator and
-- the real integration endpoint uses this same transaction.
CREATE OR REPLACE FUNCTION public.ingest_beltcon_bhs_message_v2(
  p_message JSONB,
  p_source_system TEXT,
  p_message_fingerprint TEXT,
  p_payload_hash TEXT,
  p_event_id UUID,
  p_request_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW(); v_source_system TEXT := NULLIF(BTRIM(p_source_system),'');
  v_message_type INTEGER := (p_message ->> 'messageType')::INTEGER; v_trigger INTEGER := (p_message ->> 'trigger')::INTEGER;
  v_line_id TEXT := p_message ->> 'lineId'; v_bhs_uid TEXT := p_message ->> 'bhsUid'; v_evaluation_raw TEXT := p_message ->> 'evaluation';
  v_evaluation TEXT; v_tagging_eligible BOOLEAN; v_event public.screening_integration_events%ROWTYPE; v_bag public.bags%ROWTYPE;
  v_bag_count INTEGER; v_bag_id TEXT; v_sqlstate TEXT;
BEGIN
  IF v_source_system IS NULL OR p_event_id IS NULL OR NULLIF(BTRIM(p_message_fingerprint),'') IS NULL OR p_payload_hash !~ '^[0-9a-f]{64}$'
    OR v_message_type IS DISTINCT FROM 2001 OR v_trigger IS DISTINCT FROM 1
    OR v_line_id IS NULL OR octet_length(v_line_id) <> 2 OR char_length(v_line_id) <> 2 OR v_line_id !~ '^[ -~]{2}$' OR v_line_id <> btrim(v_line_id)
    OR v_bhs_uid IS NULL OR octet_length(v_bhs_uid) <> 10 OR char_length(v_bhs_uid) <> 10 OR v_bhs_uid !~ '^[ -~]{10}$' OR btrim(v_bhs_uid) = '' OR v_bhs_uid ~* '^ETB-'
    OR v_evaluation_raw NOT IN ('A','R','T','N','?')
  THEN RAISE EXCEPTION 'BHS message violates the BELTCON SBTS semantic contract' USING ERRCODE='22023'; END IF;
  v_evaluation := CASE v_evaluation_raw WHEN 'A' THEN 'ACCEPT' WHEN 'R' THEN 'REJECT' WHEN 'T' THEN 'TIMEOUT' WHEN 'N' THEN 'NO_DECISION' WHEN '?' THEN 'MISTRACK' END;
  v_tagging_eligible := v_evaluation <> 'ACCEPT';
  PERFORM pg_advisory_xact_lock(hashtextextended('beltcon:canonical-bhs:' || v_bhs_uid, 0));
  INSERT INTO public.screening_integration_events(event_id,source_system,event_type,schema_version,payload_hash,processing_status,received_at,sanitized_metadata,protocol_name,protocol_version,message_type,message_direction,bhs_line_id,screening_evaluation,screening_evaluation_raw,message_fingerprint,processing_attempt_count)
  VALUES(p_event_id,v_source_system,'BHS_MESSAGE',1,p_payload_hash,'PROCESSING',v_now,jsonb_build_object('trigger',v_trigger,'lineId',v_line_id,'bhsUid',v_bhs_uid,'evaluationRaw',v_evaluation_raw,'evaluation',v_evaluation),'BELTCON_SBTS_SEMANTIC_V1','1',2001,'INBOUND',v_line_id,v_evaluation,v_evaluation_raw,p_message_fingerprint,1)
  ON CONFLICT(source_system,message_fingerprint) WHERE message_type=2001 AND message_fingerprint IS NOT NULL DO NOTHING RETURNING * INTO v_event;
  IF NOT FOUND THEN
    SELECT * INTO v_event FROM public.screening_integration_events WHERE source_system=v_source_system AND message_type=2001 AND message_fingerprint=p_message_fingerprint FOR UPDATE;
    UPDATE public.screening_integration_events SET processing_attempt_count=processing_attempt_count+1 WHERE id=v_event.id RETURNING * INTO v_event;
    INSERT INTO public.audit_events(action,actor_type,actor_id,bag_id,integration_event_id,source_system,outcome,request_id,metadata) VALUES ('BHS_MESSAGE_DUPLICATE','INTEGRATION',v_source_system,v_event.bag_id,v_event.id,v_source_system,'DUPLICATE',NULLIF(BTRIM(p_request_id),''),jsonb_build_object('bhsUid',v_bhs_uid,'lineId',v_line_id,'evaluationRaw',v_evaluation_raw));
    SELECT * INTO v_bag FROM public.bags WHERE id=v_event.bag_id;
    RETURN jsonb_build_object('status','DUPLICATE','integrationEventId',v_event.id,'bagId',v_event.bag_id,'bhsUid',v_bhs_uid,'lineId',v_line_id,'evaluation',v_evaluation,'taggingEligible',v_tagging_eligible,'bhsConfirmationStatus',v_bag.bhs_confirmation_status,'canAssignTag',v_bag.status='IDENTIFIED' AND v_bag.bhs_confirmation_status='CONFIRMED' AND v_bag.screening_evaluation <> 'ACCEPT' AND v_bag.epc IS NULL AND v_bag.rfid_tag_barcode IS NULL,'processingAttemptCount',v_event.processing_attempt_count,'errorCode',NULL,'errorMessage',NULL);
  END IF;
  SELECT count(*) INTO v_bag_count FROM public.bags WHERE bhs_uid=v_bhs_uid;
  IF v_bag_count > 1 THEN
    UPDATE public.screening_integration_events SET processing_status='CONFLICT',error_code='BAG_IDENTITY_CONFLICT',error_message='BHS BagID has unresolved duplicate bag records',processed_at=v_now,acknowledgement_outcome='REJECTED',acknowledgement_timing='AFTER_DURABLE_COMMIT',acknowledged_at=v_now WHERE id=v_event.id;
    INSERT INTO public.audit_events(action,actor_type,actor_id,integration_event_id,source_system,outcome,error_code,request_id,metadata) VALUES ('BAG_IDENTITY_CONFLICT','INTEGRATION',v_source_system,v_event.id,v_source_system,'CONFLICT','BAG_IDENTITY_CONFLICT',NULLIF(BTRIM(p_request_id),''),jsonb_build_object('bhsUid',v_bhs_uid));
    RETURN jsonb_build_object('status','CONFLICT','integrationEventId',v_event.id,'bagId',NULL,'bhsUid',v_bhs_uid,'lineId',v_line_id,'evaluation',v_evaluation,'taggingEligible',FALSE,'bhsConfirmationStatus',NULL,'canAssignTag',FALSE,'processingAttemptCount',1,'errorCode','BAG_IDENTITY_CONFLICT','errorMessage','BHS BagID has unresolved duplicate bag records');
  END IF;
  SELECT * INTO v_bag FROM public.bags WHERE bhs_uid=v_bhs_uid FOR UPDATE;
  IF FOUND AND (
    (v_bag.screening_evaluation_raw IS NOT NULL AND v_bag.screening_evaluation_raw <> v_evaluation_raw)
    OR (v_bag.bhs_confirmation_status='CONFIRMED' AND v_bag.bhs_line_id IS NOT NULL AND v_bag.bhs_line_id <> v_line_id)
    OR v_bag.status IN ('TAGGED','IN_TRANSIT','IN_ARRIVAL_HALL','AT_EXIT','ALARMED','UNDER_RECHECK','AT_RECHECK','RESOLVED','MISSING','ESCAPE_ALERT','ESCALATED')
  ) THEN
    UPDATE public.screening_integration_events SET processing_status='CONFLICT',bag_id=v_bag.id,error_code='BHS_CONFIRMATION_CONFLICT',error_message='BHS confirmation conflicts with the canonical bag',processed_at=v_now,acknowledgement_outcome='REJECTED',acknowledgement_timing='AFTER_DURABLE_COMMIT',acknowledged_at=v_now WHERE id=v_event.id;
    INSERT INTO public.audit_events(action,actor_type,actor_id,bag_id,integration_event_id,source_system,outcome,error_code,request_id,metadata) VALUES ('BHS_MESSAGE_REJECTED','INTEGRATION',v_source_system,v_bag.id,v_event.id,v_source_system,'CONFLICT','BHS_CONFIRMATION_CONFLICT',NULLIF(BTRIM(p_request_id),''),jsonb_build_object('bhsUid',v_bhs_uid,'lineId',v_line_id));
    RETURN jsonb_build_object('status','CONFLICT','integrationEventId',v_event.id,'bagId',v_bag.id,'bhsUid',v_bhs_uid,'lineId',v_line_id,'evaluation',v_evaluation,'taggingEligible',FALSE,'bhsConfirmationStatus',v_bag.bhs_confirmation_status,'canAssignTag',FALSE,'processingAttemptCount',1,'errorCode','BHS_CONFIRMATION_CONFLICT','errorMessage','BHS confirmation conflicts with the canonical bag');
  END IF;
  IF v_tagging_eligible THEN
    IF FOUND THEN
      UPDATE public.bags SET bhs_line_id=v_line_id,screening_evaluation_raw=COALESCE(screening_evaluation_raw,v_evaluation_raw),screening_evaluation=COALESCE(screening_evaluation,v_evaluation),bhs_confirmation_status='CONFIRMED',bhs_confirmed_at=COALESCE(bhs_confirmed_at,v_now),tagging_ready_at=COALESCE(tagging_ready_at,v_now),bhs_confirmation_event_id=v_event.id,updated_at=v_now,version=version+1 WHERE id=v_bag.id RETURNING * INTO v_bag;
    ELSE
      v_bag_id := 'ETB-' || UPPER(SUBSTRING(MD5(v_source_system || ':' || p_message_fingerprint) FROM 1 FOR 12));
      INSERT INTO public.bags(id,source_system,bhs_uid,bhs_line_id,screening_evaluation,screening_evaluation_raw,bhs_confirmation_status,bhs_confirmed_at,tagging_ready_at,bhs_confirmation_event_id,epc,rfid_tag_barcode,flight,is_suspect,status,current_zone,flagged_at,created_at,updated_at)
      VALUES(v_bag_id,v_source_system,v_bhs_uid,v_line_id,v_evaluation,v_evaluation_raw,'CONFIRMED',v_now,v_now,v_event.id,NULL,NULL,NULL,TRUE,'IDENTIFIED','TAGGING_STATION',v_now,v_now,v_now) RETURNING * INTO v_bag;
      INSERT INTO public.audit_events(action,actor_type,actor_id,bag_id,integration_event_id,source_system,outcome,request_id,metadata) VALUES ('BHS_BAG_CREATED','INTEGRATION',v_source_system,v_bag.id,v_event.id,v_source_system,'SUCCESS',NULLIF(BTRIM(p_request_id),''),jsonb_build_object('bhsUid',v_bhs_uid,'lineId',v_line_id,'evaluation',v_evaluation));
    END IF;
  END IF;
  UPDATE public.screening_integration_events SET processing_status='ACCEPTED',bag_id=CASE WHEN v_tagging_eligible THEN v_bag.id ELSE NULL END,processed_at=v_now,acknowledgement_outcome='ACCEPTED',acknowledgement_timing='AFTER_DURABLE_COMMIT',acknowledged_at=v_now WHERE id=v_event.id;
  IF v_tagging_eligible THEN
    INSERT INTO public.audit_events(action,actor_type,actor_id,bag_id,integration_event_id,source_system,outcome,request_id,metadata) VALUES ('BHS_DIVERSION_CONFIRMED','INTEGRATION',v_source_system,v_bag.id,v_event.id,v_source_system,'SUCCESS',NULLIF(BTRIM(p_request_id),''),jsonb_build_object('bhsUid',v_bhs_uid,'lineId',v_line_id,'screeningEvaluation',v_evaluation));
    INSERT INTO public.audit_events(action,actor_type,actor_id,bag_id,integration_event_id,source_system,outcome,request_id,metadata) VALUES ('BAG_READY_FOR_TAGGING','INTEGRATION',v_source_system,v_bag.id,v_event.id,v_source_system,'SUCCESS',NULLIF(BTRIM(p_request_id),''),jsonb_build_object('bhsUid',v_bhs_uid));
  END IF;
  RETURN jsonb_build_object('status','ACCEPTED','integrationEventId',v_event.id,'bagId',CASE WHEN v_tagging_eligible THEN v_bag.id ELSE NULL END,'bhsUid',v_bhs_uid,'lineId',v_line_id,'evaluation',v_evaluation,'taggingEligible',v_tagging_eligible,'bhsConfirmationStatus',CASE WHEN v_tagging_eligible THEN 'CONFIRMED' ELSE NULL END,'canAssignTag',v_tagging_eligible,'processingAttemptCount',1,'errorCode',NULL,'errorMessage',NULL);
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  INSERT INTO public.audit_events(action,actor_type,actor_id,source_system,outcome,error_code,request_id,metadata) VALUES ('BHS_MESSAGE_FAILED','INTEGRATION',v_source_system,v_source_system,'FAILED','BHS_PROCESSING_FAILED',NULLIF(BTRIM(p_request_id),''),jsonb_build_object('databaseCode',v_sqlstate));
  RETURN jsonb_build_object('status','FAILED','integrationEventId',NULL,'bagId',NULL,'bhsUid',COALESCE(v_bhs_uid,''),'lineId',COALESCE(v_line_id,''),'evaluation',NULL,'taggingEligible',FALSE,'bhsConfirmationStatus',NULL,'canAssignTag',FALSE,'processingAttemptCount',0,'errorCode','BHS_PROCESSING_FAILED','errorMessage','BHS message could not be processed');
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_beltcon_bhs_message_v2(JSONB, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_beltcon_bhs_message_v2(JSONB, TEXT, TEXT, TEXT, UUID, TEXT) TO service_role;
