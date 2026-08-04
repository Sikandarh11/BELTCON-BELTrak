-- Durable central metadata for messages delivered by a trusted station agent.
-- This wrapper delegates canonical bag creation to v2; it is not a second bag path.

ALTER TABLE public.screening_integration_events
  ADD COLUMN IF NOT EXISTS station_id TEXT,
  ADD COLUMN IF NOT EXISTS site_id TEXT,
  ADD COLUMN IF NOT EXISTS station_synchronized_at TIMESTAMPTZ;

ALTER TABLE public.screening_integration_events
  DROP CONSTRAINT IF EXISTS screening_integration_station_identity_complete;
ALTER TABLE public.screening_integration_events
  ADD CONSTRAINT screening_integration_station_identity_complete CHECK (
    (station_id IS NULL AND site_id IS NULL AND station_synchronized_at IS NULL)
    OR (NULLIF(BTRIM(station_id),'') IS NOT NULL
        AND NULLIF(BTRIM(site_id),'') IS NOT NULL
        AND station_synchronized_at IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_screening_integration_station_delivery
ON public.screening_integration_events(site_id,station_id,received_at DESC)
WHERE station_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ingest_beltcon_bhs_station_message_v1(
  p_message JSONB,p_source_system TEXT,p_message_fingerprint TEXT,p_payload_hash TEXT,
  p_event_id UUID,p_request_id TEXT,p_station_id TEXT,p_site_id TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_result JSONB;
  v_integration_event_id UUID;
  v_existing_station_id TEXT;
  v_existing_site_id TEXT;
BEGIN
  IF p_station_id IS NULL OR p_station_id !~ '^[A-Za-z0-9._:-]{1,64}$'
    OR p_site_id IS NULL OR p_site_id !~ '^[A-Za-z0-9._:-]{1,64}$'
  THEN
    RETURN jsonb_build_object(
      'status','FAILED','integrationEventId',NULL,'bagId',NULL,
      'bhsUid',p_message->>'bhsUid','lineId',p_message->>'lineId',
      'evaluation',NULL,'taggingEligible',FALSE,'canAssignTag',FALSE,
      'taggingReadinessStatus',NULL,'processingAttemptCount',0,
      'errorCode','STATION_IDENTITY_INVALID','errorMessage','Trusted station identity is invalid'
    );
  END IF;
  v_result := public.ingest_beltcon_bhs_message_v2(
    p_message,p_source_system,p_message_fingerprint,p_payload_hash,p_event_id,p_request_id
  );
  IF v_result->>'status' NOT IN ('ACCEPTED','DUPLICATE')
    OR NULLIF(v_result->>'integrationEventId','') IS NULL
  THEN RETURN v_result; END IF;

  v_integration_event_id := (v_result->>'integrationEventId')::UUID;
  SELECT station_id,site_id INTO v_existing_station_id,v_existing_site_id
  FROM public.screening_integration_events WHERE id=v_integration_event_id FOR UPDATE;
  IF v_existing_station_id IS NOT NULL
    AND (v_existing_station_id IS DISTINCT FROM p_station_id
      OR v_existing_site_id IS DISTINCT FROM p_site_id)
  THEN
    INSERT INTO public.audit_events(
      action,actor_type,actor_id,integration_event_id,source_system,
      outcome,error_code,request_id,metadata
    ) VALUES (
      'BHS_STATION_BINDING_CONFLICT','INTEGRATION',p_source_system,
      v_integration_event_id,p_source_system,'REJECTED','STATION_BINDING_CONFLICT',
      NULLIF(BTRIM(p_request_id),''),
      jsonb_build_object(
        'configuredStationId',v_existing_station_id,'presentedStationId',p_station_id,
        'configuredSiteId',v_existing_site_id,'presentedSiteId',p_site_id
      )
    );
    RETURN v_result || jsonb_build_object(
      'status','CONFLICT','errorCode','STATION_BINDING_CONFLICT',
      'errorMessage','Message fingerprint is already bound to another station'
    );
  END IF;

  UPDATE public.screening_integration_events
  SET station_id=p_station_id,site_id=p_site_id,
      station_synchronized_at=COALESCE(station_synchronized_at,NOW())
  WHERE id=v_integration_event_id;
  IF v_existing_station_id IS NULL THEN
    INSERT INTO public.audit_events(
      action,actor_type,actor_id,bag_id,integration_event_id,source_system,
      outcome,request_id,metadata
    ) VALUES (
      'BHS_STATION_MESSAGE_SYNCHRONIZED','INTEGRATION',p_source_system,
      NULLIF(v_result->>'bagId',''),v_integration_event_id,p_source_system,
      'SUCCESS',NULLIF(BTRIM(p_request_id),''),
      jsonb_build_object('stationId',p_station_id,'siteId',p_site_id,'lineId',p_message->>'lineId')
    );
  END IF;
  RETURN v_result || jsonb_build_object('stationId',p_station_id,'siteId',p_site_id);
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_beltcon_bhs_station_message_v1(
  JSONB,TEXT,TEXT,TEXT,UUID,TEXT,TEXT,TEXT
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_beltcon_bhs_station_message_v1(
  JSONB,TEXT,TEXT,TEXT,UUID,TEXT,TEXT,TEXT
) TO service_role;
