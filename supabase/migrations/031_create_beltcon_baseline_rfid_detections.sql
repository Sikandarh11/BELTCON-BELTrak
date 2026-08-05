CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.rfid_detections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id TEXT NOT NULL,
  reader_id TEXT NOT NULL REFERENCES public.readers(id) ON DELETE RESTRICT,
  zone TEXT NOT NULL CHECK (zone IN ('TAGGING', 'CUSTOMS_EXIT', 'RECHECK')),
  epc TEXT NOT NULL CHECK (
    epc = UPPER(epc)
    AND (length(epc) = 24 OR length(epc) = 32)
    AND epc ~ '^[0-9A-F]+$'
  ),
  first_detected_at TIMESTAMPTZ NOT NULL,
  last_detected_at TIMESTAMPTZ NOT NULL,
  raw_event_count INTEGER NOT NULL DEFAULT 1 CHECK (raw_event_count >= 1),
  total_read_count INTEGER NOT NULL DEFAULT 1 CHECK (total_read_count >= 1),
  strongest_rssi_dbm NUMERIC NULL,
  simulated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  CONSTRAINT rfid_detections_seen_order_check CHECK (last_detected_at >= first_detected_at)
);

CREATE INDEX IF NOT EXISTS idx_rfid_detections_key
  ON public.rfid_detections(site_id, reader_id, epc, last_detected_at DESC);

CREATE TABLE IF NOT EXISTS public.rfid_event_detection_links (
  rfid_event_id TEXT PRIMARY KEY REFERENCES public.rfid_events(id) ON DELETE CASCADE,
  detection_id UUID NOT NULL REFERENCES public.rfid_detections(id) ON DELETE CASCADE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rfid_event_detection_links_detection_id
  ON public.rfid_event_detection_links(detection_id);

CREATE OR REPLACE FUNCTION public.get_rfid_burst_window_ms()
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_raw TEXT := current_setting('beltcon.rfid_burst_window_ms', true);
  v_value INTEGER;
BEGIN
  IF NULLIF(BTRIM(v_raw), '') IS NULL THEN
    RETURN 1000;
  END IF;
  v_value := v_raw::INTEGER;
  IF v_value < 100 OR v_value > 10000 THEN
    RAISE EXCEPTION 'RFID_BURST_WINDOW_INVALID' USING ERRCODE = '22023';
  END IF;
  RETURN v_value;
END;
$$;

REVOKE ALL ON TABLE public.rfid_detections FROM anon, authenticated;
REVOKE ALL ON TABLE public.rfid_event_detection_links FROM anon, authenticated;

ALTER TABLE public.rfid_detections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfid_event_detection_links ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.reject_baseline_rfid_detection_mutation_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('beltcon.baseline_rfid_detection_rpc', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Baseline RFID detections are mutation-restricted to the trusted RPC' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rfid_detections_mutation_guard ON public.rfid_detections;
CREATE TRIGGER rfid_detections_mutation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.rfid_detections
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_baseline_rfid_detection_mutation_v1();

DROP TRIGGER IF EXISTS rfid_event_detection_links_mutation_guard ON public.rfid_event_detection_links;
CREATE TRIGGER rfid_event_detection_links_mutation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.rfid_event_detection_links
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_baseline_rfid_detection_mutation_v1();

CREATE OR REPLACE FUNCTION public.process_beltcon_baseline_rfid_detection_v1(
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
  v_detection public.rfid_detections%ROWTYPE;
  v_link public.rfid_event_detection_links%ROWTYPE;
  v_lock_key TEXT;
  v_window_ms INTEGER;
  v_window_interval INTERVAL;
  v_now TIMESTAMPTZ := NOW();
  v_outcome TEXT;
  v_zone TEXT;
BEGIN
  IF NULLIF(BTRIM(p_rfid_event_id), '') IS NULL THEN
    RAISE EXCEPTION 'RFID detection event is invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('beltcon.baseline_rfid_detection_rpc', 'on', true);

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

  v_zone := v_reader.zone;
  IF v_zone NOT IN ('TAGGING', 'CUSTOMS_EXIT', 'RECHECK') THEN
    PERFORM 1;
    RETURN jsonb_build_object(
      'outcome', 'OPTIONAL_ZONE_IGNORED',
      'detectionId', v_event.id,
      'rfidEventId', v_event.id,
      'readerId', v_event.reader_id,
      'zone', v_zone,
      'epc', v_event.epc,
      'firstDetectedAt', v_event.first_seen_at,
      'lastDetectedAt', v_event.last_seen_at,
      'rawEventCount', 0,
      'totalReadCount', 0,
      'strongestRssiDbm', v_event.rssi_dbm,
      'simulated', v_event.simulated,
      'version', 1,
      'createdAt', v_event.created_at,
      'updatedAt', v_event.created_at
    );
  END IF;

  v_window_ms := public.get_rfid_burst_window_ms();
  v_window_interval := v_window_ms * INTERVAL '1 millisecond';
  v_lock_key := 'beltcon:baseline:rfid:' || v_event.site_id || ':' || v_event.reader_id || ':' || v_event.epc;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));

  SELECT * INTO v_link
  FROM public.rfid_event_detection_links
  WHERE rfid_event_id = v_event.id
  FOR UPDATE;

  IF FOUND THEN
    SELECT * INTO v_detection
    FROM public.rfid_detections
    WHERE id = v_link.detection_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'RFID_DETECTION_CONFLICT' USING ERRCODE = 'P0001';
    END IF;

    RETURN jsonb_build_object(
      'outcome', CASE WHEN v_detection.raw_event_count = 1 THEN 'DETECTION_CREATED' ELSE 'DETECTION_UPDATED' END,
      'detectionId', v_detection.id,
      'rfidEventId', v_event.id,
      'readerId', v_detection.reader_id,
      'zone', v_detection.zone,
      'epc', v_detection.epc,
      'firstDetectedAt', v_detection.first_detected_at,
      'lastDetectedAt', v_detection.last_detected_at,
      'rawEventCount', v_detection.raw_event_count,
      'totalReadCount', v_detection.total_read_count,
      'strongestRssiDbm', v_detection.strongest_rssi_dbm,
      'simulated', v_detection.simulated,
      'version', v_detection.version,
      'createdAt', v_detection.created_at,
      'updatedAt', v_detection.updated_at
    );
  END IF;

  SELECT *
  INTO v_detection
  FROM public.rfid_detections
  WHERE site_id = v_event.site_id
    AND reader_id = v_event.reader_id
    AND epc = v_event.epc
  ORDER BY last_detected_at DESC, first_detected_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND AND v_event.first_seen_at <= (v_detection.last_detected_at + v_window_interval) THEN
    UPDATE public.rfid_detections
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
      simulated = simulated OR v_event.simulated,
      version = version + 1,
      updated_at = v_now
    WHERE id = v_detection.id
    RETURNING * INTO v_detection;
    v_outcome := 'DETECTION_UPDATED';
  ELSE
    INSERT INTO public.rfid_detections (
      id, site_id, reader_id, zone, epc, first_detected_at, last_detected_at,
      raw_event_count, total_read_count, strongest_rssi_dbm, simulated, created_at, updated_at, version
    ) VALUES (
      gen_random_uuid(), v_event.site_id, v_event.reader_id, v_zone, v_event.epc,
      v_event.first_seen_at, v_event.last_seen_at, 1, v_event.read_count, v_event.rssi_dbm,
      v_event.simulated, v_now, v_now, 1
    )
    RETURNING * INTO v_detection;
    v_outcome := 'DETECTION_CREATED';
  END IF;

  INSERT INTO public.rfid_event_detection_links (rfid_event_id, detection_id, linked_at)
  VALUES (v_event.id, v_detection.id, v_now)
  ON CONFLICT (rfid_event_id) DO NOTHING;

  RETURN jsonb_build_object(
    'outcome', v_outcome,
    'detectionId', v_detection.id,
    'rfidEventId', v_event.id,
    'readerId', v_detection.reader_id,
    'zone', v_detection.zone,
    'epc', v_detection.epc,
    'firstDetectedAt', v_detection.first_detected_at,
    'lastDetectedAt', v_detection.last_detected_at,
    'rawEventCount', v_detection.raw_event_count,
    'totalReadCount', v_detection.total_read_count,
    'strongestRssiDbm', v_detection.strongest_rssi_dbm,
    'simulated', v_detection.simulated,
    'version', v_detection.version,
    'createdAt', v_detection.created_at,
    'updatedAt', v_detection.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_beltcon_baseline_rfid_detection_v1(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_beltcon_baseline_rfid_detection_v1(TEXT) TO service_role;
