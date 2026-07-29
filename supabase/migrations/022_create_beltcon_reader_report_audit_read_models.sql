-- BELTCON SBTS reader inventory, reporting, and audit read-model support.
-- This migration is additive. It does not introduce physical reader control,
-- device protocols, or a reporting warehouse.

ALTER TABLE public.readers
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS vendor TEXT NULL,
  ADD COLUMN IF NOT EXISTS firmware_version TEXT NULL,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.reader_antennas
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- Reader inventory and antenna configuration are served only through
-- authenticated BELTCON SBTS server APIs. Remove the broad legacy browser
-- policies introduced with the early demonstration schema.
ALTER TABLE public.readers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reader_antennas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_read_readers" ON public.readers;
DROP POLICY IF EXISTS "auth_write_readers" ON public.readers;
DROP POLICY IF EXISTS "auth_update_readers" ON public.readers;
REVOKE ALL ON TABLE public.readers FROM anon, authenticated;
REVOKE ALL ON TABLE public.reader_antennas FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_readers_enabled_status
ON public.readers(enabled, status);

CREATE INDEX IF NOT EXISTS idx_reader_antennas_reader_enabled
ON public.reader_antennas(reader_id, enabled);

CREATE INDEX IF NOT EXISTS idx_rfid_events_reader_received_at
ON public.rfid_events(reader_id, server_received_at DESC)
WHERE server_received_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rfid_events_antenna_received_at
ON public.rfid_events(antenna_id, server_received_at DESC)
WHERE antenna_id IS NOT NULL AND server_received_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rfid_events_zone_received_at
ON public.rfid_events(zone_code, server_received_at DESC)
WHERE zone_code IS NOT NULL AND server_received_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alarms_outcome_opened_at
ON public.alarms(outcome, opened_at DESC)
WHERE opened_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_resolutions_resolved_at
ON public.resolutions(resolved_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_action_created_at
ON public.audit_events(action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_actor_created_at
ON public.audit_events(actor_id, created_at DESC)
WHERE actor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_events_request_id
ON public.audit_events(request_id)
WHERE request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.update_beltcon_reader_configuration_v1(
  p_reader_id TEXT,
  p_name TEXT,
  p_enabled BOOLEAN,
  p_model TEXT,
  p_vendor TEXT,
  p_firmware_version TEXT,
  p_expected_version INTEGER,
  p_actor_id UUID,
  p_canonical_role TEXT,
  p_reason TEXT,
  p_request_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reader public.readers%ROWTYPE;
  v_before JSONB;
  v_after JSONB;
BEGIN
  IF NULLIF(BTRIM(p_reader_id), '') IS NULL OR NULLIF(BTRIM(p_name), '') IS NULL
    OR CHAR_LENGTH(BTRIM(p_name)) > 160 OR p_enabled IS NULL
    OR p_expected_version IS NULL OR p_expected_version < 1
    OR p_actor_id IS NULL OR NULLIF(BTRIM(p_canonical_role), '') IS NULL
    OR NULLIF(BTRIM(p_reason), '') IS NULL OR CHAR_LENGTH(BTRIM(p_reason)) > 500
    OR NULLIF(BTRIM(p_request_id), '') IS NULL
  THEN
    RAISE EXCEPTION 'Invalid reader configuration request' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_reader FROM public.readers WHERE id = BTRIM(p_reader_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reader was not found' USING ERRCODE = 'P0002'; END IF;
  IF v_reader.version <> p_expected_version THEN
    RAISE EXCEPTION 'Reader version conflict' USING ERRCODE = '40001';
  END IF;

  v_before := JSONB_BUILD_OBJECT(
    'name', v_reader.name, 'enabled', v_reader.enabled, 'model', v_reader.model,
    'vendor', v_reader.vendor, 'firmwareVersion', v_reader.firmware_version,
    'version', v_reader.version
  );

  UPDATE public.readers
  SET name = BTRIM(p_name),
      enabled = p_enabled,
      model = COALESCE(NULLIF(BTRIM(p_model), ''), model),
      vendor = NULLIF(BTRIM(p_vendor), ''),
      firmware_version = NULLIF(BTRIM(p_firmware_version), ''),
      version = version + 1,
      updated_at = NOW()
  WHERE id = v_reader.id
  RETURNING * INTO v_reader;

  v_after := JSONB_BUILD_OBJECT(
    'name', v_reader.name, 'enabled', v_reader.enabled, 'model', v_reader.model,
    'vendor', v_reader.vendor, 'firmwareVersion', v_reader.firmware_version,
    'version', v_reader.version
  );

  INSERT INTO public.audit_events(
    action, actor_type, actor_id, canonical_role, source_system, outcome,
    request_id, metadata
  ) VALUES (
    CASE WHEN p_enabled THEN 'READER_CONFIGURATION_UPDATED' ELSE 'READER_DISABLED' END,
    'USER', p_actor_id::TEXT, BTRIM(p_canonical_role), 'BELTCON_READER_MANAGEMENT',
    'SUCCESS', BTRIM(p_request_id),
    JSONB_BUILD_OBJECT('readerId', v_reader.id, 'before', v_before, 'after', v_after,
      'reason', BTRIM(p_reason), 'previousVersion', p_expected_version,
      'version', v_reader.version)
  );

  RETURN TO_JSONB(v_reader);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_beltcon_reader_antenna_configuration_v1(
  p_reader_id TEXT,
  p_antenna_id UUID,
  p_name TEXT,
  p_zone_code TEXT,
  p_direction TEXT,
  p_enabled BOOLEAN,
  p_transmit_power_dbm NUMERIC,
  p_expected_version INTEGER,
  p_actor_id UUID,
  p_canonical_role TEXT,
  p_reason TEXT,
  p_request_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_antenna public.reader_antennas%ROWTYPE;
  v_before JSONB;
  v_after JSONB;
BEGIN
  IF NULLIF(BTRIM(p_reader_id), '') IS NULL OR p_antenna_id IS NULL
    OR NULLIF(BTRIM(p_name), '') IS NULL OR CHAR_LENGTH(BTRIM(p_name)) > 160
    OR p_zone_code NOT IN ('TAGGING', 'RECLAIM', 'CUSTOMS_EXIT', 'RECHECK', 'WASHROOM',
      'EMPLOYEE_EXIT', 'EMERGENCY_EXIT', 'LOST_AND_FOUND', 'CORRIDOR', 'OTHER')
    OR p_enabled IS NULL OR p_expected_version IS NULL OR p_expected_version < 1
    OR p_actor_id IS NULL OR NULLIF(BTRIM(p_canonical_role), '') IS NULL
    OR NULLIF(BTRIM(p_reason), '') IS NULL OR CHAR_LENGTH(BTRIM(p_reason)) > 500
    OR NULLIF(BTRIM(p_request_id), '') IS NULL
    OR (p_transmit_power_dbm IS NOT NULL AND p_transmit_power_dbm NOT BETWEEN 0 AND 40)
  THEN RAISE EXCEPTION 'Invalid antenna configuration request' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_antenna FROM public.reader_antennas
  WHERE id = p_antenna_id AND reader_id = BTRIM(p_reader_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Antenna was not found' USING ERRCODE = 'P0002'; END IF;
  IF v_antenna.version <> p_expected_version THEN
    RAISE EXCEPTION 'Antenna version conflict' USING ERRCODE = '40001';
  END IF;

  v_before := JSONB_BUILD_OBJECT(
    'name', v_antenna.name, 'zoneCode', v_antenna.zone_code,
    'direction', v_antenna.direction, 'enabled', v_antenna.enabled,
    'transmitPowerDbm', v_antenna.transmit_power_dbm, 'version', v_antenna.version
  );

  UPDATE public.reader_antennas
  SET name = BTRIM(p_name), zone_code = p_zone_code,
      direction = NULLIF(BTRIM(p_direction), ''), enabled = p_enabled,
      transmit_power_dbm = p_transmit_power_dbm, version = version + 1,
      updated_at = NOW()
  WHERE id = v_antenna.id
  RETURNING * INTO v_antenna;

  v_after := JSONB_BUILD_OBJECT(
    'name', v_antenna.name, 'zoneCode', v_antenna.zone_code,
    'direction', v_antenna.direction, 'enabled', v_antenna.enabled,
    'transmitPowerDbm', v_antenna.transmit_power_dbm, 'version', v_antenna.version
  );

  INSERT INTO public.audit_events(
    action, actor_type, actor_id, canonical_role, source_system, outcome,
    request_id, metadata
  ) VALUES (
    CASE WHEN v_before->>'zoneCode' IS DISTINCT FROM v_after->>'zoneCode'
      THEN 'ANTENNA_ZONE_MAPPING_CHANGED' ELSE 'ANTENNA_CONFIGURATION_UPDATED' END,
    'USER', p_actor_id::TEXT, BTRIM(p_canonical_role), 'BELTCON_READER_MANAGEMENT',
    'SUCCESS', BTRIM(p_request_id),
    JSONB_BUILD_OBJECT('readerId', v_antenna.reader_id, 'antennaId', v_antenna.id,
      'before', v_before, 'after', v_after, 'reason', BTRIM(p_reason),
      'previousVersion', p_expected_version, 'version', v_antenna.version)
  );

  RETURN TO_JSONB(v_antenna);
END;
$$;

REVOKE ALL ON FUNCTION public.update_beltcon_reader_configuration_v1(
  TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, INTEGER, UUID, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_beltcon_reader_antenna_configuration_v1(
  TEXT, UUID, TEXT, TEXT, TEXT, BOOLEAN, NUMERIC, INTEGER, UUID, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_beltcon_reader_configuration_v1(
  TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, INTEGER, UUID, TEXT, TEXT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_beltcon_reader_antenna_configuration_v1(
  TEXT, UUID, TEXT, TEXT, TEXT, BOOLEAN, NUMERIC, INTEGER, UUID, TEXT, TEXT, TEXT
) TO service_role;
