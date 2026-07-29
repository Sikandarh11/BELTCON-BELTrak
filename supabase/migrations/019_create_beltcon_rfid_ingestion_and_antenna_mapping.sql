-- BELTCON SBTS Baseline V1 authoritative RFID read ingestion.
-- This migration adds immutable semantic events and reader + antenna location
-- configuration. It deliberately does not create alarms, X-ray records, or
-- physical LLRP connectivity.

CREATE TABLE IF NOT EXISTS public.reader_antennas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reader_id TEXT NOT NULL REFERENCES public.readers(id) ON DELETE CASCADE,
  port_number SMALLINT NOT NULL CHECK (port_number BETWEEN 1 AND 64),
  name TEXT NOT NULL CHECK (BTRIM(name) <> ''),
  zone_code TEXT NOT NULL CHECK (zone_code IN (
    'TAGGING', 'RECLAIM', 'CUSTOMS_EXIT', 'RECHECK', 'WASHROOM',
    'EMPLOYEE_EXIT', 'EMERGENCY_EXIT', 'LOST_AND_FOUND', 'CORRIDOR', 'OTHER'
  )),
  direction TEXT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  transmit_power_dbm NUMERIC NULL CHECK (transmit_power_dbm BETWEEN 0 AND 40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (reader_id, port_number)
);

ALTER TABLE public.rfid_events
  ADD COLUMN IF NOT EXISTS source_system TEXT,
  ADD COLUMN IF NOT EXISTS source_event_id TEXT,
  ADD COLUMN IF NOT EXISTS bag_id TEXT REFERENCES public.bags(id),
  ADD COLUMN IF NOT EXISTS antenna_id UUID REFERENCES public.reader_antennas(id),
  ADD COLUMN IF NOT EXISTS antenna_port SMALLINT,
  ADD COLUMN IF NOT EXISTS zone_code TEXT,
  ADD COLUMN IF NOT EXISTS device_occurred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS server_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rssi_dbm NUMERIC,
  ADD COLUMN IF NOT EXISTS tid TEXT,
  ADD COLUMN IF NOT EXISTS boot_id TEXT,
  ADD COLUMN IF NOT EXISTS device_sequence BIGINT,
  ADD COLUMN IF NOT EXISTS processing_status TEXT,
  ADD COLUMN IF NOT EXISTS processing_outcome TEXT,
  ADD COLUMN IF NOT EXISTS request_id TEXT,
  ADD COLUMN IF NOT EXISTS event_fingerprint TEXT;

ALTER TABLE public.rfid_events
  ADD CONSTRAINT rfid_events_antenna_port_range_check
  CHECK (antenna_port IS NULL OR antenna_port BETWEEN 1 AND 64) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rfid_events_source_event_unique
ON public.rfid_events(source_system, source_event_id)
WHERE source_system IS NOT NULL AND source_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rfid_events_bag_received_at
ON public.rfid_events(bag_id, server_received_at DESC)
WHERE bag_id IS NOT NULL;

-- Legacy readers hold one free-form zone. Map only values with an unambiguous
-- baseline/future category; manual mappings are never overwritten.
INSERT INTO public.reader_antennas (reader_id, port_number, name, zone_code, enabled)
SELECT r.id, 1, r.name || ' port 1',
  CASE
    WHEN r.zone LIKE 'RECLAIM%' OR r.zone = 'ARRIVAL_HALL' THEN 'RECLAIM'
    WHEN r.zone LIKE 'CUSTOMS_EXIT%' THEN 'CUSTOMS_EXIT'
    WHEN r.zone LIKE 'WASHROOM%' THEN 'WASHROOM'
    WHEN r.zone = 'EMPLOYEE_EXIT' THEN 'EMPLOYEE_EXIT'
    WHEN r.zone = 'EMERGENCY_DOOR' THEN 'EMERGENCY_EXIT'
    WHEN r.zone = 'LOST_FOUND' THEN 'LOST_AND_FOUND'
  END,
  r.status <> 'OFFLINE'
FROM public.readers r
WHERE r.zone LIKE 'RECLAIM%' OR r.zone = 'ARRIVAL_HALL' OR r.zone LIKE 'CUSTOMS_EXIT%'
  OR r.zone LIKE 'WASHROOM%' OR r.zone IN ('EMPLOYEE_EXIT', 'EMERGENCY_DOOR', 'LOST_FOUND')
ON CONFLICT (reader_id, port_number) DO NOTHING;

CREATE OR REPLACE FUNCTION public.process_beltcon_rfid_read_v1(
  p_event_id TEXT,
  p_source_system TEXT,
  p_source_event_id TEXT,
  p_reader_id TEXT,
  p_antenna_port SMALLINT,
  p_epc TEXT,
  p_device_occurred_at TIMESTAMPTZ,
  p_rssi_dbm NUMERIC DEFAULT NULL,
  p_tid TEXT DEFAULT NULL,
  p_device_sequence BIGINT DEFAULT NULL,
  p_boot_id TEXT DEFAULT NULL,
  p_event_fingerprint TEXT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_source TEXT := NULLIF(BTRIM(p_source_system), '');
  v_source_event TEXT := NULLIF(BTRIM(p_source_event_id), '');
  v_epc TEXT := UPPER(BTRIM(COALESCE(p_epc, '')));
  v_reader public.readers%ROWTYPE;
  v_antenna public.reader_antennas%ROWTYPE;
  v_event public.rfid_events%ROWTYPE;
  v_bag public.bags%ROWTYPE;
  v_previous_status TEXT := NULL;
  v_current_status TEXT := NULL;
  v_outcome TEXT;
  v_alarm_eligible BOOLEAN := FALSE;
BEGIN
  IF v_source IS NULL OR v_source_event IS NULL OR NULLIF(BTRIM(p_event_id), '') IS NULL
    OR NULLIF(BTRIM(p_reader_id), '') IS NULL OR p_antenna_port IS NULL
    OR p_antenna_port NOT BETWEEN 1 AND 64 OR v_epc = '' OR p_device_occurred_at IS NULL
  THEN RAISE EXCEPTION 'RFID semantic event is invalid' USING ERRCODE = '22023'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('beltcon:rfid:' || v_source || ':' || v_source_event, 0));
  SELECT * INTO v_event FROM public.rfid_events
  WHERE source_system = v_source AND source_event_id = v_source_event FOR UPDATE;
  IF FOUND THEN
    IF v_event.event_fingerprint IS DISTINCT FROM p_event_fingerprint THEN
      RETURN JSONB_BUILD_OBJECT('outcome','CONFLICT','duplicate',FALSE,'eventId',v_event.id,'errorCode','RFID_EVENT_CONFLICT');
    END IF;
    RETURN JSONB_BUILD_OBJECT('outcome','DUPLICATE','duplicate',TRUE,'eventId',v_event.id,'bagId',v_event.bag_id,'epc',v_event.epc,'readerId',v_event.reader_id,'antennaPort',v_event.antenna_port,'zone',v_event.zone_code,'alarmEligible',COALESCE(v_event.processing_outcome = 'EXIT_DETECTED',FALSE));
  END IF;

  SELECT * INTO v_reader FROM public.readers WHERE id = BTRIM(p_reader_id) FOR SHARE;
  IF NOT FOUND THEN RETURN JSONB_BUILD_OBJECT('outcome','READER_NOT_FOUND','duplicate',FALSE,'errorCode','RFID_READER_NOT_FOUND'); END IF;
  IF v_reader.status = 'OFFLINE' THEN RETURN JSONB_BUILD_OBJECT('outcome','READER_DISABLED','duplicate',FALSE,'errorCode','RFID_READER_DISABLED'); END IF;
  SELECT * INTO v_antenna FROM public.reader_antennas WHERE reader_id = v_reader.id AND port_number = p_antenna_port FOR SHARE;
  IF NOT FOUND THEN RETURN JSONB_BUILD_OBJECT('outcome','ANTENNA_NOT_FOUND','duplicate',FALSE,'errorCode','RFID_ANTENNA_NOT_FOUND'); END IF;
  IF NOT v_antenna.enabled THEN RETURN JSONB_BUILD_OBJECT('outcome','ANTENNA_DISABLED','duplicate',FALSE,'errorCode','RFID_ANTENNA_DISABLED'); END IF;

  SELECT * INTO v_bag FROM public.bags WHERE UPPER(BTRIM(epc)) = v_epc FOR UPDATE;
  IF NOT FOUND THEN
    v_outcome := 'UNASSIGNED_EPC';
  ELSE
    v_previous_status := v_bag.status;
    v_current_status := v_bag.status;
    IF v_bag.status <> 'RESOLVED' THEN
      IF v_antenna.zone_code = 'RECLAIM' AND v_bag.status = 'TAGGED' THEN
        UPDATE public.bags SET current_zone = v_antenna.zone_code, status = 'IN_ARRIVAL_HALL', version = version + 1, updated_at = v_now WHERE id = v_bag.id RETURNING * INTO v_bag;
        v_current_status := v_bag.status;
      ELSIF v_bag.status NOT IN ('ALARMED', 'UNDER_RECHECK', 'RESOLVED') THEN
        UPDATE public.bags SET current_zone = v_antenna.zone_code, version = version + 1, updated_at = v_now WHERE id = v_bag.id RETURNING * INTO v_bag;
        v_current_status := v_bag.status;
      END IF;
    END IF;
    v_outcome := CASE WHEN v_antenna.zone_code = 'CUSTOMS_EXIT' THEN 'EXIT_DETECTED' ELSE 'BAG_DETECTED' END;
    v_alarm_eligible := v_antenna.zone_code = 'CUSTOMS_EXIT';
  END IF;

  INSERT INTO public.rfid_events (id, epc, reader_id, zone, event_type, first_seen, last_seen, read_count, rssi, source_system, source_event_id, bag_id, antenna_id, antenna_port, zone_code, device_occurred_at, server_received_at, rssi_dbm, tid, boot_id, device_sequence, processing_status, processing_outcome, request_id, event_fingerprint)
  VALUES (p_event_id, v_epc, v_reader.id, v_antenna.zone_code, 'BELTCON_RFID_READ', p_device_occurred_at, p_device_occurred_at, 1, COALESCE(ROUND(p_rssi_dbm)::INTEGER, -45), v_source, v_source_event, v_bag.id, v_antenna.id, p_antenna_port, v_antenna.zone_code, p_device_occurred_at, v_now, p_rssi_dbm, NULLIF(BTRIM(p_tid), ''), NULLIF(BTRIM(p_boot_id), ''), p_device_sequence, 'ACCEPTED', v_outcome, NULLIF(BTRIM(p_request_id), ''), p_event_fingerprint)
  RETURNING * INTO v_event;

  IF v_outcome = 'UNASSIGNED_EPC' THEN
    INSERT INTO public.audit_events (action, actor_type, actor_id, source_system, outcome, request_id, metadata)
    VALUES ('RFID_UNASSIGNED_EPC_DETECTED','INTEGRATION',v_source,v_source,'SUCCESS',NULLIF(BTRIM(p_request_id),''),JSONB_BUILD_OBJECT('eventId',v_event.id,'readerId',v_reader.id,'antennaPort',p_antenna_port,'zone',v_antenna.zone_code,'epc',v_epc));
  ELSIF v_previous_status IS DISTINCT FROM v_current_status OR v_bag.current_zone = v_antenna.zone_code THEN
    INSERT INTO public.audit_events (action, actor_type, actor_id, canonical_role, bag_id, source_system, outcome, request_id, metadata)
    VALUES ('BAG_LOCATION_UPDATED','INTEGRATION',v_source,NULL,v_bag.id,v_source,'SUCCESS',NULLIF(BTRIM(p_request_id),''),JSONB_BUILD_OBJECT('eventId',v_event.id,'zone',v_antenna.zone_code,'previousStatus',v_previous_status,'currentStatus',v_current_status));
  END IF;
  RETURN JSONB_BUILD_OBJECT('outcome',v_outcome,'duplicate',FALSE,'eventId',v_event.id,'bagId',v_event.bag_id,'bhsUid',v_bag.bhs_uid,'epc',v_epc,'readerId',v_reader.id,'antennaPort',p_antenna_port,'zone',v_antenna.zone_code,'alarmEligible',v_alarm_eligible,'previousStatus',v_previous_status,'currentStatus',v_current_status);
END;
$$;

REVOKE ALL ON FUNCTION public.process_beltcon_rfid_read_v1(TEXT, TEXT, TEXT, TEXT, SMALLINT, TEXT, TIMESTAMPTZ, NUMERIC, TEXT, BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_beltcon_rfid_read_v1(TEXT, TEXT, TEXT, TEXT, SMALLINT, TEXT, TIMESTAMPTZ, NUMERIC, TEXT, BIGINT, TEXT, TEXT, TEXT) TO service_role;
