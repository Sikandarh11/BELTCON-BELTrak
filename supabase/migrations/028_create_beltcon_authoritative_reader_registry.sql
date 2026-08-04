-- BELTCON SBTS authoritative RFID reader registry.
-- This migration reconciles the legacy demonstration readers table with the
-- server-owned registry model used by the readers page.

ALTER TABLE public.readers
  ADD COLUMN IF NOT EXISTS reader_code TEXT,
  ADD COLUMN IF NOT EXISTS site_id TEXT NOT NULL DEFAULT 'ALWAJH',
  ADD COLUMN IF NOT EXISTS adapter_type TEXT NOT NULL DEFAULT 'UNAVAILABLE_PHYSICAL',
  ADD COLUMN IF NOT EXISTS host TEXT,
  ADD COLUMN IF NOT EXISTS health_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS configuration_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_by TEXT,
  ADD COLUMN IF NOT EXISTS updated_by TEXT;

ALTER TABLE public.readers
  ALTER COLUMN model DROP NOT NULL;

ALTER TABLE public.readers
  ALTER COLUMN ip DROP NOT NULL;

UPDATE public.readers
SET
  reader_code = COALESCE(NULLIF(reader_code, ''), id),
  site_id = COALESCE(NULLIF(site_id, ''), 'ALWAJH'),
  adapter_type = CASE
    WHEN adapter_type = 'SIMULATED' THEN 'SIMULATED'
    ELSE 'THINGMAGIC_IZAR'
  END,
  host = COALESCE(NULLIF(host, ''), NULLIF(ip, '')),
  health_status = CASE
    WHEN enabled IS FALSE THEN 'DISABLED'
    WHEN adapter_type = 'SIMULATED' THEN 'SIMULATED'
    WHEN status = 'DEGRADED' THEN 'DEGRADED'
    WHEN status = 'OFFLINE' THEN 'OFFLINE'
    WHEN status = 'ONLINE' AND COALESCE(NULLIF(host, ''), NULLIF(ip, '')) IS NOT NULL THEN 'ONLINE'
    WHEN COALESCE(NULLIF(host, ''), NULLIF(ip, '')) IS NULL THEN 'MISCONFIGURED'
    ELSE 'UNKNOWN'
  END,
  configuration_version = COALESCE(configuration_version, version, 1),
  created_by = created_by,
  updated_by = updated_by;

UPDATE public.readers
SET zone = CASE zone
  WHEN 'RECLAIM_BELT_1' THEN 'RECLAIM'
  WHEN 'RECLAIM_BELT_2' THEN 'RECLAIM'
  WHEN 'RECLAIM_BELT_3' THEN 'RECLAIM'
  WHEN 'ARRIVAL_HALL' THEN 'TAGGING'
  WHEN 'LOST_FOUND' THEN 'LOST_AND_FOUND'
  WHEN 'WASHROOM_NORTH' THEN 'WASHROOM'
  WHEN 'WASHROOM_SOUTH' THEN 'WASHROOM'
  WHEN 'CUSTOMS_EXIT_GATE_1' THEN 'CUSTOMS_EXIT'
  WHEN 'CUSTOMS_EXIT_GATE_2' THEN 'CUSTOMS_EXIT'
  WHEN 'CUSTOMS_EXIT_GATE_3' THEN 'CUSTOMS_EXIT'
  WHEN 'EMERGENCY_DOOR' THEN 'EMERGENCY_EXIT'
  ELSE zone
END;

UPDATE public.readers
SET reader_code = id
WHERE reader_code IS NULL OR BTRIM(reader_code) = '';

ALTER TABLE public.readers
  ALTER COLUMN reader_code SET NOT NULL,
  ALTER COLUMN site_id SET NOT NULL,
  ALTER COLUMN adapter_type SET NOT NULL,
  ALTER COLUMN health_status SET NOT NULL,
  ALTER COLUMN configuration_version SET NOT NULL;

ALTER TABLE public.readers
  ADD CONSTRAINT readers_site_reader_code_key UNIQUE (site_id, reader_code);

CREATE INDEX IF NOT EXISTS idx_readers_site_code
ON public.readers(site_id, reader_code);

CREATE INDEX IF NOT EXISTS idx_readers_site_health
ON public.readers(site_id, health_status, enabled);

CREATE INDEX IF NOT EXISTS idx_readers_site_zone
ON public.readers(site_id, zone);

ALTER TABLE public.readers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.readers FROM anon, authenticated;

UPDATE public.role_permissions rp
SET granted = FALSE
FROM public.roles r, public.permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.code = 'control_center_operator'
  AND p.code = 'reader.manage';

UPDATE public.role_permissions rp
SET granted = TRUE
FROM public.roles r, public.permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.code IN ('airport_administrator', 'system_administrator')
  AND p.code = 'reader.manage';

CREATE OR REPLACE FUNCTION public.create_beltcon_reader_configuration_v1(
  p_site_id TEXT,
  p_reader_code TEXT,
  p_name TEXT,
  p_zone TEXT,
  p_vendor TEXT,
  p_model TEXT,
  p_adapter_type TEXT,
  p_host TEXT,
  p_enabled BOOLEAN,
  p_actor_id UUID,
  p_canonical_role TEXT,
  p_request_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reader public.readers%ROWTYPE;
BEGIN
  IF NULLIF(BTRIM(p_site_id), '') IS NULL
    OR NULLIF(BTRIM(p_reader_code), '') IS NULL
    OR NULLIF(BTRIM(p_name), '') IS NULL
    OR NULLIF(BTRIM(p_zone), '') IS NULL
    OR NULLIF(BTRIM(p_adapter_type), '') IS NULL
    OR p_enabled IS NULL
    OR p_actor_id IS NULL
    OR NULLIF(BTRIM(p_canonical_role), '') IS NULL
    OR NULLIF(BTRIM(p_request_id), '') IS NULL
  THEN
    RAISE EXCEPTION 'Invalid reader configuration request' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.readers (
    id,
    reader_code,
    site_id,
    name,
    zone,
    model,
    vendor,
    adapter_type,
    ip,
    host,
    enabled,
    health_status,
    last_heartbeat_at,
    last_event_at,
    configuration_version,
    created_by,
    updated_by,
    version,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid()::TEXT,
    BTRIM(p_reader_code),
    BTRIM(p_site_id),
    BTRIM(p_name),
    BTRIM(p_zone),
    NULLIF(BTRIM(p_model), ''),
    NULLIF(BTRIM(p_vendor), ''),
    BTRIM(p_adapter_type),
    NULLIF(BTRIM(p_host), ''),
    NULLIF(BTRIM(p_host), ''),
    p_enabled,
    CASE
      WHEN p_enabled IS FALSE THEN 'DISABLED'
      WHEN BTRIM(p_adapter_type) = 'SIMULATED' THEN 'SIMULATED'
      WHEN NULLIF(BTRIM(p_host), '') IS NULL THEN 'MISCONFIGURED'
      ELSE 'UNKNOWN'
    END,
    NULL,
    NULL,
    1,
    p_actor_id::TEXT,
    p_actor_id::TEXT,
    1,
    NOW(),
    NOW()
  )
  RETURNING * INTO v_reader;

  RETURN TO_JSONB(v_reader);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_beltcon_reader_configuration_v1(
  p_reader_id TEXT,
  p_site_id TEXT,
  p_reader_code TEXT,
  p_name TEXT,
  p_zone TEXT,
  p_vendor TEXT,
  p_model TEXT,
  p_adapter_type TEXT,
  p_host TEXT,
  p_enabled BOOLEAN,
  p_expected_version INTEGER,
  p_actor_id UUID,
  p_canonical_role TEXT,
  p_request_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reader public.readers%ROWTYPE;
BEGIN
  IF NULLIF(BTRIM(p_reader_id), '') IS NULL
    OR NULLIF(BTRIM(p_site_id), '') IS NULL
    OR NULLIF(BTRIM(p_reader_code), '') IS NULL
    OR NULLIF(BTRIM(p_name), '') IS NULL
    OR NULLIF(BTRIM(p_zone), '') IS NULL
    OR NULLIF(BTRIM(p_adapter_type), '') IS NULL
    OR p_enabled IS NULL
    OR p_expected_version IS NULL OR p_expected_version < 1
    OR p_actor_id IS NULL
    OR NULLIF(BTRIM(p_canonical_role), '') IS NULL
    OR NULLIF(BTRIM(p_request_id), '') IS NULL
  THEN
    RAISE EXCEPTION 'Invalid reader configuration request' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_reader
  FROM public.readers
  WHERE id = BTRIM(p_reader_id) AND site_id = BTRIM(p_site_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reader was not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_reader.configuration_version <> p_expected_version THEN
    RAISE EXCEPTION 'Reader version conflict' USING ERRCODE = '40001';
  END IF;

  UPDATE public.readers
  SET reader_code = BTRIM(p_reader_code),
      name = BTRIM(p_name),
      zone = BTRIM(p_zone),
      vendor = NULLIF(BTRIM(p_vendor), ''),
      model = NULLIF(BTRIM(p_model), ''),
      adapter_type = BTRIM(p_adapter_type),
      ip = NULLIF(BTRIM(p_host), ''),
      host = NULLIF(BTRIM(p_host), ''),
      enabled = p_enabled,
      health_status = CASE
        WHEN p_enabled IS FALSE THEN 'DISABLED'
        WHEN BTRIM(p_adapter_type) = 'SIMULATED' THEN 'SIMULATED'
        WHEN NULLIF(BTRIM(p_host), '') IS NULL THEN 'MISCONFIGURED'
        ELSE COALESCE(NULLIF(health_status, 'DISABLED'), 'UNKNOWN')
      END,
      configuration_version = configuration_version + 1,
      updated_by = p_actor_id::TEXT,
      version = version + 1,
      updated_at = NOW()
  WHERE id = v_reader.id
  RETURNING * INTO v_reader;

  RETURN TO_JSONB(v_reader);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_beltcon_reader_enabled_v1(
  p_reader_id TEXT,
  p_site_id TEXT,
  p_enabled BOOLEAN,
  p_expected_version INTEGER,
  p_actor_id UUID,
  p_canonical_role TEXT,
  p_request_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reader public.readers%ROWTYPE;
BEGIN
  IF NULLIF(BTRIM(p_reader_id), '') IS NULL
    OR NULLIF(BTRIM(p_site_id), '') IS NULL
    OR p_enabled IS NULL
    OR p_expected_version IS NULL OR p_expected_version < 1
    OR p_actor_id IS NULL
    OR NULLIF(BTRIM(p_canonical_role), '') IS NULL
    OR NULLIF(BTRIM(p_request_id), '') IS NULL
  THEN
    RAISE EXCEPTION 'Invalid reader configuration request' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_reader
  FROM public.readers
  WHERE id = BTRIM(p_reader_id) AND site_id = BTRIM(p_site_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reader was not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_reader.configuration_version <> p_expected_version THEN
    RAISE EXCEPTION 'Reader version conflict' USING ERRCODE = '40001';
  END IF;

  UPDATE public.readers
  SET enabled = p_enabled,
      health_status = CASE
        WHEN p_enabled IS FALSE THEN 'DISABLED'
        WHEN adapter_type = 'SIMULATED' THEN 'SIMULATED'
        WHEN COALESCE(NULLIF(host, ''), NULLIF(ip, '')) IS NULL THEN 'MISCONFIGURED'
        ELSE COALESCE(NULLIF(health_status, 'DISABLED'), 'UNKNOWN')
      END,
      configuration_version = configuration_version + 1,
      updated_by = p_actor_id::TEXT,
      version = version + 1,
      updated_at = NOW()
  WHERE id = v_reader.id
  RETURNING * INTO v_reader;

  RETURN TO_JSONB(v_reader);
END;
$$;

REVOKE ALL ON FUNCTION public.create_beltcon_reader_configuration_v1(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_beltcon_reader_configuration_v1(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_beltcon_reader_enabled_v1(
  TEXT, TEXT, BOOLEAN, INTEGER, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_beltcon_reader_configuration_v1(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, UUID, TEXT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_beltcon_reader_configuration_v1(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, UUID, TEXT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_beltcon_reader_enabled_v1(
  TEXT, TEXT, BOOLEAN, INTEGER, UUID, TEXT, TEXT
) TO service_role;
