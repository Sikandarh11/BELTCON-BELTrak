-- BELTCON SBTS Customs Exit alarm phase V1.
-- This reuses the durable alarm workflow and keeps all authoritative data in PostgreSQL.

CREATE OR REPLACE FUNCTION public.process_beltcon_customs_exit_alarm_v1(
  p_detection_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_detection public.rfid_detections%ROWTYPE;
  v_resolution JSONB;
  v_resolution_outcome TEXT;
  v_tag_assignment_id TEXT;
  v_bag_id TEXT;
  v_assignment_status TEXT;
  v_bag_status TEXT;
  v_alarm public.alarms%ROWTYPE;
  v_bag public.bags%ROWTYPE;
  v_event_id TEXT;
  v_alarm_id TEXT;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF NULLIF(BTRIM(p_detection_id), '') IS NULL THEN
    RAISE EXCEPTION 'RFID_DETECTION_ID_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_detection
  FROM public.rfid_detections
  WHERE id = BTRIM(p_detection_id)::UUID
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RFID_DETECTION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_detection.zone IS DISTINCT FROM 'CUSTOMS_EXIT' THEN
    RETURN jsonb_build_object(
      'outcome', 'NOT_CUSTOMS_EXIT',
      'detectionId', v_detection.id,
      'alarmEligible', FALSE
    );
  END IF;

  SELECT public.resolve_beltcon_active_bag_for_detection_v1(v_detection.id::TEXT)
  INTO v_resolution;

  v_resolution_outcome := COALESCE(v_resolution ->> 'outcome', '');
  v_tag_assignment_id := NULLIF(BTRIM(COALESCE(v_resolution ->> 'tagAssignmentId', '')), '');
  v_bag_id := NULLIF(BTRIM(COALESCE(v_resolution ->> 'bagId', '')), '');
  v_assignment_status := NULLIF(BTRIM(COALESCE(v_resolution ->> 'assignmentStatus', '')), '');
  v_bag_status := NULLIF(BTRIM(COALESCE(v_resolution ->> 'bagStatus', '')), '');

  IF v_resolution_outcome <> 'ACTIVE_SUSPECT_BAG' THEN
    IF v_resolution_outcome = 'BAG_NOT_ALARM_ELIGIBLE' AND v_bag_id IS NOT NULL THEN
      SELECT *
      INTO v_alarm
      FROM public.alarms
      WHERE bag_id = v_bag_id
        AND zone_code = 'CUSTOMS_EXIT'
        AND alarm_type = 'CUSTOMS_EXIT'
        AND outcome IN ('OPEN', 'ACKNOWLEDGED', 'UNDER_INVESTIGATION', 'ESCALATED', 'SENT_TO_RECHECK')
      ORDER BY opened_at DESC NULLS LAST, id DESC
      LIMIT 1
      FOR UPDATE;

      IF FOUND THEN
        RETURN jsonb_build_object(
          'outcome', 'ALARM_ALREADY_ACTIVE',
          'detectionId', v_detection.id,
          'bagId', v_bag_id,
          'alarmId', v_alarm.id,
          'alarmEligible', FALSE
        );
      END IF;
    END IF;

    RETURN v_resolution
      || jsonb_build_object(
        'detectionId', v_detection.id,
        'alarmOutcome', v_resolution_outcome
      );
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('beltcon:customs_exit_alarm:' || v_bag_id, 0));

  SELECT *
  INTO v_alarm
  FROM public.alarms
  WHERE bag_id = v_bag_id
    AND zone_code = 'CUSTOMS_EXIT'
    AND alarm_type = 'CUSTOMS_EXIT'
    AND outcome IN ('OPEN', 'ACKNOWLEDGED', 'UNDER_INVESTIGATION', 'ESCALATED', 'SENT_TO_RECHECK')
  ORDER BY opened_at DESC NULLS LAST, id DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'ALARM_ALREADY_ACTIVE',
      'detectionId', v_detection.id,
      'bagId', v_bag_id,
      'alarmId', v_alarm.id,
      'alarmEligible', FALSE
    );
  END IF;

  SELECT *
  INTO v_bag
  FROM public.bags
  WHERE id = v_bag_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'BAG_NOT_ALARM_ELIGIBLE',
      'detectionId', v_detection.id,
      'epc', v_detection.epc,
      'tagAssignmentId', v_tag_assignment_id,
      'bagId', v_bag_id,
      'assignmentStatus', v_assignment_status,
      'bagStatus', v_bag_status,
      'alarmEligible', FALSE
    );
  END IF;

  IF v_bag.status IS DISTINCT FROM 'TAGGED'
    OR v_bag.screening_evaluation = 'ACCEPT'
    OR UPPER(BTRIM(COALESCE(v_bag.epc, ''))) IS DISTINCT FROM v_detection.epc
  THEN
    RETURN jsonb_build_object(
      'outcome', 'BAG_NOT_ALARM_ELIGIBLE',
      'detectionId', v_detection.id,
      'epc', v_detection.epc,
      'tagAssignmentId', v_tag_assignment_id,
      'bagId', v_bag.id,
      'assignmentStatus', v_assignment_status,
      'bagStatus', v_bag.status,
      'alarmEligible', FALSE
    );
  END IF;

  SELECT rfid_event_id
  INTO v_event_id
  FROM public.rfid_event_detection_links
  WHERE detection_id = v_detection.id
  ORDER BY linked_at DESC
  LIMIT 1;

  v_alarm_id := gen_random_uuid()::TEXT;

  UPDATE public.bags
  SET status = 'ALARMED',
      current_zone = 'CUSTOMS_EXIT',
      version = version + 1,
      updated_at = v_now
  WHERE id = v_bag.id
  RETURNING * INTO v_bag;

  INSERT INTO public.alarms(
    id,
    bag_id,
    zone,
    triggered_at,
    outcome,
    severity,
    version,
    opened_at,
    source_rfid_event_id,
    zone_code,
    alarm_type
  )
  VALUES (
    v_alarm_id,
    v_bag.id,
    'CUSTOMS_EXIT',
    v_now,
    'OPEN',
    'HIGH',
    1,
    v_now,
    v_event_id,
    'CUSTOMS_EXIT',
    'CUSTOMS_EXIT'
  )
  RETURNING * INTO v_alarm;

  INSERT INTO public.alarm_actions(
    alarm_id,
    action,
    from_status,
    to_status,
    request_id
  )
  VALUES (
    v_alarm.id,
    'OPENED',
    NULL,
    'OPEN',
    v_detection.id::TEXT
  );

  INSERT INTO public.audit_events(
    action,
    actor_type,
    actor_id,
    bag_id,
    source_system,
    outcome,
    request_id,
    metadata
  )
  VALUES (
    'CUSTOMS_EXIT_ALARM_OPENED',
    'INTEGRATION',
    NULL,
    v_bag.id,
    'RFID',
    'SUCCESS',
    v_detection.id::TEXT,
    jsonb_build_object(
      'alarmId', v_alarm.id,
      'detectionId', v_detection.id,
      'eventId', v_event_id,
      'zone', 'CUSTOMS_EXIT',
      'severity', 'HIGH',
      'bagId', v_bag.id,
      'alarmEligible', TRUE
    )
  );

  RETURN jsonb_build_object(
    'outcome', 'ALARM_CREATED',
    'detectionId', v_detection.id,
    'bagId', v_bag.id,
    'alarmId', v_alarm.id,
    'severity', 'HIGH',
    'alarmEligible', TRUE,
    'resolution', v_resolution,
    'alarm', jsonb_build_object(
      'id', v_alarm.id,
      'status', 'OPEN',
      'severity', 'HIGH',
      'created', TRUE
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_beltcon_customs_exit_alarm_v1(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_beltcon_customs_exit_alarm_v1(TEXT) TO service_role;
