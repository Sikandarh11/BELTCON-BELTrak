-- Resolve an authoritative baseline RFID detection to the currently active
-- suspect-bag tag assignment.
--
-- This operation is read-only.
-- It does not create alarms or mutate bags, tags, assignments or detections.

CREATE INDEX IF NOT EXISTS idx_tags_normalized_epc_resolution
  ON public.tags ((UPPER(BTRIM(epc))))
  WHERE epc IS NOT NULL;

CREATE OR REPLACE FUNCTION public.resolve_beltcon_active_bag_for_detection_v1(
  p_detection_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_detection public.rfid_detections%ROWTYPE;
  v_tag public.tags%ROWTYPE;
  v_assignment public.bag_tag_assignments%ROWTYPE;
  v_bag public.bags%ROWTYPE;
BEGIN
  IF NULLIF(BTRIM(p_detection_id), '') IS NULL THEN
    RAISE EXCEPTION 'RFID_DETECTION_ID_INVALID'
      USING ERRCODE = '22023';
  END IF;

  IF BTRIM(p_detection_id) !~
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
  THEN
    RAISE EXCEPTION 'RFID_DETECTION_ID_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_detection
  FROM public.rfid_detections
  WHERE id = BTRIM(p_detection_id)::UUID;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RFID_DETECTION_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  /*
   * The EPC comes only from the authoritative detection row.
   * Browser-supplied EPC and bag IDs are never accepted.
   */
  SELECT *
  INTO v_tag
  FROM public.tags
  WHERE UPPER(BTRIM(epc)) = v_detection.epc
  ORDER BY
    CASE WHEN status = 'ASSIGNED' THEN 0 ELSE 1 END,
    created_at DESC,
    id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'UNASSIGNED_EPC',
      'detectionId', v_detection.id,
      'epc', v_detection.epc,
      'tagAssignmentId', NULL,
      'bagId', NULL,
      'assignmentStatus', NULL,
      'bagStatus', NULL,
      'alarmEligible', FALSE
    );
  END IF;

  /*
   * FAILED, REPLACED, VOIDED, LOST, EXPIRED and other non-assigned tags
   * must never continue into alarm processing.
   */
  IF v_tag.status IS DISTINCT FROM 'ASSIGNED' THEN
    RETURN jsonb_build_object(
      'outcome', 'TAG_NOT_ACTIVE',
      'detectionId', v_detection.id,
      'epc', v_detection.epc,
      'tagAssignmentId', NULL,
      'bagId', NULL,
      'assignmentStatus', NULL,
      'bagStatus', NULL,
      'alarmEligible', FALSE
    );
  END IF;

  SELECT *
  INTO v_assignment
  FROM public.bag_tag_assignments
  WHERE tag_id = v_tag.id
    AND site_id = v_detection.site_id
    AND assignment_status = 'ACTIVE'
    AND ended_at IS NULL
  ORDER BY assignment_version DESC, assigned_at DESC, id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'TAG_NOT_ACTIVE',
      'detectionId', v_detection.id,
      'epc', v_detection.epc,
      'tagAssignmentId', NULL,
      'bagId', NULL,
      'assignmentStatus', NULL,
      'bagStatus', NULL,
      'alarmEligible', FALSE
    );
  END IF;

  SELECT *
  INTO v_bag
  FROM public.bags
  WHERE id = v_assignment.bag_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'BAG_NOT_ALARM_ELIGIBLE',
      'detectionId', v_detection.id,
      'epc', v_detection.epc,
      'tagAssignmentId', v_assignment.id,
      'bagId', v_assignment.bag_id,
      'assignmentStatus', v_assignment.assignment_status,
      'bagStatus', NULL,
      'alarmEligible', FALSE
    );
  END IF;

  /*
   * Minimum baseline:
   * only a successfully TAGGED suspect bag continues to alarm processing.
   *
   * Closed, resolved, already-completed or otherwise non-operational bags
   * return BAG_NOT_ALARM_ELIGIBLE.
   */
  IF v_bag.status IS DISTINCT FROM 'TAGGED'
    OR v_bag.screening_evaluation = 'ACCEPT'
    OR UPPER(BTRIM(COALESCE(v_bag.epc, ''))) IS DISTINCT FROM v_detection.epc
  THEN
    RETURN jsonb_build_object(
      'outcome', 'BAG_NOT_ALARM_ELIGIBLE',
      'detectionId', v_detection.id,
      'epc', v_detection.epc,
      'tagAssignmentId', v_assignment.id,
      'bagId', v_bag.id,
      'assignmentStatus', v_assignment.assignment_status,
      'bagStatus', v_bag.status,
      'alarmEligible', FALSE
    );
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'ACTIVE_SUSPECT_BAG',
    'detectionId', v_detection.id,
    'epc', v_detection.epc,
    'tagAssignmentId', v_assignment.id,
    'bagId', v_bag.id,
    'assignmentStatus', v_assignment.assignment_status,
    'bagStatus', v_bag.status,
    'alarmEligible', TRUE
  );
END;
$$;

REVOKE ALL ON FUNCTION
  public.resolve_beltcon_active_bag_for_detection_v1(TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.resolve_beltcon_active_bag_for_detection_v1(TEXT)
TO service_role;