-- BELTCON SBTS Phase 4.4 RFID detection episodes.
-- This migration adds authoritative read points, detection episodes, and the
-- atomic RPC that groups immutable RFID events into sliding-window episodes.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.rfid_read_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id TEXT NOT NULL,
  reader_id TEXT NOT NULL REFERENCES public.readers(id) ON DELETE CASCADE,
  antenna_port SMALLINT NULL CHECK (antenna_port BETWEEN 1 AND 64),
  code TEXT NOT NULL CHECK (BTRIM(code) <> ''),
  name TEXT NOT NULL CHECK (BTRIM(name) <> ''),
  zone TEXT NOT NULL CHECK (zone IN (
    'TAGGING', 'RECLAIM', 'CUSTOMS_EXIT', 'RECHECK', 'WASHROOM',
    'EMPLOYEE_EXIT', 'EMERGENCY_EXIT', 'LOST_AND_FOUND', 'CORRIDOR', 'OTHER'
  )),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  dedup_window_ms INTEGER NOT NULL DEFAULT 1000 CHECK (dedup_window_ms BETWEEN 100 AND 60000),
  late_arrival_tolerance_ms INTEGER NOT NULL DEFAULT 5000 CHECK (late_arrival_tolerance_ms BETWEEN 0 AND 300000),
  include_antenna_in_key BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, code),
  UNIQUE (site_id, reader_id, antenna_port)
);

INSERT INTO public.rfid_read_points (
  site_id,
  reader_id,
  antenna_port,
  code,
  name,
  zone,
  enabled,
  dedup_window_ms,
  late_arrival_tolerance_ms,
  include_antenna_in_key,
  created_at,
  updated_at
)
SELECT
  r.site_id,
  ra.reader_id,
  ra.port_number,
  COALESCE(r.reader_code, ra.reader_id) || ':' || ra.port_number::TEXT,
  ra.name,
  ra.zone_code,
  ra.enabled,
  1000,
  5000,
  TRUE,
  NOW(),
  NOW()
FROM public.reader_antennas ra
JOIN public.readers r ON r.id = ra.reader_id
ON CONFLICT (site_id, reader_id, antenna_port) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.rfid_detection_episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id TEXT NOT NULL,
  read_point_id UUID NOT NULL REFERENCES public.rfid_read_points(id) ON DELETE RESTRICT,
  reader_id TEXT NOT NULL REFERENCES public.readers(id) ON DELETE RESTRICT,
  epc TEXT NOT NULL,
  antenna_port SMALLINT NULL CHECK (antenna_port BETWEEN 1 AND 64),
  first_detected_at TIMESTAMPTZ NOT NULL,
  last_detected_at TIMESTAMPTZ NOT NULL,
  raw_event_count INTEGER NOT NULL DEFAULT 0 CHECK (raw_event_count >= 0),
  total_read_count INTEGER NOT NULL DEFAULT 0 CHECK (total_read_count >= 0),
  strongest_rssi_dbm NUMERIC NULL,
  weakest_rssi_dbm NUMERIC NULL,
  latest_rssi_dbm NUMERIC NULL,
  simulated BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rfid_detection_episode_epc_check CHECK (
    epc = UPPER(epc)
    AND (length(epc) = 24 OR length(epc) = 32)
    AND epc ~ '^[0-9A-F]+$'
  ),
  CONSTRAINT rfid_detection_episode_seen_order_check CHECK (last_detected_at >= first_detected_at)
);

CREATE INDEX IF NOT EXISTS idx_rfid_detection_episodes_key
  ON public.rfid_detection_episodes(site_id, read_point_id, epc, antenna_port, last_detected_at DESC);

CREATE TABLE IF NOT EXISTS public.rfid_detection_event_links (
  detection_id UUID NOT NULL REFERENCES public.rfid_detection_episodes(id) ON DELETE CASCADE,
  rfid_event_id TEXT NOT NULL REFERENCES public.rfid_events(id) ON DELETE CASCADE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_outcome TEXT NOT NULL CHECK (processing_outcome IN (
    'EPISODE_CREATED',
    'EPISODE_UPDATED',
    'LATE_EVENT_RECORDED'
  )),
  PRIMARY KEY (rfid_event_id)
);

CREATE INDEX IF NOT EXISTS idx_rfid_detection_event_links_detection_id
  ON public.rfid_detection_event_links(detection_id);

REVOKE ALL ON TABLE public.rfid_read_points FROM anon, authenticated;
REVOKE ALL ON TABLE public.rfid_detection_episodes FROM anon, authenticated;
REVOKE ALL ON TABLE public.rfid_detection_event_links FROM anon, authenticated;

ALTER TABLE public.rfid_detection_episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfid_detection_event_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS read_rfid_detection_episodes ON public.rfid_detection_episodes;
DROP POLICY IF EXISTS read_rfid_detection_event_links ON public.rfid_detection_event_links;

CREATE OR REPLACE FUNCTION public.reject_rfid_detection_mutation_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('beltcon.rfid_detection_rpc', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'RFID detection rows are mutation-restricted to the trusted RPC' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rfid_detection_episodes_mutation_guard ON public.rfid_detection_episodes;
CREATE TRIGGER rfid_detection_episodes_mutation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.rfid_detection_episodes
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_rfid_detection_mutation_v1();

DROP TRIGGER IF EXISTS rfid_detection_event_links_mutation_guard ON public.rfid_detection_event_links;
CREATE TRIGGER rfid_detection_event_links_mutation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.rfid_detection_event_links
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_rfid_detection_mutation_v1();

CREATE OR REPLACE FUNCTION public.process_beltcon_rfid_detection_v1(
  p_rfid_event_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event public.rfid_events%ROWTYPE;
  v_reader public.readers%ROWTYPE;
  v_read_point public.rfid_read_points%ROWTYPE;
  v_episode public.rfid_detection_episodes%ROWTYPE;
  v_link public.rfid_detection_event_links%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
  v_window_ms INTEGER;
  v_tolerance_ms INTEGER;
  v_include_antenna BOOLEAN;
  v_is_late BOOLEAN := FALSE;
  v_outcome TEXT;
  v_lock_key TEXT;
BEGIN
  IF NULLIF(BTRIM(p_rfid_event_id), '') IS NULL THEN
    RAISE EXCEPTION 'RFID detection event is invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('beltcon.rfid_detection_rpc', 'on', true);

  SELECT * INTO v_event
  FROM public.rfid_events
  WHERE id = BTRIM(p_rfid_event_id)
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RFID_DETECTION_EVENT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_reader
  FROM public.readers
  WHERE id = v_event.reader_id
    AND site_id = v_event.site_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RFID_READER_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_reader.enabled THEN
    RAISE EXCEPTION 'RFID_READER_DISABLED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_read_point
  FROM public.rfid_read_points
  WHERE site_id = v_event.site_id
    AND reader_id = v_event.reader_id
    AND antenna_port = v_event.antenna_port
  FOR SHARE;

  IF NOT FOUND THEN
    SELECT * INTO v_read_point
    FROM public.rfid_read_points
    WHERE site_id = v_event.site_id
      AND reader_id = v_event.reader_id
      AND antenna_port IS NULL
    FOR SHARE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RFID_ANTENNA_MAPPING_MISSING' USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_read_point.enabled THEN
    RAISE EXCEPTION 'RFID_READ_POINT_DISABLED' USING ERRCODE = 'P0001';
  END IF;

  IF v_read_point.dedup_window_ms < 100
    OR v_read_point.dedup_window_ms > 60000
    OR v_read_point.late_arrival_tolerance_ms < 0
    OR v_read_point.late_arrival_tolerance_ms > 300000
  THEN
    RAISE EXCEPTION 'RFID_DEDUP_POLICY_INVALID' USING ERRCODE = '22023';
  END IF;

  v_window_ms := v_read_point.dedup_window_ms;
  v_tolerance_ms := v_read_point.late_arrival_tolerance_ms;
  v_include_antenna := v_read_point.include_antenna_in_key;
  v_lock_key := 'beltcon:rfid:detection:' || v_event.site_id || ':' || v_read_point.id::TEXT || ':' || v_event.epc || ':' || CASE WHEN v_include_antenna THEN v_event.antenna_port::TEXT ELSE 'any' END;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));

  SELECT *
  INTO v_link
  FROM public.rfid_detection_event_links
  WHERE rfid_event_id = v_event.id
  FOR UPDATE;

  IF FOUND THEN
    SELECT *
    INTO v_episode
    FROM public.rfid_detection_episodes
    WHERE id = v_link.detection_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'RFID_DETECTION_CONFLICT' USING ERRCODE = 'P0001';
    END IF;

    RETURN jsonb_build_object(
      'outcome', v_link.processing_outcome,
      'detectionId', v_episode.id,
      'readPointId', v_read_point.id,
      'readPointCode', v_read_point.code,
      'readPointName', v_read_point.name,
      'readPointZone', v_read_point.zone,
      'readerId', v_episode.reader_id,
      'epc', v_episode.epc,
      'antennaPort', v_episode.antenna_port,
      'firstDetectedAt', v_episode.first_detected_at,
      'lastDetectedAt', v_episode.last_detected_at,
      'rawEventCount', v_episode.raw_event_count,
      'totalReadCount', v_episode.total_read_count,
      'strongestRssiDbm', v_episode.strongest_rssi_dbm,
      'weakestRssiDbm', v_episode.weakest_rssi_dbm,
      'latestRssiDbm', v_episode.latest_rssi_dbm,
      'simulated', v_episode.simulated
    );
  END IF;

  SELECT *
  INTO v_episode
  FROM public.rfid_detection_episodes
  WHERE site_id = v_event.site_id
    AND read_point_id = v_read_point.id
    AND epc = v_event.epc
    AND (
      (v_include_antenna AND antenna_port = v_event.antenna_port)
      OR (NOT v_include_antenna)
    )
  ORDER BY last_detected_at DESC, first_detected_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_event.first_seen_at < v_episode.first_detected_at
       AND EXTRACT(EPOCH FROM (v_episode.first_detected_at - v_event.first_seen_at)) * 1000 > v_tolerance_ms
    THEN
      RAISE EXCEPTION 'RFID_DETECTION_EVENT_TOO_OLD' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.rfid_detection_episodes
    SET
      first_detected_at = LEAST(first_detected_at, v_event.first_seen_at),
      last_detected_at = GREATEST(last_detected_at, v_event.last_seen_at),
      raw_event_count = raw_event_count + 1,
      total_read_count = total_read_count + v_event.read_count,
      strongest_rssi_dbm = CASE
        WHEN strongest_rssi_dbm IS NULL THEN v_event.rssi_dbm
        WHEN v_event.rssi_dbm IS NULL THEN strongest_rssi_dbm
        ELSE GREATEST(strongest_rssi_dbm, v_event.rssi_dbm)
      END,
      weakest_rssi_dbm = CASE
        WHEN weakest_rssi_dbm IS NULL THEN v_event.rssi_dbm
        WHEN v_event.rssi_dbm IS NULL THEN weakest_rssi_dbm
        ELSE LEAST(weakest_rssi_dbm, v_event.rssi_dbm)
      END,
      latest_rssi_dbm = CASE
        WHEN v_event.last_seen_at >= last_detected_at THEN v_event.rssi_dbm
        ELSE latest_rssi_dbm
      END,
      simulated = simulated OR v_event.simulated,
      version = version + 1,
      updated_at = v_now
    WHERE id = v_episode.id
    RETURNING * INTO v_episode;

    v_is_late := v_event.first_seen_at < v_episode.first_detected_at;
    v_outcome := CASE WHEN v_is_late THEN 'LATE_EVENT_RECORDED' ELSE 'EPISODE_UPDATED' END;

  ELSE
    IF EXISTS (
      SELECT 1
      FROM public.rfid_detection_episodes
      WHERE site_id = v_event.site_id
        AND read_point_id = v_read_point.id
        AND epc = v_event.epc
        AND (
          (v_include_antenna AND antenna_port = v_event.antenna_port)
          OR (NOT v_include_antenna)
        )
        AND first_detected_at < v_event.first_seen_at
        AND EXTRACT(EPOCH FROM (v_event.first_seen_at - last_detected_at)) * 1000 > v_tolerance_ms
    ) THEN
      RAISE EXCEPTION 'RFID_DETECTION_EVENT_TOO_OLD' USING ERRCODE = 'P0001';
    END IF;

    v_is_late := EXISTS (
      SELECT 1
      FROM public.rfid_detection_episodes
      WHERE site_id = v_event.site_id
        AND read_point_id = v_read_point.id
        AND epc = v_event.epc
        AND (
          (v_include_antenna AND antenna_port = v_event.antenna_port)
          OR (NOT v_include_antenna)
        )
    ) AND v_event.first_seen_at < (
      SELECT MAX(last_detected_at)
      FROM public.rfid_detection_episodes
      WHERE site_id = v_event.site_id
        AND read_point_id = v_read_point.id
        AND epc = v_event.epc
        AND (
          (v_include_antenna AND antenna_port = v_event.antenna_port)
          OR (NOT v_include_antenna)
        )
    );

    INSERT INTO public.rfid_detection_episodes (
      id,
      site_id,
      read_point_id,
      reader_id,
      epc,
      antenna_port,
      first_detected_at,
      last_detected_at,
      raw_event_count,
      total_read_count,
      strongest_rssi_dbm,
      weakest_rssi_dbm,
      latest_rssi_dbm,
      simulated,
      version,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      v_event.site_id,
      v_read_point.id,
      v_event.reader_id,
      v_event.epc,
      CASE WHEN v_include_antenna THEN v_event.antenna_port ELSE NULL END,
      v_event.first_seen_at,
      v_event.last_seen_at,
      1,
      v_event.read_count,
      v_event.rssi_dbm,
      v_event.rssi_dbm,
      v_event.rssi_dbm,
      v_event.simulated,
      1,
      v_now,
      v_now
    )
    RETURNING * INTO v_episode;

    v_outcome := CASE WHEN v_is_late THEN 'LATE_EVENT_RECORDED' ELSE 'EPISODE_CREATED' END;
  END IF;

  INSERT INTO public.rfid_detection_event_links (
    detection_id,
    rfid_event_id,
    linked_at,
    processing_outcome
  ) VALUES (
    v_episode.id,
    v_event.id,
    v_now,
    v_outcome
  );

  RETURN jsonb_build_object(
    'outcome', v_outcome,
    'detectionId', v_episode.id,
    'readPointId', v_read_point.id,
    'readPointCode', v_read_point.code,
    'readPointName', v_read_point.name,
    'readPointZone', v_read_point.zone,
    'readerId', v_episode.reader_id,
    'epc', v_episode.epc,
    'antennaPort', v_episode.antenna_port,
    'firstDetectedAt', v_episode.first_detected_at,
    'lastDetectedAt', v_episode.last_detected_at,
    'rawEventCount', v_episode.raw_event_count,
    'totalReadCount', v_episode.total_read_count,
    'strongestRssiDbm', v_episode.strongest_rssi_dbm,
    'weakestRssiDbm', v_episode.weakest_rssi_dbm,
    'latestRssiDbm', v_episode.latest_rssi_dbm,
    'simulated', v_episode.simulated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_beltcon_rfid_detection_v1(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_beltcon_rfid_detection_v1(TEXT) TO service_role;
