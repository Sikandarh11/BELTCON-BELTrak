-- Versioned profile editing, audited account-state transitions, and
-- reason-bearing profile repair for the real Manage Users administration UI.

CREATE OR REPLACE FUNCTION public.create_invited_user_profile_v1(
  p_user_id UUID,
  p_first_name TEXT,
  p_last_name TEXT,
  p_role TEXT,
  p_created_by UUID,
  p_canonical_role TEXT,
  p_request_id TEXT,
  p_created_at TIMESTAMPTZ,
  p_delivery_status TEXT
)
RETURNS SETOF public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_auth_email TEXT;
BEGIN
  IF p_canonical_role <> 'System Administrator' THEN
    RAISE EXCEPTION 'Canonical System Administrator role is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_first_name IS NULL OR BTRIM(p_first_name) = ''
    OR p_last_name IS NULL OR BTRIM(p_last_name) = ''
    OR p_role NOT IN (
      'Operations Officer',
      'Control Center Operator',
      'Customs Supervisor',
      'Airport Administrator',
      'System Administrator'
    )
    OR p_created_by IS NULL
    OR p_request_id IS NULL OR BTRIM(p_request_id) = ''
    OR p_created_at IS NULL
    OR p_delivery_status NOT IN ('SENT', 'FAILED')
  THEN
    RAISE EXCEPTION 'Valid invitation profile values are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT email INTO v_auth_email
  FROM auth.users
  WHERE id = p_user_id;

  IF NOT FOUND OR v_auth_email IS NULL OR BTRIM(v_auth_email) = '' THEN
    RAISE EXCEPTION 'Supabase Auth user was not found'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  INSERT INTO public.profiles (
    id,
    first_name,
    last_name,
    email,
    role,
    status,
    is_active,
    must_change_password,
    updated_at,
    created_by,
    version
  )
  VALUES (
    p_user_id,
    BTRIM(p_first_name),
    BTRIM(p_last_name),
    BTRIM(v_auth_email),
    p_role,
    'PENDING',
    FALSE,
    TRUE,
    p_created_at,
    p_created_by,
    1
  )
  RETURNING public.profiles.*;

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
    'USER_INVITED',
    'USER',
    p_created_by::TEXT,
    p_canonical_role,
    'BELTRAK_ADMIN',
    CASE WHEN p_delivery_status = 'SENT' THEN 'SUCCESS' ELSE 'DELIVERY_FAILED' END,
    BTRIM(p_request_id),
    JSONB_BUILD_OBJECT(
      'targetUserId', p_user_id,
      'targetEmail', BTRIM(v_auth_email),
      'assignedRole', p_role,
      'status', 'PENDING',
      'deliveryStatus', p_delivery_status
    ),
    p_created_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_admin_user_profile_v1(
  p_user_id UUID,
  p_first_name TEXT,
  p_last_name TEXT,
  p_role TEXT,
  p_is_active BOOLEAN,
  p_expected_version INTEGER,
  p_reason TEXT,
  p_actor_id UUID,
  p_canonical_role TEXT,
  p_request_id TEXT,
  p_updated_at TIMESTAMPTZ
)
RETURNS SETOF public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_current public.profiles%ROWTYPE;
  v_next_status TEXT;
BEGIN
  IF p_canonical_role NOT IN ('Airport Administrator', 'System Administrator') THEN
    RAISE EXCEPTION 'Canonical Airport Administrator role or higher is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_first_name IS NULL OR BTRIM(p_first_name) = ''
    OR CHAR_LENGTH(BTRIM(p_first_name)) > 80
    OR p_last_name IS NULL OR BTRIM(p_last_name) = ''
    OR CHAR_LENGTH(BTRIM(p_last_name)) > 80
    OR p_role NOT IN (
      'Operations Officer',
      'Control Center Operator',
      'Customs Supervisor',
      'Airport Administrator',
      'System Administrator'
    )
    OR p_is_active IS NULL
    OR p_expected_version IS NULL OR p_expected_version < 1
    OR p_reason IS NULL OR CHAR_LENGTH(BTRIM(p_reason)) < 3
    OR CHAR_LENGTH(BTRIM(p_reason)) > 500
    OR p_actor_id IS NULL
    OR p_request_id IS NULL OR BTRIM(p_request_id) = ''
    OR p_updated_at IS NULL
  THEN
    RAISE EXCEPTION 'Valid user-edit values are required'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize all changes that could remove the final active System
  -- Administrator. Row locks alone are insufficient when two different
  -- administrator rows are changed concurrently.
  PERFORM PG_ADVISORY_XACT_LOCK(HASHTEXT('beltrak-active-system-administrator'));

  SELECT *
  INTO v_current
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BELTrak profile was not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_current.version <> p_expected_version THEN
    RAISE EXCEPTION 'User was changed by another administrator'
      USING ERRCODE = '40001';
  END IF;

  IF p_user_id = p_actor_id
    AND p_role <> v_current.role
  THEN
    RAISE EXCEPTION 'Administrators cannot change their own canonical role'
      USING ERRCODE = '42501';
  END IF;

  v_next_status := CASE
    WHEN p_is_active = v_current.is_active THEN v_current.status
    WHEN p_is_active THEN 'ACTIVE'
    ELSE 'DEACTIVATED'
  END;

  IF p_canonical_role <> 'System Administrator'
    AND (
      v_current.role = 'System Administrator'
      OR p_role = 'System Administrator'
      OR p_is_active IS DISTINCT FROM v_current.is_active
    )
  THEN
    RAISE EXCEPTION 'Only a System Administrator may manage privileged roles or account activation'
      USING ERRCODE = '42501';
  END IF;

  IF v_current.role = 'System Administrator'
    AND v_current.status = 'ACTIVE'
    AND v_current.is_active
    AND NOT (
      p_role = 'System Administrator'
      AND v_next_status = 'ACTIVE'
      AND p_is_active
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id <> p_user_id
        AND role = 'System Administrator'
        AND status = 'ACTIVE'
        AND is_active
    )
  THEN
    RAISE EXCEPTION 'The final active System Administrator cannot be demoted or deactivated'
      USING ERRCODE = 'P0003';
  END IF;

  RETURN QUERY
  UPDATE public.profiles
  SET
    first_name = BTRIM(p_first_name),
    last_name = BTRIM(p_last_name),
    role = p_role,
    status = v_next_status,
    is_active = p_is_active,
    updated_at = p_updated_at,
    version = version + 1
  WHERE id = p_user_id
    AND version = p_expected_version
  RETURNING public.profiles.*;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User was changed by another administrator'
      USING ERRCODE = '40001';
  END IF;

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
    CASE
      WHEN v_current.role IS DISTINCT FROM p_role THEN 'USER_ROLE_CHANGED'
      ELSE 'USER_UPDATED'
    END,
    'USER',
    p_actor_id::TEXT,
    p_canonical_role,
    'BELTRAK_ADMIN',
    'SUCCESS',
    BTRIM(p_request_id),
    JSONB_BUILD_OBJECT(
      'targetUserId', p_user_id,
      'reason', BTRIM(p_reason),
      'beforeRole', v_current.role,
      'afterRole', p_role,
      'beforeStatus', v_current.status,
      'afterStatus', v_next_status,
      'expectedVersion', p_expected_version,
      'newVersion', p_expected_version + 1
    ),
    p_updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_admin_user_status_v1(
  p_user_id UUID,
  p_action TEXT,
  p_expected_version INTEGER,
  p_reason TEXT,
  p_actor_id UUID,
  p_canonical_role TEXT,
  p_request_id TEXT,
  p_updated_at TIMESTAMPTZ
)
RETURNS SETOF public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_current public.profiles%ROWTYPE;
  v_next_status TEXT;
  v_audit_action TEXT;
BEGIN
  IF p_canonical_role <> 'System Administrator' THEN
    RAISE EXCEPTION 'Canonical System Administrator role is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_action NOT IN ('ACTIVATE', 'SUSPEND', 'LOCK', 'UNLOCK', 'DEACTIVATE')
    OR p_expected_version IS NULL OR p_expected_version < 1
    OR p_reason IS NULL OR CHAR_LENGTH(BTRIM(p_reason)) < 3
    OR CHAR_LENGTH(BTRIM(p_reason)) > 500
    OR p_actor_id IS NULL
    OR p_request_id IS NULL OR BTRIM(p_request_id) = ''
    OR p_updated_at IS NULL
  THEN
    RAISE EXCEPTION 'Valid account action values are required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM PG_ADVISORY_XACT_LOCK(HASHTEXT('beltrak-active-system-administrator'));

  SELECT *
  INTO v_current
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BELTrak profile was not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_current.version <> p_expected_version THEN
    RAISE EXCEPTION 'User was changed by another administrator'
      USING ERRCODE = '40001';
  END IF;

  IF p_user_id = p_actor_id
    AND p_action IN ('SUSPEND', 'LOCK', 'DEACTIVATE')
  THEN
    RAISE EXCEPTION 'Administrators cannot disable their own account'
      USING ERRCODE = '42501';
  END IF;

  CASE p_action
    WHEN 'ACTIVATE' THEN
      IF v_current.status = 'ACTIVE' THEN
        RAISE EXCEPTION 'Account is already active' USING ERRCODE = 'P0001';
      END IF;
      v_next_status := 'ACTIVE';
      v_audit_action := 'USER_ACTIVATED';
    WHEN 'SUSPEND' THEN
      IF v_current.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Only an active account can be suspended' USING ERRCODE = 'P0001';
      END IF;
      v_next_status := 'SUSPENDED';
      v_audit_action := 'USER_SUSPENDED';
    WHEN 'LOCK' THEN
      IF v_current.status IN ('LOCKED', 'DEACTIVATED') THEN
        RAISE EXCEPTION 'Account cannot be locked from its current state'
          USING ERRCODE = 'P0001';
      END IF;
      v_next_status := 'LOCKED';
      v_audit_action := 'USER_LOCKED';
    WHEN 'UNLOCK' THEN
      IF v_current.status <> 'LOCKED' THEN
        RAISE EXCEPTION 'Only a locked account can be unlocked' USING ERRCODE = 'P0001';
      END IF;
      v_next_status := 'ACTIVE';
      v_audit_action := 'USER_UNLOCKED';
    WHEN 'DEACTIVATE' THEN
      IF v_current.status = 'DEACTIVATED' THEN
        RAISE EXCEPTION 'Account is already deactivated' USING ERRCODE = 'P0001';
      END IF;
      v_next_status := 'DEACTIVATED';
      v_audit_action := 'USER_DEACTIVATED';
  END CASE;

  IF v_current.role = 'System Administrator'
    AND v_current.status = 'ACTIVE'
    AND v_current.is_active
    AND v_next_status <> 'ACTIVE'
    AND NOT EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id <> p_user_id
        AND role = 'System Administrator'
        AND status = 'ACTIVE'
        AND is_active
    )
  THEN
    RAISE EXCEPTION 'The final active System Administrator cannot be deactivated'
      USING ERRCODE = 'P0003';
  END IF;

  RETURN QUERY
  UPDATE public.profiles
  SET
    status = v_next_status,
    is_active = (v_next_status = 'ACTIVE'),
    updated_at = p_updated_at,
    version = version + 1
  WHERE id = p_user_id
    AND version = p_expected_version
  RETURNING public.profiles.*;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User was changed by another administrator'
      USING ERRCODE = '40001';
  END IF;

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
    v_audit_action,
    'USER',
    p_actor_id::TEXT,
    p_canonical_role,
    'BELTRAK_ADMIN',
    'SUCCESS',
    BTRIM(p_request_id),
    JSONB_BUILD_OBJECT(
      'targetUserId', p_user_id,
      'reason', BTRIM(p_reason),
      'beforeRole', v_current.role,
      'afterRole', v_current.role,
      'beforeStatus', v_current.status,
      'afterStatus', v_next_status,
      'expectedVersion', p_expected_version,
      'newVersion', p_expected_version + 1
    ),
    p_updated_at
  );

  -- Supabase does not expose a user-id based global sign-out in the installed
  -- SDK. Profile status is reloaded on every protected request, so these
  -- transitions revoke BELTrak access immediately even if a provider token
  -- remains unexpired.
  IF v_next_status IN ('SUSPENDED', 'LOCKED', 'DEACTIVATED') THEN
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
      'SESSION_REVOKED',
      'USER',
      p_actor_id::TEXT,
      p_canonical_role,
      'BELTRAK_AUTHORIZATION',
      'SUCCESS',
      BTRIM(p_request_id) || ':session',
      JSONB_BUILD_OBJECT(
        'targetUserId', p_user_id,
        'beforeRole', v_current.role,
        'afterRole', v_current.role,
        'beforeStatus', v_current.status,
        'afterStatus', v_next_status,
        'mechanism', 'PROFILE_STATUS_ENFORCEMENT'
      ),
      p_updated_at
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_final_system_administrator_delete_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.role = 'System Administrator'
    AND OLD.status = 'ACTIVE'
    AND OLD.is_active
  THEN
    PERFORM PG_ADVISORY_XACT_LOCK(HASHTEXT('beltrak-active-system-administrator'));

    IF NOT EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id <> OLD.id
        AND role = 'System Administrator'
        AND status = 'ACTIVE'
        AND is_active
    )
    THEN
      RAISE EXCEPTION 'The final active System Administrator profile cannot be deleted'
        USING ERRCODE = 'P0003';
    END IF;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS protect_final_system_administrator_delete
ON public.profiles;

CREATE TRIGGER protect_final_system_administrator_delete
BEFORE DELETE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_final_system_administrator_delete_v1();

CREATE OR REPLACE FUNCTION public.repair_user_profile_v2(
  p_user_id UUID,
  p_first_name TEXT,
  p_last_name TEXT,
  p_role TEXT,
  p_actor_id UUID,
  p_canonical_role TEXT,
  p_request_id TEXT,
  p_reason TEXT,
  p_repaired_at TIMESTAMPTZ
)
RETURNS SETOF public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_auth_email TEXT;
  v_profile_existed BOOLEAN;
BEGIN
  IF p_canonical_role <> 'System Administrator' THEN
    RAISE EXCEPTION 'Canonical System Administrator role is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_first_name IS NULL OR BTRIM(p_first_name) = ''
    OR CHAR_LENGTH(BTRIM(p_first_name)) > 80
    OR p_last_name IS NULL OR BTRIM(p_last_name) = ''
    OR CHAR_LENGTH(BTRIM(p_last_name)) > 80
    OR p_role NOT IN (
      'Operations Officer',
      'Control Center Operator',
      'Customs Supervisor',
      'Airport Administrator',
      'System Administrator'
    )
    OR p_actor_id IS NULL
    OR p_request_id IS NULL OR BTRIM(p_request_id) = ''
    OR p_reason IS NULL OR CHAR_LENGTH(BTRIM(p_reason)) < 3
    OR CHAR_LENGTH(BTRIM(p_reason)) > 500
    OR p_repaired_at IS NULL
  THEN
    RAISE EXCEPTION 'Valid repair values are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT email
  INTO v_auth_email
  FROM auth.users
  WHERE id = p_user_id;

  IF NOT FOUND OR v_auth_email IS NULL OR BTRIM(v_auth_email) = '' THEN
    RAISE EXCEPTION 'Supabase Auth user was not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_user_id
  )
  INTO v_profile_existed;

  RETURN QUERY
  INSERT INTO public.profiles (
    id,
    first_name,
    last_name,
    email,
    role,
    status,
    is_active,
    must_change_password,
    updated_at,
    version
  )
  VALUES (
    p_user_id,
    BTRIM(p_first_name),
    BTRIM(p_last_name),
    BTRIM(v_auth_email),
    p_role,
    'ACTIVE',
    TRUE,
    TRUE,
    p_repaired_at,
    1
  )
  ON CONFLICT (id) DO UPDATE
  SET
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    email = EXCLUDED.email,
    role = EXCLUDED.role,
    updated_at = EXCLUDED.updated_at,
    version = public.profiles.version + 1
  RETURNING public.profiles.*;

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
    'USER_PROFILE_REPAIRED',
    'USER',
    p_actor_id::TEXT,
    p_canonical_role,
    'BELTRAK_ADMIN',
    'SUCCESS',
    BTRIM(p_request_id),
    JSONB_BUILD_OBJECT(
      'targetUserId', p_user_id,
      'profileCreated', NOT v_profile_existed,
      'assignedRole', p_role,
      'reason', BTRIM(p_reason)
    ),
    p_repaired_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_invited_user_profile_v1(
  UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_invited_user_profile_v1(
  UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT
) TO service_role;

REVOKE ALL ON FUNCTION public.update_admin_user_profile_v1(
  UUID, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_admin_user_profile_v1(
  UUID, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;

REVOKE ALL ON FUNCTION public.transition_admin_user_status_v1(
  UUID, TEXT, INTEGER, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_admin_user_status_v1(
  UUID, TEXT, INTEGER, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;

REVOKE ALL ON FUNCTION public.repair_user_profile_v2(
  UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_user_profile_v2(
  UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;

REVOKE ALL ON FUNCTION public.prevent_final_system_administrator_delete_v1()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_final_system_administrator_delete_v1()
TO service_role;
