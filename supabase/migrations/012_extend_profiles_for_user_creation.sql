-- Phase 2 user lifecycle fields. Existing rows are normalized without
-- deleting or replacing identities.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS version INTEGER;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN,
  ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ;

UPDATE public.profiles
SET is_active = TRUE
WHERE is_active IS NULL;

UPDATE public.profiles
SET status = CASE
  WHEN is_active THEN 'ACTIVE'
  ELSE 'DEACTIVATED'
END
WHERE status IS NULL
  OR status NOT IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'LOCKED', 'DEACTIVATED')
  OR (status = 'ACTIVE') IS DISTINCT FROM is_active;

UPDATE public.profiles
SET must_change_password = TRUE
WHERE must_change_password IS NULL;

UPDATE public.profiles
SET updated_at = COALESCE(created_at, NOW())
WHERE updated_at IS NULL;

UPDATE public.profiles
SET version = 1
WHERE version IS NULL OR version < 1;

ALTER TABLE public.profiles
  ALTER COLUMN status SET DEFAULT 'ACTIVE',
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN is_active SET DEFAULT TRUE,
  ALTER COLUMN is_active SET NOT NULL,
  ALTER COLUMN must_change_password SET DEFAULT TRUE,
  ALTER COLUMN must_change_password SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN version SET DEFAULT 1,
  ALTER COLUMN version SET NOT NULL;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_status_check,
  DROP CONSTRAINT IF EXISTS profiles_status_active_consistency_check,
  DROP CONSTRAINT IF EXISTS profiles_version_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_status_check
  CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'LOCKED', 'DEACTIVATED')),
  ADD CONSTRAINT profiles_status_active_consistency_check
  CHECK (
    (status = 'ACTIVE' AND is_active)
    OR (
      status IN ('PENDING', 'SUSPENDED', 'LOCKED', 'DEACTIVATED')
      AND NOT is_active
    )
  ),
  ADD CONSTRAINT profiles_version_check
  CHECK (version >= 1);

CREATE INDEX IF NOT EXISTS profiles_status_idx
ON public.profiles(status);

CREATE INDEX IF NOT EXISTS profiles_created_by_idx
ON public.profiles(created_by);

CREATE OR REPLACE FUNCTION public.create_admin_user_profile_v1(
  p_user_id UUID,
  p_first_name TEXT,
  p_last_name TEXT,
  p_role TEXT,
  p_is_active BOOLEAN,
  p_created_by UUID,
  p_canonical_role TEXT,
  p_request_id TEXT,
  p_created_at TIMESTAMPTZ
)
RETURNS SETOF public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_auth_email TEXT;
  v_status TEXT;
BEGIN
  IF p_canonical_role <> 'System Administrator' THEN
    RAISE EXCEPTION 'Canonical System Administrator role is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_first_name IS NULL OR BTRIM(p_first_name) = ''
    OR CHAR_LENGTH(BTRIM(p_first_name)) > 80
    OR p_last_name IS NULL OR BTRIM(p_last_name) = ''
    OR CHAR_LENGTH(BTRIM(p_last_name)) > 80
  THEN
    RAISE EXCEPTION 'A valid first and last name are required'
      USING ERRCODE = '22023';
  END IF;

  IF p_role NOT IN (
    'Operations Officer',
    'Control Center Operator',
    'Customs Supervisor',
    'Airport Administrator',
    'System Administrator'
  ) THEN
    RAISE EXCEPTION 'A valid canonical role is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_created_by IS NULL
    OR p_request_id IS NULL OR BTRIM(p_request_id) = ''
    OR p_created_at IS NULL
  THEN
    RAISE EXCEPTION 'Actor, request, and timestamp are required'
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

  v_status := CASE WHEN p_is_active THEN 'ACTIVE' ELSE 'PENDING' END;

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
    v_status,
    p_is_active,
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
  VALUES
  (
    'USER_PROFILE_CREATED',
    'USER',
    p_created_by::TEXT,
    p_canonical_role,
    'BELTRAK_ADMIN',
    'SUCCESS',
    BTRIM(p_request_id),
    JSONB_BUILD_OBJECT(
      'targetUserId', p_user_id,
      'targetEmail', BTRIM(v_auth_email),
      'assignedRole', p_role,
      'status', v_status
    ),
    p_created_at
  ),
  (
    'USER_CREATED',
    'USER',
    p_created_by::TEXT,
    p_canonical_role,
    'BELTRAK_ADMIN',
    'SUCCESS',
    BTRIM(p_request_id),
    JSONB_BUILD_OBJECT(
      'targetUserId', p_user_id,
      'targetEmail', BTRIM(v_auth_email),
      'assignedRole', p_role,
      'status', v_status
    ),
    p_created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_admin_user_profile_v1(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  BOOLEAN,
  UUID,
  TEXT,
  TEXT,
  TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_admin_user_profile_v1(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  BOOLEAN,
  UUID,
  TEXT,
  TEXT,
  TIMESTAMPTZ
) TO service_role;
