-- BELTCON SBTS Phase 4.3 authoritative RFID read ingestion.
-- Reuses the existing public.rfid_events table and hardens it for strict
-- transport idempotency, server-owned persistence, and append-only writes.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.rfid_events
  ADD COLUMN IF NOT EXISTS site_id TEXT,
  ADD COLUMN IF NOT EXISTS source_event_id TEXT,
  ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS antenna_port SMALLINT,
  ADD COLUMN IF NOT EXISTS rssi_dbm NUMERIC,
  ADD COLUMN IF NOT EXISTS read_count INTEGER,
  ADD COLUMN IF NOT EXISTS adapter_type TEXT,
  ADD COLUMN IF NOT EXISTS simulated BOOLEAN,
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payload_hash TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

UPDATE public.rfid_events ev
SET
  site_id = COALESCE(NULLIF(ev.site_id, ''), r.site_id, 'ALWAJH'),
  source_event_id = COALESCE(NULLIF(ev.source_event_id, ''), ev.id),
  first_seen_at = COALESCE(ev.first_seen_at, ev.first_seen, ev.device_occurred_at, ev.server_received_at, NOW()),
  last_seen_at = COALESCE(ev.last_seen_at, ev.last_seen, ev.device_occurred_at, ev.server_received_at, NOW()),
  antenna_port = COALESCE(ev.antenna_port, ev.antenna_port, 1),
  rssi_dbm = COALESCE(ev.rssi_dbm, ev.rssi_dbm),
  read_count = COALESCE(ev.read_count, 1),
  adapter_type = COALESCE(NULLIF(ev.adapter_type, ''), CASE WHEN r.adapter_type = 'SIMULATED' THEN 'SIMULATED' ELSE 'UNAVAILABLE_PHYSICAL' END),
  simulated = COALESCE(ev.simulated, r.adapter_type = 'SIMULATED', FALSE),
  received_at = COALESCE(ev.received_at, ev.server_received_at, ev.device_occurred_at, ev.created_at, NOW()),
  created_at = COALESCE(ev.created_at, ev.server_received_at, NOW()),
  epc = UPPER(BTRIM(ev.epc)),
  payload_hash = COALESCE(
    ev.payload_hash,
    encode(
      extensions.digest(
        concat_ws(
          E'\x1F',
          COALESCE(NULLIF(ev.site_id, ''), r.site_id, 'ALWAJH'),
          COALESCE(ev.reader_id, ''),
          COALESCE(NULLIF(ev.source_event_id, ''), ev.id),
          COALESCE(UPPER(BTRIM(ev.epc)), ''),
          COALESCE(ev.antenna_port::TEXT, '1'),
          COALESCE(ev.rssi_dbm::TEXT, ''),
          COALESCE(COALESCE(ev.first_seen_at, ev.first_seen, ev.device_occurred_at, ev.server_received_at, NOW())::TEXT, ''),
          COALESCE(COALESCE(ev.last_seen_at, ev.last_seen, ev.device_occurred_at, ev.server_received_at, NOW())::TEXT, ''),
          COALESCE(COALESCE(ev.read_count, 1)::TEXT, '1'),
          COALESCE(
            NULLIF(ev.adapter_type, ''),
            CASE WHEN r.adapter_type = 'SIMULATED' THEN 'SIMULATED' ELSE 'UNAVAILABLE_PHYSICAL' END
          ),
          CASE WHEN COALESCE(ev.simulated, r.adapter_type = 'SIMULATED', FALSE) THEN '1' ELSE '0' END
        ),
        'sha256'
      ),
      'hex'
    )
  )
FROM public.readers r
WHERE r.id = ev.reader_id;

UPDATE public.rfid_events
SET
  site_id = COALESCE(NULLIF(site_id, ''), 'ALWAJH'),
  source_event_id = COALESCE(NULLIF(source_event_id, ''), id),
  first_seen_at = COALESCE(first_seen_at, first_seen, device_occurred_at, server_received_at, NOW()),
  last_seen_at = COALESCE(last_seen_at, last_seen, device_occurred_at, server_received_at, NOW()),
  antenna_port = COALESCE(antenna_port, 1),
  read_count = COALESCE(read_count, 1),
  adapter_type = COALESCE(NULLIF(adapter_type, ''), 'UNAVAILABLE_PHYSICAL'),
  simulated = COALESCE(simulated, FALSE),
  received_at = COALESCE(received_at, server_received_at, device_occurred_at, created_at, NOW()),
  created_at = COALESCE(created_at, server_received_at, NOW()),
  epc = UPPER(BTRIM(epc)),
  payload_hash = COALESCE(
    payload_hash,
    encode(
      extensions.digest(
        concat_ws(
          E'\x1F',
          COALESCE(NULLIF(site_id, ''), 'ALWAJH'),
          COALESCE(reader_id, ''),
          COALESCE(NULLIF(source_event_id, ''), id),
          COALESCE(UPPER(BTRIM(epc)), ''),
          COALESCE(antenna_port::TEXT, '1'),
          COALESCE(rssi_dbm::TEXT, ''),
          COALESCE(COALESCE(first_seen_at, first_seen, device_occurred_at, server_received_at, NOW())::TEXT, ''),
          COALESCE(COALESCE(last_seen_at, last_seen, device_occurred_at, server_received_at, NOW())::TEXT, ''),
          COALESCE(COALESCE(read_count, 1)::TEXT, '1'),
          COALESCE(NULLIF(adapter_type, ''), 'UNAVAILABLE_PHYSICAL'),
          CASE WHEN COALESCE(simulated, FALSE) THEN '1' ELSE '0' END
        ),
        'sha256'
      ),
      'hex'
    )
  );

ALTER TABLE public.rfid_events
  ALTER COLUMN site_id SET NOT NULL,
  ALTER COLUMN source_event_id SET NOT NULL,
  ALTER COLUMN first_seen_at SET NOT NULL,
  ALTER COLUMN last_seen_at SET NOT NULL,
  ALTER COLUMN antenna_port SET NOT NULL,
  ALTER COLUMN read_count SET NOT NULL,
  ALTER COLUMN adapter_type SET NOT NULL,
  ALTER COLUMN simulated SET NOT NULL,
  ALTER COLUMN received_at SET NOT NULL,
  ALTER COLUMN payload_hash SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE public.rfid_events
  ADD CONSTRAINT rfid_events_reader_fk
    FOREIGN KEY (reader_id) REFERENCES public.readers(id) NOT VALID,
  ADD CONSTRAINT rfid_events_epc_canonical_check
    CHECK (
      epc = UPPER(epc)
      AND (length(epc) = 24 OR length(epc) = 32)
      AND epc ~ '^[0-9A-F]+$'
    ) NOT VALID,
  ADD CONSTRAINT rfid_events_antenna_port_positive_check
    CHECK (antenna_port > 0) NOT VALID,
  ADD CONSTRAINT rfid_events_read_count_positive_check
    CHECK (read_count >= 1) NOT VALID,
  ADD CONSTRAINT rfid_events_seen_order_check
    CHECK (last_seen_at >= first_seen_at) NOT VALID,
  ADD CONSTRAINT rfid_events_adapter_simulated_check
    CHECK (
      (adapter_type = 'SIMULATED' AND simulated)
      OR (adapter_type <> 'SIMULATED' AND NOT simulated)
    ) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rfid_events_transport_identity_unique
  ON public.rfid_events(site_id, reader_id, source_event_id);

CREATE INDEX IF NOT EXISTS idx_rfid_events_reader_source_event
  ON public.rfid_events(site_id, reader_id, source_event_id, received_at DESC);

ALTER TABLE public.rfid_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_read_rfid_events ON public.rfid_events;
CREATE POLICY auth_read_rfid_events
  ON public.rfid_events
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS auth_write_rfid_events ON public.rfid_events;
DROP POLICY IF EXISTS auth_update_rfid_events ON public.rfid_events;
DROP POLICY IF EXISTS auth_delete_rfid_events ON public.rfid_events;

REVOKE INSERT, UPDATE, DELETE ON public.rfid_events FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.reject_rfid_event_mutation_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'RFID events are append-only' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS rfid_events_append_only ON public.rfid_events;
CREATE TRIGGER rfid_events_append_only
  BEFORE UPDATE OR DELETE ON public.rfid_events
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_rfid_event_mutation_v1();

CREATE OR REPLACE FUNCTION public.ingest_beltcon_rfid_read_v1(
  p_site_id TEXT,
  p_reader_id TEXT,
  p_source_event_id TEXT,
  p_epc TEXT,
  p_antenna_port SMALLINT,
  p_rssi_dbm NUMERIC DEFAULT NULL,
  p_first_seen_at TIMESTAMPTZ DEFAULT NULL,
  p_last_seen_at TIMESTAMPTZ DEFAULT NULL,
  p_read_count INTEGER DEFAULT 1,
  p_adapter_type TEXT DEFAULT NULL,
  p_simulated BOOLEAN DEFAULT FALSE,
  p_received_at TIMESTAMPTZ DEFAULT NULL,
  p_payload_hash TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_site_id TEXT := NULLIF(BTRIM(p_site_id), '');
  v_reader_id TEXT := NULLIF(BTRIM(p_reader_id), '');
  v_source_event_id TEXT := NULLIF(BTRIM(p_source_event_id), '');
  v_epc TEXT := UPPER(BTRIM(COALESCE(p_epc, '')));
  v_adapter_type TEXT := NULLIF(BTRIM(p_adapter_type), '');
  v_now TIMESTAMPTZ := COALESCE(p_received_at, NOW());
  v_reader public.readers%ROWTYPE;
  v_event public.rfid_events%ROWTYPE;
BEGIN
  IF v_site_id IS NULL
    OR v_reader_id IS NULL
    OR v_source_event_id IS NULL
    OR v_epc = ''
    OR p_antenna_port IS NULL
    OR p_antenna_port < 1
    OR p_read_count IS NULL
    OR p_read_count < 1
    OR p_first_seen_at IS NULL
    OR p_last_seen_at IS NULL
    OR v_adapter_type IS NULL
    OR p_payload_hash IS NULL
  THEN
    RAISE EXCEPTION 'RFID read input is invalid' USING ERRCODE = '22023';
  END IF;

  IF NOT (v_epc ~ '^[0-9A-F]+$' AND (length(v_epc) = 24 OR length(v_epc) = 32)) THEN
    RAISE EXCEPTION 'RFID EPC is invalid' USING ERRCODE = '22023';
  END IF;

  IF p_last_seen_at < p_first_seen_at THEN
    RAISE EXCEPTION 'RFID last_seen_at must not be earlier than first_seen_at' USING ERRCODE = '22023';
  END IF;

  IF (v_adapter_type = 'SIMULATED' AND NOT p_simulated)
    OR (v_adapter_type <> 'SIMULATED' AND p_simulated)
  THEN
    RAISE EXCEPTION 'RFID adapter type and simulated flag are inconsistent' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_reader
  FROM public.readers
  WHERE id = v_reader_id AND site_id = v_site_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RFID_READER_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('beltcon:rfid:' || v_site_id || ':' || v_reader_id || ':' || v_source_event_id, 0));

  SELECT *
  INTO v_event
  FROM public.rfid_events
  WHERE site_id = v_site_id
    AND reader_id = v_reader_id
    AND source_event_id = v_source_event_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_event.payload_hash IS DISTINCT FROM p_payload_hash THEN
      RAISE EXCEPTION 'RFID_SOURCE_EVENT_CONFLICT' USING ERRCODE = 'P0001';
    END IF;

    RETURN jsonb_build_object(
      'outcome', 'DUPLICATE_REPLAY',
      'eventId', v_event.id,
      'sourceEventId', v_event.source_event_id,
      'readerId', v_event.reader_id,
      'siteId', v_event.site_id,
      'epc', v_event.epc,
      'receivedAt', v_event.received_at,
      'simulated', v_event.simulated
    );
  END IF;

  INSERT INTO public.rfid_events (
    id,
    site_id,
    reader_id,
    zone,
    event_type,
    first_seen,
    last_seen,
    read_count,
    rssi,
    source_event_id,
    epc,
    antenna_port,
    rssi_dbm,
    first_seen_at,
    last_seen_at,
    adapter_type,
    simulated,
    received_at,
    payload_hash,
    created_at
  ) VALUES (
    gen_random_uuid()::TEXT,
    v_site_id,
    v_reader_id,
    v_reader.zone,
    'RFID_READ',
    p_first_seen_at,
    p_last_seen_at,
    p_read_count,
    COALESCE(ROUND(p_rssi_dbm)::INTEGER, -45),
    v_source_event_id,
    v_epc,
    p_antenna_port,
    p_rssi_dbm,
    p_first_seen_at,
    p_last_seen_at,
    v_adapter_type,
    p_simulated,
    v_now,
    p_payload_hash,
    v_now
  )
  RETURNING * INTO v_event;

  RETURN jsonb_build_object(
    'outcome', 'STORED',
    'eventId', v_event.id,
    'sourceEventId', v_event.source_event_id,
    'readerId', v_event.reader_id,
    'siteId', v_event.site_id,
    'epc', v_event.epc,
    'receivedAt', v_event.received_at,
    'simulated', v_event.simulated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_beltcon_rfid_read_v1(
  TEXT, TEXT, TEXT, TEXT, SMALLINT, NUMERIC, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, TEXT, BOOLEAN, TIMESTAMPTZ, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_beltcon_rfid_read_v1(
  TEXT, TEXT, TEXT, TEXT, SMALLINT, NUMERIC, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, TEXT, BOOLEAN, TIMESTAMPTZ, TEXT
) TO service_role;
