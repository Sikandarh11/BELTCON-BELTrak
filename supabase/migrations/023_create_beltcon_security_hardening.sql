-- BELTCON SBTS Phase 10: additive authorization hardening.
-- Existing role grants are deliberately preserved. Only newly introduced,
-- atomic permission rows receive baseline grants when no row exists yet.

INSERT INTO public.permissions (code, name, description, category, risk_level)
VALUES
  ('bag.read', 'View bags', 'View operational bag records.', 'Bags', 'LOW'),
  ('bag.resolve', 'Resolve bags', 'Complete an authorized bag resolution.', 'Bags', 'HIGH'),
  ('alarm.read', 'View alarms', 'View alarm information.', 'Alarms', 'LOW'),
  ('rfid.read', 'View RFID activity', 'View RFID journey and event data.', 'RFID', 'LOW'),
  ('user.create', 'Create users', 'Create user identities and matching profiles.', 'Administration', 'CRITICAL'),
  ('user.update', 'Update users', 'Update non-secret user profile attributes.', 'Administration', 'HIGH'),
  ('user.activate', 'Activate users', 'Activate eligible user accounts.', 'Administration', 'HIGH'),
  ('user.suspend', 'Suspend users', 'Suspend user accounts.', 'Administration', 'HIGH'),
  ('user.lock', 'Lock users', 'Lock or unlock user accounts.', 'Administration', 'HIGH'),
  ('user.deactivate', 'Deactivate users', 'Deactivate user accounts.', 'Administration', 'CRITICAL'),
  ('user.reset_password', 'Reset user passwords', 'Initiate an administrative reset or invitation delivery.', 'Administration', 'CRITICAL'),
  ('permission.manage', 'Manage permissions', 'Change persisted permission assignments.', 'Administration', 'CRITICAL'),
  ('settings.read', 'View settings', 'View safe system settings.', 'Administration', 'LOW'),
  ('simulator.use', 'Use simulators', 'Use enabled non-production simulators.', 'Development', 'CRITICAL')
ON CONFLICT (code) DO NOTHING;

-- Grant only the new atomic codes. Existing persisted decisions, including
-- any management-approved custom matrix changes, are never overwritten.
WITH baseline_grants(role_code, permission_code) AS (
  VALUES
    ('operations_officer', 'bag.read'),
    ('operations_officer', 'alarm.read'),
    ('control_center_operator', 'alarm.read'),
    ('control_center_operator', 'rfid.read'),
    ('customs_supervisor', 'bag.read'),
    ('customs_supervisor', 'bag.resolve'),
    ('customs_supervisor', 'alarm.read'),
    ('customs_supervisor', 'rfid.read'),
    ('airport_administrator', 'bag.read'),
    ('airport_administrator', 'alarm.read'),
    ('airport_administrator', 'rfid.read'),
    ('airport_administrator', 'user.update'),
    ('airport_administrator', 'settings.read'),
    ('system_administrator', 'bag.read'),
    ('system_administrator', 'bag.resolve'),
    ('system_administrator', 'alarm.read'),
    ('system_administrator', 'rfid.read'),
    ('system_administrator', 'user.create'),
    ('system_administrator', 'user.update'),
    ('system_administrator', 'user.activate'),
    ('system_administrator', 'user.suspend'),
    ('system_administrator', 'user.lock'),
    ('system_administrator', 'user.deactivate'),
    ('system_administrator', 'user.reset_password'),
    ('system_administrator', 'permission.manage'),
    ('system_administrator', 'settings.read'),
    ('system_administrator', 'simulator.use')
)
INSERT INTO public.role_permissions (role_id, permission_id, granted)
SELECT roles.id, permissions.id, TRUE
FROM baseline_grants
JOIN public.roles ON roles.code = baseline_grants.role_code
JOIN public.permissions ON permissions.code = baseline_grants.permission_code
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Do not make role permission management a self-escalation mechanism. The
-- function re-checks the actor's current active profile even though the API
-- already does so, and runs under the same transaction as its audit records.
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
  v_actor_role TEXT;
  v_before TEXT[];
  v_after TEXT[];
  v_unknown TEXT[];
  v_code TEXT;
  v_next_version INTEGER;
BEGIN
  IF p_role_id IS NULL
    OR p_expected_version IS NULL OR p_expected_version < 1
    OR p_reason IS NULL OR CHAR_LENGTH(BTRIM(p_reason)) < 3 OR CHAR_LENGTH(BTRIM(p_reason)) > 500
    OR p_actor_id IS NULL
    OR p_request_id IS NULL OR BTRIM(p_request_id) = ''
    OR p_updated_at IS NULL
  THEN
    RAISE EXCEPTION 'Valid role-permission update values are required' USING ERRCODE = '22023';
  END IF;

  SELECT role INTO v_actor_role
  FROM public.profiles
  WHERE id = p_actor_id AND status = 'ACTIVE' AND is_active = TRUE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active BELTCON profile was not found' USING ERRCODE = '42501';
  END IF;

  IF p_canonical_role <> v_actor_role OR v_actor_role <> 'System Administrator' THEN
    RAISE EXCEPTION 'Canonical System Administrator role is required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_role FROM public.roles WHERE id = p_role_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Role was not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT v_role.is_active THEN RAISE EXCEPTION 'Inactive roles cannot be changed' USING ERRCODE = 'P0004'; END IF;
  IF v_role.version <> p_expected_version THEN RAISE EXCEPTION 'Role version conflict' USING ERRCODE = '40001'; END IF;

  SELECT COALESCE(ARRAY_AGG(DISTINCT BTRIM(code) ORDER BY BTRIM(code)), ARRAY[]::TEXT[])
  INTO v_after
  FROM UNNEST(COALESCE(p_permission_codes, ARRAY[]::TEXT[])) AS supplied(code)
  WHERE BTRIM(code) <> '';

  SELECT COALESCE(ARRAY_AGG(code ORDER BY code), ARRAY[]::TEXT[])
  INTO v_unknown
  FROM UNNEST(v_after) AS supplied(code)
  WHERE NOT EXISTS (SELECT 1 FROM public.permissions WHERE permissions.code = supplied.code);
  IF CARDINALITY(v_unknown) > 0 THEN RAISE EXCEPTION 'Unknown permission code' USING ERRCODE = '22023'; END IF;

  SELECT COALESCE(ARRAY_AGG(permissions.code ORDER BY permissions.code), ARRAY[]::TEXT[])
  INTO v_before
  FROM public.role_permissions
  JOIN public.permissions ON permissions.id = role_permissions.permission_id
  WHERE role_permissions.role_id = v_role.id AND role_permissions.granted;

  IF v_role.code = 'system_administrator'
    AND NOT ARRAY['role.view', 'role.manage', 'user.view', 'user.manage', 'settings.manage']::TEXT[] <@ v_after
  THEN
    RAISE EXCEPTION 'Critical administrator permissions must be retained' USING ERRCODE = 'P0003';
  END IF;

  -- An actor may not add authority to their own canonical role through this
  -- endpoint. Removing non-critical authority remains possible when needed.
  IF v_role.name = v_actor_role
    AND EXISTS (
      SELECT 1 FROM UNNEST(v_after) AS proposed(code)
      WHERE NOT (proposed.code = ANY(v_before))
    )
  THEN
    RAISE EXCEPTION 'Self-escalation is not permitted' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.role_permissions (role_id, permission_id, granted, created_at, updated_at)
  SELECT v_role.id, permissions.id, permissions.code = ANY(v_after), p_updated_at, p_updated_at
  FROM public.permissions
  ON CONFLICT (role_id, permission_id) DO UPDATE
  SET granted = EXCLUDED.granted, updated_at = EXCLUDED.updated_at
  WHERE role_permissions.granted IS DISTINCT FROM EXCLUDED.granted;

  v_next_version := v_role.version + 1;
  UPDATE public.roles SET version = v_next_version, updated_at = p_updated_at WHERE id = v_role.id;

  INSERT INTO public.audit_events (action, actor_type, actor_id, canonical_role, source_system, outcome, request_id, metadata, created_at)
  VALUES (
    'ROLE_PERMISSIONS_UPDATED', 'USER', p_actor_id::TEXT, v_actor_role,
    'BELTCON_ACCESS_CONTROL', 'SUCCESS', BTRIM(p_request_id),
    JSONB_BUILD_OBJECT('roleId', v_role.id, 'roleCode', v_role.code, 'roleName', v_role.name,
      'beforePermissionCodes', TO_JSONB(v_before), 'afterPermissionCodes', TO_JSONB(v_after),
      'reason', BTRIM(p_reason), 'previousVersion', v_role.version, 'version', v_next_version),
    p_updated_at
  );

  FOR v_code IN SELECT code FROM UNNEST(v_after) AS added(code) EXCEPT SELECT code FROM UNNEST(v_before) AS existing(code)
  LOOP
    INSERT INTO public.audit_events (action, actor_type, actor_id, canonical_role, source_system, outcome, request_id, metadata, created_at)
    VALUES ('ROLE_PERMISSION_GRANTED', 'USER', p_actor_id::TEXT, v_actor_role, 'BELTCON_ACCESS_CONTROL', 'SUCCESS', BTRIM(p_request_id),
      JSONB_BUILD_OBJECT('roleId', v_role.id, 'roleCode', v_role.code, 'permissionCode', v_code, 'reason', BTRIM(p_reason), 'version', v_next_version), p_updated_at);
  END LOOP;

  FOR v_code IN SELECT code FROM UNNEST(v_before) AS existing(code) EXCEPT SELECT code FROM UNNEST(v_after) AS retained(code)
  LOOP
    INSERT INTO public.audit_events (action, actor_type, actor_id, canonical_role, source_system, outcome, request_id, metadata, created_at)
    VALUES ('ROLE_PERMISSION_REVOKED', 'USER', p_actor_id::TEXT, v_actor_role, 'BELTCON_ACCESS_CONTROL', 'SUCCESS', BTRIM(p_request_id),
      JSONB_BUILD_OBJECT('roleId', v_role.id, 'roleCode', v_role.code, 'permissionCode', v_code, 'reason', BTRIM(p_reason), 'version', v_next_version), p_updated_at);
  END LOOP;

  RETURN JSONB_BUILD_OBJECT('roleId', v_role.id, 'roleCode', v_role.code, 'version', v_next_version,
    'beforePermissionCodes', TO_JSONB(v_before), 'afterPermissionCodes', TO_JSONB(v_after));
END;
$$;

REVOKE ALL ON FUNCTION public.update_role_permissions_v1(UUID, TEXT[], INTEGER, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_role_permissions_v1(UUID, TEXT[], INTEGER, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ)
TO service_role;
