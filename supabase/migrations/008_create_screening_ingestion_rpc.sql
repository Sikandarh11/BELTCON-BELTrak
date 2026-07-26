-- Atomic, vendor-neutral ingestion for validated BAG_SUSPECTED v1 events.
--
-- The application makes one RPC call. PostgreSQL owns idempotency, identity
-- conflicts, bag/scan creation, and durable audit writes in one transaction.
CREATE OR REPLACE FUNCTION public.ingest_screening_suspect_event_v1(
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
  v_source_system TEXT;
  v_event_id UUID;
  v_bhs_uid TEXT;
  v_external_scan_id TEXT;
  v_scan_status TEXT;
  v_image_count INTEGER := 0;
  v_images JSONB := '[]'::jsonb;
  v_integration_id UUID;
  v_bag_id TEXT;
  v_scan_id UUID;
  v_conflict_code TEXT;
  v_conflict_message TEXT;
  v_failure_sqlstate TEXT;
  v_existing_event public.screening_integration_events%ROWTYPE;
  v_existing_bag public.bags%ROWTYPE;
  v_existing_scan public.xray_scans%ROWTYPE;
BEGIN
  v_source_system := NULLIF(BTRIM(p_event ->> 'sourceSystem'), '');
  v_event_id := (p_event ->> 'eventId')::UUID;
  v_bhs_uid := NULLIF(BTRIM(p_event #>> '{bag,bhsUid}'), '');
  v_external_scan_id := NULLIF(BTRIM(p_event #>> '{scan,externalScanId}'), '');
  v_scan_status := NULLIF(BTRIM(p_event #>> '{scan,status}'), '');
  v_image_count := JSONB_ARRAY_LENGTH(
    COALESCE(p_event #> '{scan,images}', '[]'::jsonb)
  );

  IF v_source_system IS NULL
    OR v_bhs_uid IS NULL
    OR v_external_scan_id IS NULL
    OR v_scan_status IS NULL
  THEN
    RAISE EXCEPTION 'Validated screening identity fields are required'
      USING ERRCODE = '22023';
  END IF;

  IF p_payload_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'A SHA-256 payload hash is required'
      USING ERRCODE = '22023';
  END IF;

  IF v_scan_status NOT IN ('AVAILABLE', 'PENDING', 'FAILED', 'NOT_FOUND') THEN
    RAISE EXCEPTION 'Unsupported screening scan status'
      USING ERRCODE = '22023';
  END IF;

  IF v_scan_status = 'AVAILABLE' AND v_image_count = 0 THEN
    RAISE EXCEPTION 'AVAILABLE screening scans require an image reference'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM JSONB_ARRAY_ELEMENTS(
      COALESCE(p_event #> '{scan,images}', '[]'::jsonb)
    ) AS image
    WHERE image ->> 'imageRef' !~ '^/mock-xray/'
      OR image ->> 'imageRef' ~ '(^|/)\.\.(/|$)'
      OR image ->> 'mimeType' NOT IN ('image/jpeg', 'image/png')
  ) THEN
    RAISE EXCEPTION 'Invalid screening image reference'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize concurrent deliveries that share any durable identity.
  PERFORM PG_ADVISORY_XACT_LOCK(
    HASHTEXTEXTENDED(
      'screening:event:' || v_source_system || ':' || v_event_id::TEXT,
      0
    )
  );
  PERFORM PG_ADVISORY_XACT_LOCK(
    HASHTEXTEXTENDED(
      'screening:bhs:' || v_source_system || ':' || v_bhs_uid,
      0
    )
  );
  PERFORM PG_ADVISORY_XACT_LOCK(
    HASHTEXTEXTENDED(
      'screening:scan:' || v_source_system || ':' || v_external_scan_id,
      0
    )
  );

  SELECT *
  INTO v_existing_event
  FROM public.screening_integration_events
  WHERE source_system = v_source_system
    AND event_id = v_event_id
  FOR UPDATE;

  IF FOUND THEN
    INSERT INTO public.audit_events (
      action,
      actor_type,
      actor_id,
      integration_event_id,
      source_system,
      outcome,
      request_id,
      metadata
    )
    VALUES (
      'SUSPECT_EVENT_RECEIVED',
      'INTEGRATION',
      v_source_system,
      v_existing_event.id,
      v_source_system,
      'RECEIVED',
      p_request_id,
      JSONB_BUILD_OBJECT(
        'eventId', v_event_id,
        'schemaVersion', p_event -> 'schemaVersion'
      )
    );

    IF v_existing_event.payload_hash <> p_payload_hash THEN
      INSERT INTO public.audit_events (
        action,
        actor_type,
        actor_id,
        integration_event_id,
        source_system,
        outcome,
        error_code,
        request_id,
        metadata
      )
      VALUES (
        'SUSPECT_EVENT_CONFLICT',
        'INTEGRATION',
        v_source_system,
        v_existing_event.id,
        v_source_system,
        'CONFLICT',
        'EVENT_ID_PAYLOAD_CONFLICT',
        p_request_id,
        JSONB_BUILD_OBJECT('eventId', v_event_id)
      );

      RETURN JSONB_BUILD_OBJECT(
        'status', 'CONFLICT',
        'eventId', v_event_id,
        'bagId', v_existing_event.bag_id,
        'scanId', v_existing_event.xray_scan_id,
        'scanStatus', NULL,
        'errorCode', 'EVENT_ID_PAYLOAD_CONFLICT',
        'errorMessage', 'Event ID was already used with a different payload'
      );
    END IF;

    IF v_existing_event.processing_status = 'CONFLICT' THEN
      IF v_existing_event.xray_scan_id IS NOT NULL THEN
        SELECT *
        INTO v_existing_scan
        FROM public.xray_scans
        WHERE id = v_existing_event.xray_scan_id;
      END IF;

      INSERT INTO public.audit_events (
        action,
        actor_type,
        actor_id,
        bag_id,
        xray_scan_id,
        integration_event_id,
        source_system,
        outcome,
        error_code,
        request_id,
        metadata
      )
      VALUES (
        'SUSPECT_EVENT_CONFLICT',
        'INTEGRATION',
        v_source_system,
        v_existing_event.bag_id,
        v_existing_event.xray_scan_id,
        v_existing_event.id,
        v_source_system,
        'CONFLICT',
        COALESCE(
          v_existing_event.error_code,
          'SCREENING_IDENTITY_CONFLICT'
        ),
        p_request_id,
        JSONB_BUILD_OBJECT('eventId', v_event_id)
      );

      RETURN JSONB_BUILD_OBJECT(
        'status', 'CONFLICT',
        'eventId', v_event_id,
        'bagId', v_existing_event.bag_id,
        'scanId', v_existing_event.xray_scan_id,
        'scanStatus', v_existing_scan.status,
        'errorCode', COALESCE(
          v_existing_event.error_code,
          'SCREENING_IDENTITY_CONFLICT'
        ),
        'errorMessage', COALESCE(
          v_existing_event.error_message,
          'Screening event conflicts with existing data'
        )
      );
    END IF;

    IF v_existing_event.processing_status = 'ACCEPTED'
      AND v_existing_event.bag_id IS NOT NULL
      AND v_existing_event.xray_scan_id IS NOT NULL
    THEN
      SELECT *
      INTO v_existing_scan
      FROM public.xray_scans
      WHERE id = v_existing_event.xray_scan_id;

      IF FOUND THEN
        INSERT INTO public.audit_events (
          action,
          actor_type,
          actor_id,
          bag_id,
          xray_scan_id,
          integration_event_id,
          source_system,
          outcome,
          request_id,
          metadata
        )
        VALUES (
          'SUSPECT_EVENT_DUPLICATE',
          'INTEGRATION',
          v_source_system,
          v_existing_event.bag_id,
          v_existing_event.xray_scan_id,
          v_existing_event.id,
          v_source_system,
          'DUPLICATE',
          p_request_id,
          JSONB_BUILD_OBJECT('eventId', v_event_id)
        );

        RETURN JSONB_BUILD_OBJECT(
          'status', 'DUPLICATE',
          'eventId', v_event_id,
          'bagId', v_existing_event.bag_id,
          'scanId', v_existing_event.xray_scan_id,
          'scanStatus', v_existing_scan.status,
          'errorCode', NULL,
          'errorMessage', NULL
        );
      END IF;
    END IF;

    INSERT INTO public.audit_events (
      action,
      actor_type,
      actor_id,
      integration_event_id,
      source_system,
      outcome,
      error_code,
      request_id,
      metadata
    )
    VALUES (
      'SUSPECT_EVENT_CONFLICT',
      'INTEGRATION',
      v_source_system,
      v_existing_event.id,
      v_source_system,
      'CONFLICT',
      'ORIGINAL_RESULT_UNAVAILABLE',
      p_request_id,
      JSONB_BUILD_OBJECT('eventId', v_event_id)
    );

    RETURN JSONB_BUILD_OBJECT(
      'status', 'CONFLICT',
      'eventId', v_event_id,
      'bagId', v_existing_event.bag_id,
      'scanId', v_existing_event.xray_scan_id,
      'scanStatus', NULL,
      'errorCode', 'ORIGINAL_RESULT_UNAVAILABLE',
      'errorMessage', 'The original idempotent result is unavailable'
    );
  END IF;

  INSERT INTO public.screening_integration_events (
    event_id,
    source_system,
    event_type,
    schema_version,
    payload_hash,
    processing_status,
    received_at,
    sanitized_metadata
  )
  VALUES (
    v_event_id,
    v_source_system,
    'BAG_SUSPECTED',
    (p_event ->> 'schemaVersion')::SMALLINT,
    p_payload_hash,
    'RECEIVED',
    v_now,
    JSONB_BUILD_OBJECT(
      'eventId', v_event_id,
      'schemaVersion', p_event -> 'schemaVersion'
    )
  )
  RETURNING id INTO v_integration_id;

  INSERT INTO public.audit_events (
    action,
    actor_type,
    actor_id,
    integration_event_id,
    source_system,
    outcome,
    request_id,
    metadata
  )
  VALUES (
    'SUSPECT_EVENT_RECEIVED',
    'INTEGRATION',
    v_source_system,
    v_integration_id,
    v_source_system,
    'RECEIVED',
    p_request_id,
    JSONB_BUILD_OBJECT(
      'eventId', v_event_id,
      'schemaVersion', p_event -> 'schemaVersion'
    )
  );

  SELECT *
  INTO v_existing_bag
  FROM public.bags
  WHERE source_system = v_source_system
    AND bhs_uid = v_bhs_uid
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_bag.status IN (
      'TAGGED',
      'ALARMED',
      'UNDER_RECHECK',
      'RESOLVED'
    ) THEN
      v_conflict_code := 'BAG_LIFECYCLE_CONFLICT';
      v_conflict_message := 'The existing bag lifecycle cannot be reset';
    ELSE
      v_conflict_code := 'BHS_IDENTITY_CONFLICT';
      v_conflict_message := 'BHS UID is already assigned to another event';
    END IF;

    UPDATE public.screening_integration_events
    SET
      processing_status = 'CONFLICT',
      bag_id = v_existing_bag.id,
      error_code = v_conflict_code,
      error_message = v_conflict_message,
      processed_at = v_now
    WHERE id = v_integration_id;

    INSERT INTO public.audit_events (
      action,
      actor_type,
      actor_id,
      bag_id,
      integration_event_id,
      source_system,
      outcome,
      error_code,
      request_id,
      metadata
    )
    VALUES (
      'SUSPECT_EVENT_CONFLICT',
      'INTEGRATION',
      v_source_system,
      v_existing_bag.id,
      v_integration_id,
      v_source_system,
      'CONFLICT',
      v_conflict_code,
      p_request_id,
      JSONB_BUILD_OBJECT(
        'eventId', v_event_id,
        'existingStatus', v_existing_bag.status
      )
    );

    RETURN JSONB_BUILD_OBJECT(
      'status', 'CONFLICT',
      'eventId', v_event_id,
      'bagId', v_existing_bag.id,
      'scanId', NULL,
      'scanStatus', NULL,
      'errorCode', v_conflict_code,
      'errorMessage', v_conflict_message
    );
  END IF;

  SELECT *
  INTO v_existing_scan
  FROM public.xray_scans
  WHERE source_system = v_source_system
    AND external_scan_id = v_external_scan_id
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.screening_integration_events
    SET
      processing_status = 'CONFLICT',
      bag_id = v_existing_scan.bag_id,
      xray_scan_id = v_existing_scan.id,
      error_code = 'EXTERNAL_SCAN_ID_CONFLICT',
      error_message = 'External scan ID is already assigned to another bag',
      processed_at = v_now
    WHERE id = v_integration_id;

    INSERT INTO public.audit_events (
      action,
      actor_type,
      actor_id,
      bag_id,
      xray_scan_id,
      integration_event_id,
      source_system,
      outcome,
      error_code,
      request_id,
      metadata
    )
    VALUES (
      'SUSPECT_EVENT_CONFLICT',
      'INTEGRATION',
      v_source_system,
      v_existing_scan.bag_id,
      v_existing_scan.id,
      v_integration_id,
      v_source_system,
      'CONFLICT',
      'EXTERNAL_SCAN_ID_CONFLICT',
      p_request_id,
      JSONB_BUILD_OBJECT('eventId', v_event_id)
    );

    RETURN JSONB_BUILD_OBJECT(
      'status', 'CONFLICT',
      'eventId', v_event_id,
      'bagId', v_existing_scan.bag_id,
      'scanId', v_existing_scan.id,
      'scanStatus', v_existing_scan.status,
      'errorCode', 'EXTERNAL_SCAN_ID_CONFLICT',
      'errorMessage', 'External scan ID is already assigned to another bag'
    );
  END IF;

  v_bag_id :=
    'ETB-' ||
    UPPER(
      SUBSTRING(
        MD5(v_source_system || ':' || v_event_id::TEXT)
        FROM 1
        FOR 12
      )
    );

  INSERT INTO public.bags (
    id,
    source_system,
    bhs_uid,
    iata_code,
    iata_origin,
    flight,
    passenger_name,
    threat_type,
    threat_level,
    screening_station,
    screened_at,
    flagged_at,
    tagged_at,
    notes,
    is_suspect,
    status,
    current_zone,
    created_at,
    updated_at
  )
  VALUES (
    v_bag_id,
    v_source_system,
    v_bhs_uid,
    NULLIF(BTRIM(p_event #>> '{bag,iataCode}'), ''),
    NULLIF(BTRIM(p_event #>> '{bag,iataOrigin}'), ''),
    BTRIM(p_event #>> '{bag,flightNo}'),
    NULLIF(BTRIM(p_event #>> '{bag,passengerName}'), ''),
    BTRIM(p_event #>> '{threat,type}'),
    (p_event #>> '{threat,level}')::SMALLINT,
    BTRIM(p_event #>> '{screening,station}'),
    (p_event #>> '{screening,screenedAt}')::TIMESTAMPTZ,
    (p_event ->> 'occurredAt')::TIMESTAMPTZ,
    NULL,
    NULLIF(BTRIM(p_event #>> '{screening,notes}'), ''),
    TRUE,
    'IDENTIFIED',
    'TAGGING_STATION',
    (p_event ->> 'occurredAt')::TIMESTAMPTZ,
    v_now
  );

  SELECT COALESCE(
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'id', image ->> 'imageId',
        'label', image ->> 'label',
        'url', image ->> 'imageRef',
        'mimeType', image ->> 'mimeType'
      )
      ORDER BY image_order
    ),
    '[]'::jsonb
  )
  INTO v_images
  FROM JSONB_ARRAY_ELEMENTS(
    COALESCE(p_event #> '{scan,images}', '[]'::jsonb)
  ) WITH ORDINALITY AS images(image, image_order);

  INSERT INTO public.xray_scans (
    bag_id,
    bhs_uid,
    external_scan_id,
    source_system,
    status,
    images,
    threat_level,
    threat_type,
    captured_at,
    received_at,
    error_code,
    error_message,
    metadata,
    created_at,
    updated_at
  )
  VALUES (
    v_bag_id,
    v_bhs_uid,
    v_external_scan_id,
    v_source_system,
    v_scan_status,
    v_images,
    (p_event #>> '{threat,level}')::SMALLINT,
    BTRIM(p_event #>> '{threat,type}'),
    (p_event #>> '{screening,screenedAt}')::TIMESTAMPTZ,
    v_now,
    CASE
      WHEN v_scan_status = 'FAILED' THEN 'SCREENING_REPORTED_FAILED'
      ELSE NULL
    END,
    CASE
      WHEN v_scan_status = 'FAILED'
        THEN 'Screening system reported scan failure'
      ELSE NULL
    END,
    JSONB_BUILD_OBJECT(
      'integrationEventId', v_integration_id,
      'schemaVersion', p_event -> 'schemaVersion',
      'screeningStation', p_event #>> '{screening,station}',
      'imageReferencesOnly', TRUE
    ),
    v_now,
    v_now
  )
  RETURNING id INTO v_scan_id;

  UPDATE public.screening_integration_events
  SET
    processing_status = 'ACCEPTED',
    bag_id = v_bag_id,
    xray_scan_id = v_scan_id,
    processed_at = v_now
  WHERE id = v_integration_id;

  IF v_image_count > 0 THEN
    INSERT INTO public.audit_events (
      action,
      actor_type,
      actor_id,
      bag_id,
      xray_scan_id,
      integration_event_id,
      source_system,
      outcome,
      request_id,
      metadata
    )
    VALUES (
      'XRAY_IMAGE_REFERENCE_RECEIVED',
      'INTEGRATION',
      v_source_system,
      v_bag_id,
      v_scan_id,
      v_integration_id,
      v_source_system,
      'SUCCESS',
      p_request_id,
      JSONB_BUILD_OBJECT('imageCount', v_image_count)
    );
  END IF;

  INSERT INTO public.audit_events (
    action,
    actor_type,
    actor_id,
    bag_id,
    xray_scan_id,
    integration_event_id,
    source_system,
    outcome,
    request_id,
    metadata
  )
  VALUES (
    'SUSPECT_EVENT_ACCEPTED',
    'INTEGRATION',
    v_source_system,
    v_bag_id,
    v_scan_id,
    v_integration_id,
    v_source_system,
    'SUCCESS',
    p_request_id,
    JSONB_BUILD_OBJECT('eventId', v_event_id)
  );

  RETURN JSONB_BUILD_OBJECT(
    'status', 'ACCEPTED',
    'eventId', v_event_id,
    'bagId', v_bag_id,
    'scanId', v_scan_id,
    'scanStatus', v_scan_status,
    'errorCode', NULL,
    'errorMessage', NULL
  );

EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_failure_sqlstate = RETURNED_SQLSTATE;

    -- The exception block rolls back all writes above before this durable,
    -- sanitized failure audit is inserted. No partial bag or scan remains.
    INSERT INTO public.audit_events (
      action,
      actor_type,
      actor_id,
      source_system,
      outcome,
      error_code,
      request_id,
      metadata
    )
    VALUES (
      'SUSPECT_EVENT_FAILED',
      'INTEGRATION',
      v_source_system,
      v_source_system,
      'FAILED',
      'SCREENING_TRANSACTION_FAILED',
      p_request_id,
      JSONB_BUILD_OBJECT(
        'eventId', v_event_id,
        'databaseCode', v_failure_sqlstate
      )
    );

    RETURN JSONB_BUILD_OBJECT(
      'status', 'FAILED',
      'eventId', COALESCE(
        v_event_id::TEXT,
        '00000000-0000-0000-0000-000000000000'
      ),
      'bagId', NULL,
      'scanId', NULL,
      'scanStatus', NULL,
      'errorCode', 'SCREENING_TRANSACTION_FAILED',
      'errorMessage', 'Screening event could not be stored'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_screening_suspect_event_v1(
  JSONB,
  TEXT,
  TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ingest_screening_suspect_event_v1(
  JSONB,
  TEXT,
  TEXT
) TO service_role;
