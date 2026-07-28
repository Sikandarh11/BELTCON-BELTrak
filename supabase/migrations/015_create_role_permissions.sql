-- Durable, versioned role-permission configuration for BELTrak's five
-- canonical roles. Authorization continues to use the canonical profile role;
-- these tables are server-managed and are not writable from browser clients.

CREATE TABLE IF NOT EXISTS public.roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE CHECK (BTRIM(code) <> ''),
  name TEXT NOT NULL UNIQUE CHECK (BTRIM(name) <> ''),
  description TEXT NOT NULL DEFAULT '',
  is_system BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE CHECK (BTRIM(code) <> ''),
  name TEXT NOT NULL CHECK (BTRIM(name) <> ''),
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (BTRIM(category) <> ''),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
  permission_id UUID NOT NULL REFERENCES public.permissions(id) ON DELETE RESTRICT,
  granted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_roles_active
ON public.roles(is_active);

CREATE INDEX IF NOT EXISTS idx_permissions_category
ON public.permissions(category);

CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id
ON public.role_permissions(permission_id);

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.roles FROM anon, authenticated;
REVOKE ALL ON TABLE public.permissions FROM anon, authenticated;
REVOKE ALL ON TABLE public.role_permissions FROM anon, authenticated;

INSERT INTO public.roles (code, name, description, is_system, is_active)
VALUES
  (
    'operations_officer',
    'Operations Officer',
    'Day-to-day bag tagging, alarm response, and recheck operations.',
    TRUE,
    TRUE
  ),
  (
    'control_center_operator',
    'Control Center Operator',
    'Control-center monitoring and RFID reader operations.',
    TRUE,
    TRUE
  ),
  (
    'customs_supervisor',
    'Customs Supervisor',
    'Supervisory alarm, bag, and customs resolution operations.',
    TRUE,
    TRUE
  ),
  (
    'airport_administrator',
    'Airport Administrator',
    'Airport administration, user oversight, settings, and audit access.',
    TRUE,
    TRUE
  ),
  (
    'system_administrator',
    'System Administrator',
    'Full BELTrak system administration and developer tooling.',
    TRUE,
    TRUE
  )
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_system = TRUE;

INSERT INTO public.permissions (code, name, description, category, risk_level)
VALUES
  ('dashboard.view', 'View dashboard', 'View operational dashboards.', 'Dashboard', 'LOW'),
  ('alarm.acknowledge', 'Acknowledge alarms', 'Acknowledge active bag alarms.', 'Alarms', 'MEDIUM'),
  ('alarm.escalate', 'Escalate alarms', 'Escalate an alarm to supervisory response.', 'Alarms', 'HIGH'),
  ('alarm.close', 'Close alarms', 'Close an alarm after an authorized resolution.', 'Alarms', 'HIGH'),
  ('bag.manage', 'Manage bags', 'View and manage operational bag records.', 'Bags', 'MEDIUM'),
  ('bag.tag', 'Encode RFID tags', 'Assign an RFID EPC to an identified bag.', 'Bags', 'HIGH'),
  ('bag.recheck', 'Run bag recheck', 'Inspect and resolve a bag at Recheck.', 'Bags', 'HIGH'),
  ('reader.view', 'View RFID readers', 'View RFID reader state and health.', 'RFID Readers', 'LOW'),
  ('reader.manage', 'Manage RFID readers', 'Change RFID reader configuration and state.', 'RFID Readers', 'HIGH'),
  ('report.view', 'View reports', 'View operational and management reports.', 'Reports', 'LOW'),
  ('user.view', 'View users', 'View BELTrak user accounts and identity health.', 'Administration', 'MEDIUM'),
  ('user.manage', 'Manage users', 'Create, edit, and change BELTrak user accounts.', 'Administration', 'CRITICAL'),
  ('role.view', 'View roles', 'View the canonical role-permission matrix.', 'Administration', 'MEDIUM'),
  ('role.manage', 'Manage roles', 'Change permissions assigned to canonical roles.', 'Administration', 'CRITICAL'),
  ('settings.manage', 'Manage system settings', 'Change BELTrak system settings.', 'Administration', 'CRITICAL'),
  ('audit.view', 'View audit log', 'View durable BELTrak security and operational audit events.', 'Audit', 'HIGH'),
  ('developer.access', 'Access developer tools', 'Access BELTrak developer-only tools and simulators.', 'Developer', 'CRITICAL'),
  ('xray.view', 'View X-ray scans', 'View X-ray scan metadata and image references.', 'X-ray', 'MEDIUM'),
  ('xray.refresh', 'Refresh X-ray scans', 'Retrieve updated X-ray state through the configured adapter.', 'X-ray', 'HIGH')
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  risk_level = EXCLUDED.risk_level;

WITH intended_grants(role_code, permission_code) AS (
  VALUES
    ('operations_officer', 'dashboard.view'),
    ('operations_officer', 'alarm.acknowledge'),
    ('operations_officer', 'alarm.escalate'),
    ('operations_officer', 'bag.manage'),
    ('operations_officer', 'bag.tag'),
    ('operations_officer', 'bag.recheck'),
    ('operations_officer', 'report.view'),
    ('operations_officer', 'xray.view'),
    ('operations_officer', 'xray.refresh'),

    ('control_center_operator', 'dashboard.view'),
    ('control_center_operator', 'alarm.acknowledge'),
    ('control_center_operator', 'alarm.escalate'),
    ('control_center_operator', 'reader.view'),
    ('control_center_operator', 'reader.manage'),
    ('control_center_operator', 'report.view'),

    ('customs_supervisor', 'dashboard.view'),
    ('customs_supervisor', 'alarm.acknowledge'),
    ('customs_supervisor', 'alarm.escalate'),
    ('customs_supervisor', 'alarm.close'),
    ('customs_supervisor', 'bag.manage'),
    ('customs_supervisor', 'bag.tag'),
    ('customs_supervisor', 'bag.recheck'),
    ('customs_supervisor', 'report.view'),
    ('customs_supervisor', 'xray.view'),
    ('customs_supervisor', 'xray.refresh'),

    ('airport_administrator', 'dashboard.view'),
    ('airport_administrator', 'alarm.acknowledge'),
    ('airport_administrator', 'alarm.escalate'),
    ('airport_administrator', 'alarm.close'),
    ('airport_administrator', 'bag.manage'),
    ('airport_administrator', 'bag.tag'),
    ('airport_administrator', 'bag.recheck'),
    ('airport_administrator', 'reader.view'),
    ('airport_administrator', 'reader.manage'),
    ('airport_administrator', 'report.view'),
    ('airport_administrator', 'user.view'),
    ('airport_administrator', 'user.manage'),
    ('airport_administrator', 'role.view'),
    ('airport_administrator', 'settings.manage'),
    ('airport_administrator', 'audit.view'),
    ('airport_administrator', 'xray.view'),
    ('airport_administrator', 'xray.refresh'),

    ('system_administrator', 'dashboard.view'),
    ('system_administrator', 'alarm.acknowledge'),
    ('system_administrator', 'alarm.escalate'),
    ('system_administrator', 'alarm.close'),
    ('system_administrator', 'bag.manage'),
    ('system_administrator', 'bag.tag'),
    ('system_administrator', 'bag.recheck'),
    ('system_administrator', 'reader.view'),
    ('system_administrator', 'reader.manage'),
    ('system_administrator', 'report.view'),
    ('system_administrator', 'user.view'),
    ('system_administrator', 'user.manage'),
    ('system_administrator', 'role.view'),
    ('system_administrator', 'role.manage'),
    ('system_administrator', 'settings.manage'),
    ('system_administrator', 'audit.view'),
    ('system_administrator', 'developer.access'),
    ('system_administrator', 'xray.view'),
    ('system_administrator', 'xray.refresh')
)
INSERT INTO public.role_permissions (role_id, permission_id, granted)
SELECT
  roles.id,
  permissions.id,
  EXISTS (
    SELECT 1
    FROM intended_grants
    WHERE intended_grants.role_code = roles.code
      AND intended_grants.permission_code = permissions.code
  )
FROM public.roles
CROSS JOIN public.permissions
ON CONFLICT (role_id, permission_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.prevent_system_role_delete_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.is_system THEN
    RAISE EXCEPTION 'System roles cannot be deleted'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS prevent_system_role_delete_v1 ON public.roles;
CREATE TRIGGER prevent_system_role_delete_v1
BEFORE DELETE ON public.roles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_system_role_delete_v1();

CREATE OR REPLACE FUNCTION public.update_role_permissions_v1(
  p_role_id UUID,
  p_permission_codes TEXT[],
  p_expected_version INTEGER,
  p_reason TEXT,
  p_actor_id UUID,
  p_canonical_role TEXT,
  p_request_id TEXT,
  p_updated_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role public.roles%ROWTYPE;
  v_before TEXT[];
  v_after TEXT[];
  v_unknown TEXT[];
  v_code TEXT;
  v_next_version INTEGER;
BEGIN
  IF p_canonical_role <> 'System Administrator' THEN
    RAISE EXCEPTION 'Canonical System Administrator role is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_role_id IS NULL
    OR p_expected_version IS NULL OR p_expected_version < 1
    OR p_reason IS NULL OR CHAR_LENGTH(BTRIM(p_reason)) < 3
    OR CHAR_LENGTH(BTRIM(p_reason)) > 500
    OR p_actor_id IS NULL
    OR p_request_id IS NULL OR BTRIM(p_request_id) = ''
    OR p_updated_at IS NULL
  THEN
    RAISE EXCEPTION 'Valid role-permission update values are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_role
  FROM public.roles
  WHERE id = p_role_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Role was not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_role.is_active THEN
    RAISE EXCEPTION 'Inactive roles cannot be changed'
      USING ERRCODE = 'P0004';
  END IF;

  IF v_role.version <> p_expected_version THEN
    RAISE EXCEPTION 'Role version conflict'
      USING ERRCODE = '40001';
  END IF;

  SELECT COALESCE(ARRAY_AGG(DISTINCT BTRIM(code) ORDER BY BTRIM(code)), ARRAY[]::TEXT[])
  INTO v_after
  FROM UNNEST(COALESCE(p_permission_codes, ARRAY[]::TEXT[])) AS supplied(code)
  WHERE BTRIM(code) <> '';

  SELECT COALESCE(ARRAY_AGG(code ORDER BY code), ARRAY[]::TEXT[])
  INTO v_unknown
  FROM UNNEST(v_after) AS supplied(code)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.permissions
    WHERE permissions.code = supplied.code
  );

  IF CARDINALITY(v_unknown) > 0 THEN
    RAISE EXCEPTION 'Unknown permission code'
      USING ERRCODE = '22023',
            DETAIL = ARRAY_TO_STRING(v_unknown, ',');
  END IF;

  IF v_role.code = 'system_administrator'
    AND NOT ARRAY['role.view', 'role.manage', 'user.view', 'user.manage', 'settings.manage']::TEXT[] <@ v_after
  THEN
    RAISE EXCEPTION 'Critical administrator permissions must be retained'
      USING ERRCODE = 'P0003';
  END IF;

  SELECT COALESCE(ARRAY_AGG(permissions.code ORDER BY permissions.code), ARRAY[]::TEXT[])
  INTO v_before
  FROM public.role_permissions
  JOIN public.permissions ON permissions.id = role_permissions.permission_id
  WHERE role_permissions.role_id = v_role.id
    AND role_permissions.granted;

  INSERT INTO public.role_permissions (
    role_id,
    permission_id,
    granted,
    created_at,
    updated_at
  )
  SELECT
    v_role.id,
    permissions.id,
    permissions.code = ANY(v_after),
    p_updated_at,
    p_updated_at
  FROM public.permissions
  ON CONFLICT (role_id, permission_id) DO UPDATE
  SET
    granted = EXCLUDED.granted,
    updated_at = EXCLUDED.updated_at
  WHERE role_permissions.granted IS DISTINCT FROM EXCLUDED.granted;

  v_next_version := v_role.version + 1;

  UPDATE public.roles
  SET
    version = v_next_version,
    updated_at = p_updated_at
  WHERE id = v_role.id;

  INSERT INTO public.audit_events (
    action,
    actor_type,
    actor_id,
    canonical_role,
    source_system,
    outcome,
    request_id,
    metadata,
    created_at
  )
  VALUES (
    'ROLE_PERMISSIONS_UPDATED',
    'USER',
    p_actor_id::TEXT,
    p_canonical_role,
    'BELTRAK_ADMIN',
    'SUCCESS',
    BTRIM(p_request_id),
    JSONB_BUILD_OBJECT(
      'roleId', v_role.id,
      'roleCode', v_role.code,
      'roleName', v_role.name,
      'beforePermissionCodes', TO_JSONB(v_before),
      'afterPermissionCodes', TO_JSONB(v_after),
      'reason', BTRIM(p_reason),
      'previousVersion', v_role.version,
      'version', v_next_version
    ),
    p_updated_at
  );

  FOR v_code IN
    SELECT code FROM UNNEST(v_after) AS added(code)
    EXCEPT
    SELECT code FROM UNNEST(v_before) AS existing(code)
  LOOP
    INSERT INTO public.audit_events (
      action,
      actor_type,
      actor_id,
      canonical_role,
      source_system,
      outcome,
      request_id,
      metadata,
      created_at
    )
    VALUES (
      'ROLE_PERMISSION_GRANTED',
      'USER',
      p_actor_id::TEXT,
      p_canonical_role,
      'BELTRAK_ADMIN',
      'SUCCESS',
      BTRIM(p_request_id),
      JSONB_BUILD_OBJECT(
        'roleId', v_role.id,
        'roleCode', v_role.code,
        'roleName', v_role.name,
        'permissionCode', v_code,
        'reason', BTRIM(p_reason),
        'version', v_next_version
      ),
      p_updated_at
    );
  END LOOP;

  FOR v_code IN
    SELECT code FROM UNNEST(v_before) AS existing(code)
    EXCEPT
    SELECT code FROM UNNEST(v_after) AS retained(code)
  LOOP
    INSERT INTO public.audit_events (
      action,
      actor_type,
      actor_id,
      canonical_role,
      source_system,
      outcome,
      request_id,
      metadata,
      created_at
    )
    VALUES (
      'ROLE_PERMISSION_REVOKED',
      'USER',
      p_actor_id::TEXT,
      p_canonical_role,
      'BELTRAK_ADMIN',
      'SUCCESS',
      BTRIM(p_request_id),
      JSONB_BUILD_OBJECT(
        'roleId', v_role.id,
        'roleCode', v_role.code,
        'roleName', v_role.name,
        'permissionCode', v_code,
        'reason', BTRIM(p_reason),
        'version', v_next_version
      ),
      p_updated_at
    );
  END LOOP;

  RETURN JSONB_BUILD_OBJECT(
    'roleId', v_role.id,
    'roleCode', v_role.code,
    'version', v_next_version,
    'beforePermissionCodes', TO_JSONB(v_before),
    'afterPermissionCodes', TO_JSONB(v_after)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_role_permissions_v1(
  UUID, TEXT[], INTEGER, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.update_role_permissions_v1(
  UUID, TEXT[], INTEGER, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;
