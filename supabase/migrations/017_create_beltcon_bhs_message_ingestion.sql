-- Authoritative BELTCON SBTS semantic BHS message ingestion.
--
-- This migration deliberately processes semantic message 2001 data only. It
-- does not open Profinet connections, emit a physical acknowledgement byte,
-- create alarms, create X-ray data, or modify browser state.

-- A semantic BHS 2001 message does not contain flight details. Existing
-- legacy screening records retain their flight values; new minimal BHS bags
-- may leave this optional value unset.
ALTER TABLE public.bags
  ALTER COLUMN flight DROP NOT NULL;

-- Migration 007 restricted this value to BAG_SUSPECTED. The same durable
-- integration-event table now also records semantic BHS messages.
ALTER TABLE public.screening_integration_events
  DROP CONSTRAINT IF EXISTS screening_integration_events_event_type_check;

ALTER TABLE public.screening_integration_events
  ADD CONSTRAINT screening_integration_events_event_type_check
  CHECK (event_type IN ('BAG_SUSPECTED', 'BHS_MESSAGE'));

-- Migration 016 already owns the partial unique index on
-- (source_system, message_fingerprint) for message_type 2001. Reuse it here
-- rather than creating a second, overlapping idempotency index.

CREATE OR REPLACE FUNCTION public.ingest_beltcon_bhs_message_v1(
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
  v_now TIMESTAMPTZ := NOW();
  v_source_system TEXT := NULLIF(BTRIM(p_source_system), '');
  v_message_type INTEGER;
  v_trigger INTEGER;
  v_line_id TEXT;
  v_bhs_uid TEXT;
  v_evaluation_raw TEXT;
  v_evaluation TEXT;
  v_tagging_eligible BOOLEAN;
  v_event public.screening_integration_events%ROWTYPE;
  v_bag public.bags%ROWTYPE;
  v_has_existing_bag BOOLEAN := FALSE;
  v_event_id UUID;
  v_bag_id TEXT;
  v_sqlstate TEXT;
BEGIN
  v_message_type := (p_message ->> 'messageType')::INTEGER;
  v_trigger := (p_message ->> 'trigger')::INTEGER;
  v_line_id := p_message ->> 'lineId';
  v_bhs_uid := p_message ->> 'bhsUid';
  v_evaluation_raw := p_message ->> 'evaluation';

  IF v_source_system IS NULL
    OR p_event_id IS NULL
    OR NULLIF(BTRIM(p_message_fingerprint), '') IS NULL
    OR p_payload_hash IS NULL
    OR p_payload_hash !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'Required BHS integration identity fields are invalid'
      USING ERRCODE = '22023';
  END IF;

  IF v_message_type IS DISTINCT FROM 2001
    OR v_trigger IS DISTINCT FROM 1
    OR v_line_id IS NULL
    OR octet_length(v_line_id) <> 2
    OR char_length(v_line_id) <> 2
    OR v_line_id !~ '^[ -~]{2}$'
    OR v_line_id <> BTRIM(v_line_id)
    OR v_bhs_uid IS NULL
    OR octet_length(v_bhs_uid) <> 10
    OR char_length(v_bhs_uid) <> 10
    OR v_bhs_uid !~ '^[ -~]{10}$'
    OR BTRIM(v_bhs_uid) = ''
    OR v_bhs_uid ~* '^ETB-'
    OR v_evaluation_raw IS NULL
    OR v_evaluation_raw NOT IN ('A', 'R', 'T', 'N', '?')
  THEN
    RAISE EXCEPTION 'BHS message violates the SBTS Baseline V1 contract'
      USING ERRCODE = '22023';
  END IF;

  v_evaluation := CASE v_evaluation_raw
    WHEN 'A' THEN 'ACCEPT'
    WHEN 'R' THEN 'REJECT'
    WHEN 'T' THEN 'TIMEOUT'
    WHEN 'N' THEN 'NO_DECISION'
    WHEN '?' THEN 'MISTRACK'
  END;
  v_tagging_eligible := v_evaluation <> 'ACCEPT';

  -- A source and fingerprint identify one committed semantic message. The
  -- partial unique index from migration 016 is the final concurrency guard.
  INSERT INTO public.screening_integration_events (
    event_id,
    source_system,
    event_type,
    schema_version,
    payload_hash,
    processing_status,
    received_at,
    sanitized_metadata,
    protocol_name,
    protocol_version,
    message_type,
    message_direction,
    bhs_line_id,
    screening_evaluation,
    screening_evaluation_raw,
    message_fingerprint,
    processing_attempt_count
  )
  VALUES (
    p_event_id,
    v_source_system,
    'BHS_MESSAGE',
    1,
    p_payload_hash,
    'PROCESSING',
    v_now,
    JSONB_BUILD_OBJECT(
      'trigger', v_trigger,
      'lineId', v_line_id,
      'bhsUid', v_bhs_uid,
      'evaluationRaw', v_evaluation_raw,
      'evaluation', v_evaluation
    ),
    'BELTCON_SBTS_SEMANTIC_V1',
    '1',
    2001,
    'INBOUND',
    v_line_id,
    v_evaluation,
    v_evaluation_raw,
    p_message_fingerprint,
    1
  )
  ON CONFLICT (source_system, message_fingerprint)
    WHERE message_type = 2001 AND message_fingerprint IS NOT NULL
    DO NOTHING
  RETURNING * INTO v_event;

  IF NOT FOUND THEN
    SELECT *
    INTO v_event
    FROM public.screening_integration_events
    WHERE source_system = v_source_system
      AND message_type = 2001
      AND message_fingerprint = p_message_fingerprint
    FOR UPDATE;

    UPDATE public.screening_integration_events
    SET processing_attempt_count = processing_attempt_count + 1
    WHERE id = v_event.id
    RETURNING * INTO v_event;

    INSERT INTO public.audit_events (
      action, actor_type, actor_id, integration_event_id, source_system,
      outcome, request_id, metadata
    ) VALUES (
      'BHS_MESSAGE_DUPLICATE', 'INTEGRATION', v_source_system, v_event.id,
      v_source_system, 'DUPLICATE', NULLIF(BTRIM(p_request_id), ''),
      JSONB_BUILD_OBJECT(
        'bhsUid', v_bhs_uid,
        'lineId', v_line_id,
        'evaluationRaw', v_evaluation_raw,
        'evaluation', v_evaluation,
        'processingAttemptCount', v_event.processing_attempt_count
      )
    );

    RETURN JSONB_BUILD_OBJECT(
      'status', 'DUPLICATE',
      'integrationEventId', v_event.id,
      'bagId', v_event.bag_id,
      'bhsUid', v_bhs_uid,
      'lineId', v_line_id,
      'evaluation', v_evaluation,
      'taggingEligible', v_evaluation <> 'ACCEPT',
      'processingAttemptCount', v_event.processing_attempt_count,
      'errorCode', NULL,
      'errorMessage', NULL
    );
  END IF;

  INSERT INTO public.audit_events (
    action, actor_type, actor_id, integration_event_id, source_system,
    outcome, request_id, metadata
  ) VALUES (
    'BHS_MESSAGE_RECEIVED', 'INTEGRATION', v_source_system, v_event.id,
    v_source_system, 'RECEIVED', NULLIF(BTRIM(p_request_id), ''),
    JSONB_BUILD_OBJECT(
      'bhsUid', v_bhs_uid,
      'lineId', v_line_id,
      'evaluationRaw', v_evaluation_raw,
      'evaluation', v_evaluation
    )
  );

  SELECT *
  INTO v_bag
  FROM public.bags
  WHERE source_system = v_source_system
    AND bhs_uid = v_bhs_uid
  FOR UPDATE;

  v_has_existing_bag := FOUND;

  IF v_has_existing_bag AND (
    (v_bag.bhs_line_id IS NOT NULL AND v_bag.bhs_line_id <> v_line_id)
    OR (v_bag.screening_evaluation_raw IS NOT NULL
      AND v_bag.screening_evaluation_raw <> v_evaluation_raw)
    OR (v_bag.screening_evaluation IS NOT NULL
      AND v_bag.screening_evaluation <> v_evaluation)
  ) THEN
    UPDATE public.screening_integration_events
    SET
      processing_status = 'CONFLICT',
      bag_id = v_bag.id,
      error_code = 'BHS_BAG_CONFLICT',
      error_message = 'BHS message conflicts with the existing bag identity',
      processed_at = v_now,
      acknowledgement_outcome = 'REJECTED',
      acknowledgement_timing = 'AFTER_DURABLE_COMMIT',
      acknowledged_at = v_now
    WHERE id = v_event.id;

    INSERT INTO public.audit_events (
      action, actor_type, actor_id, bag_id, integration_event_id, source_system,
      outcome, error_code, request_id, metadata
    ) VALUES (
      'BHS_MESSAGE_REJECTED', 'INTEGRATION', v_source_system, v_bag.id,
      v_event.id, v_source_system, 'CONFLICT', 'BHS_BAG_CONFLICT',
      NULLIF(BTRIM(p_request_id), ''),
      JSONB_BUILD_OBJECT('bhsUid', v_bhs_uid, 'lineId', v_line_id)
    );

    RETURN JSONB_BUILD_OBJECT(
      'status', 'CONFLICT',
      'integrationEventId', v_event.id,
      'bagId', v_bag.id,
      'bhsUid', v_bhs_uid,
      'lineId', v_line_id,
      'evaluation', v_evaluation,
      'taggingEligible', v_tagging_eligible,
      'processingAttemptCount', 1,
      'errorCode', 'BHS_BAG_CONFLICT',
      'errorMessage', 'BHS message conflicts with the existing bag identity'
    );
  END IF;

  IF v_tagging_eligible THEN
    IF NOT v_has_existing_bag THEN
      v_bag_id := 'ETB-' || UPPER(SUBSTRING(MD5(v_source_system || ':' || p_message_fingerprint) FROM 1 FOR 12));

      INSERT INTO public.bags (
        id, source_system, bhs_uid, bhs_line_id,
        screening_evaluation, screening_evaluation_raw, epc, rfid_tag_barcode,
        flight, is_suspect, status, current_zone, flagged_at, created_at, updated_at
      ) VALUES (
        v_bag_id, v_source_system, v_bhs_uid, v_line_id,
        v_evaluation, v_evaluation_raw, NULL, NULL,
        NULL, TRUE, 'IDENTIFIED', 'TAGGING_STATION', v_now, v_now, v_now
      )
      RETURNING * INTO v_bag;

      INSERT INTO public.audit_events (
        action, actor_type, actor_id, bag_id, integration_event_id, source_system,
        outcome, request_id, metadata
      ) VALUES (
        'BHS_BAG_CREATED', 'INTEGRATION', v_source_system, v_bag.id,
        v_event.id, v_source_system, 'SUCCESS', NULLIF(BTRIM(p_request_id), ''),
        JSONB_BUILD_OBJECT('bhsUid', v_bhs_uid, 'lineId', v_line_id, 'evaluation', v_evaluation)
      );
    ELSE
      UPDATE public.bags
      SET
        bhs_line_id = COALESCE(bhs_line_id, v_line_id),
        screening_evaluation_raw = COALESCE(screening_evaluation_raw, v_evaluation_raw),
        screening_evaluation = COALESCE(screening_evaluation, v_evaluation),
        updated_at = v_now
      WHERE id = v_bag.id
      RETURNING * INTO v_bag;

      INSERT INTO public.audit_events (
        action, actor_type, actor_id, bag_id, integration_event_id, source_system,
        outcome, request_id, metadata
      ) VALUES (
        'BHS_BAG_LINKED', 'INTEGRATION', v_source_system, v_bag.id,
        v_event.id, v_source_system, 'SUCCESS', NULLIF(BTRIM(p_request_id), ''),
        JSONB_BUILD_OBJECT('bhsUid', v_bhs_uid, 'lineId', v_line_id, 'evaluation', v_evaluation)
      );
    END IF;
  END IF;

  UPDATE public.screening_integration_events
  SET
    processing_status = 'ACCEPTED',
    bag_id = CASE WHEN v_tagging_eligible THEN v_bag.id ELSE NULL END,
    processed_at = v_now,
    acknowledgement_outcome = 'ACCEPTED',
    acknowledgement_timing = 'AFTER_DURABLE_COMMIT',
    acknowledged_at = v_now
  WHERE id = v_event.id;

  INSERT INTO public.audit_events (
    action, actor_type, actor_id, bag_id, integration_event_id, source_system,
    outcome, request_id, metadata
  ) VALUES (
    'BHS_MESSAGE_ACCEPTED', 'INTEGRATION', v_source_system,
    CASE WHEN v_tagging_eligible THEN v_bag.id ELSE NULL END, v_event.id,
    v_source_system, 'SUCCESS', NULLIF(BTRIM(p_request_id), ''),
    JSONB_BUILD_OBJECT(
      'bhsUid', v_bhs_uid,
      'lineId', v_line_id,
      'evaluationRaw', v_evaluation_raw,
      'evaluation', v_evaluation,
      'taggingEligible', v_tagging_eligible
    )
  );

  RETURN JSONB_BUILD_OBJECT(
    'status', 'ACCEPTED',
    'integrationEventId', v_event.id,
    'bagId', CASE WHEN v_tagging_eligible THEN v_bag.id ELSE NULL END,
    'bhsUid', v_bhs_uid,
    'lineId', v_line_id,
    'evaluation', v_evaluation,
    'taggingEligible', v_tagging_eligible,
    'processingAttemptCount', 1,
    'errorCode', NULL,
    'errorMessage', NULL
  );

EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;

    INSERT INTO public.audit_events (
      action, actor_type, actor_id, source_system, outcome, error_code,
      request_id, metadata
    ) VALUES (
      'BHS_MESSAGE_FAILED', 'INTEGRATION', v_source_system, v_source_system,
      'FAILED', 'BHS_PROCESSING_FAILED', NULLIF(BTRIM(p_request_id), ''),
      JSONB_BUILD_OBJECT('databaseCode', v_sqlstate)
    );

    RETURN JSONB_BUILD_OBJECT(
      'status', 'FAILED',
      'integrationEventId', NULL,
      'bagId', NULL,
      'bhsUid', COALESCE(v_bhs_uid, ''),
      'lineId', COALESCE(v_line_id, ''),
      'evaluation', NULL,
      'taggingEligible', FALSE,
      'processingAttemptCount', 0,
      'errorCode', 'BHS_PROCESSING_FAILED',
      'errorMessage', 'BHS message could not be processed'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_beltcon_bhs_message_v1(
  JSONB, TEXT, TEXT, TEXT, UUID, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ingest_beltcon_bhs_message_v1(
  JSONB, TEXT, TEXT, TEXT, UUID, TEXT
) TO service_role;
