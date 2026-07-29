-- BELTCON SBTS Baseline V1: atomically associate the physical RFID label
-- barcode and EPC with an eligible BHS BagID. This is an association only;
-- it does not encode hardware, create alarms, or create X-ray records.

CREATE UNIQUE INDEX IF NOT EXISTS idx_bags_rfid_tag_barcode_active_unique
ON public.bags ((UPPER(BTRIM(rfid_tag_barcode))))
WHERE rfid_tag_barcode IS NOT NULL
  AND BTRIM(rfid_tag_barcode) <> ''
  AND status <> 'RESOLVED';

CREATE OR REPLACE FUNCTION public.assign_beltcon_rfid_tag_v1(
  p_bag_id TEXT,
  p_rfid_tag_barcode TEXT,
  p_epc TEXT,
  p_iata_lpc TEXT,
  p_expected_version INTEGER,
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
  v_now TIMESTAMPTZ := NOW();
  v_bag_id TEXT := NULLIF(BTRIM(p_bag_id), '');
  v_barcode TEXT := UPPER(BTRIM(COALESCE(p_rfid_tag_barcode, '')));
  v_epc TEXT := UPPER(BTRIM(COALESCE(p_epc, '')));
  v_iata_lpc TEXT := NULLIF(BTRIM(p_iata_lpc), '');
  v_bag public.bags%ROWTYPE;
  v_constraint_name TEXT;
BEGIN
  IF v_bag_id IS NULL THEN RETURN JSONB_BUILD_OBJECT('status','INVALID_BAG_ID','errorMessage','Bag ID is required'); END IF;
  IF v_barcode = '' OR LENGTH(v_barcode) > 128 OR v_barcode !~ '^[A-Z0-9][A-Z0-9._:/+-]*$' THEN
    RETURN JSONB_BUILD_OBJECT('status','INVALID_BARCODE','errorMessage','RFID tag barcode is invalid');
  END IF;
  IF v_epc = '' OR LENGTH(v_epc) > 128 OR v_epc !~ '^[A-Z0-9][A-Z0-9._:-]*$' THEN
    RETURN JSONB_BUILD_OBJECT('status','INVALID_EPC','errorMessage','EPC is invalid');
  END IF;
  IF v_iata_lpc IS NOT NULL AND v_iata_lpc !~ '^\\d{10}$' THEN
    RETURN JSONB_BUILD_OBJECT('status','INVALID_LPC','errorMessage','IATA Licence Plate Code must be 10 numeric digits');
  END IF;
  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RETURN JSONB_BUILD_OBJECT('status','INVALID_VERSION','errorMessage','Expected version is required');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('beltcon:tag:' || v_bag_id, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('beltcon:epc:' || v_epc, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('beltcon:barcode:' || v_barcode, 0));
  SELECT * INTO v_bag FROM public.bags WHERE id = v_bag_id FOR UPDATE;
  IF NOT FOUND THEN RETURN JSONB_BUILD_OBJECT('status','BAG_NOT_FOUND','errorMessage','Bag was not found'); END IF;
  IF NULLIF(BTRIM(v_bag.bhs_uid), '') IS NULL THEN RETURN JSONB_BUILD_OBJECT('status','BHS_UID_REQUIRED','errorMessage','BHS BagID is required'); END IF;
  IF v_bag.version <> p_expected_version THEN RETURN JSONB_BUILD_OBJECT('status','VERSION_CONFLICT','errorMessage','Bag changed by another operator'); END IF;
  IF v_bag.status <> 'IDENTIFIED' OR v_bag.epc IS NOT NULL OR v_bag.rfid_tag_barcode IS NOT NULL THEN
    RETURN JSONB_BUILD_OBJECT('status','BAG_INELIGIBLE','errorMessage','Bag is no longer eligible for RFID tag assignment');
  END IF;
  IF EXISTS (SELECT 1 FROM public.bags WHERE id <> v_bag_id AND epc IS NOT NULL AND UPPER(BTRIM(epc)) = v_epc) THEN
    RETURN JSONB_BUILD_OBJECT('status','DUPLICATE_EPC','errorMessage','EPC is already assigned to another bag');
  END IF;
  IF EXISTS (SELECT 1 FROM public.bags WHERE id <> v_bag_id AND rfid_tag_barcode IS NOT NULL AND UPPER(BTRIM(rfid_tag_barcode)) = v_barcode AND status <> 'RESOLVED') THEN
    RETURN JSONB_BUILD_OBJECT('status','DUPLICATE_BARCODE','errorMessage','RFID tag barcode is already assigned to another active bag');
  END IF;

  UPDATE public.bags
  SET epc = v_epc, rfid_tag_barcode = v_barcode, iata_code = COALESCE(v_iata_lpc, iata_code),
      status = 'TAGGED', tagged_at = v_now, version = version + 1, updated_at = v_now
  WHERE id = v_bag_id AND version = p_expected_version
  RETURNING * INTO v_bag;
  IF NOT FOUND THEN RETURN JSONB_BUILD_OBJECT('status','VERSION_CONFLICT','errorMessage','Bag changed by another operator'); END IF;

  INSERT INTO public.audit_events (action, actor_type, actor_id, canonical_role, bag_id, source_system, outcome, request_id, metadata)
  VALUES ('RFID_TAG_ASSIGNED','USER',NULLIF(BTRIM(p_actor_id),''),NULLIF(BTRIM(p_canonical_role),''),v_bag.id,v_bag.source_system,'SUCCESS',NULLIF(BTRIM(p_request_id),''),
    JSONB_BUILD_OBJECT('bhsUid',v_bag.bhs_uid,'bhsLineId',v_bag.bhs_line_id,'screeningEvaluation',v_bag.screening_evaluation,'rfidTagBarcode',v_barcode,'epc',v_epc,'iataLpcProvided',v_iata_lpc IS NOT NULL,'previousStatus','IDENTIFIED','newStatus','TAGGED','previousVersion',p_expected_version,'newVersion',v_bag.version,'taggedAt',v_bag.tagged_at));
  RETURN JSONB_BUILD_OBJECT('status','ASSIGNED','bag',TO_JSONB(v_bag));
EXCEPTION WHEN UNIQUE_VIOLATION THEN
  GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
  IF v_constraint_name = 'idx_bags_epc_normalized_unique' THEN RETURN JSONB_BUILD_OBJECT('status','DUPLICATE_EPC','errorMessage','EPC is already assigned to another bag'); END IF;
  IF v_constraint_name = 'idx_bags_rfid_tag_barcode_active_unique' THEN RETURN JSONB_BUILD_OBJECT('status','DUPLICATE_BARCODE','errorMessage','RFID tag barcode is already assigned to another active bag'); END IF;
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_beltcon_rfid_tag_v1(TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_beltcon_rfid_tag_v1(TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT) TO service_role;
