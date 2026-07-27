-- Repairs the required one-to-one auth.users/public.profiles identity and
-- records the repair audit in the same database transaction.

CREATE OR REPLACE FUNCTION public.repair_user_profile_v1(
  p_user_id UUID,
  p_first_name TEXT,
  p_last_name TEXT,
  p_role TEXT,
  p_actor_id TEXT,
  p_canonical_role TEXT,
  p_request_id TEXT
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

  IF p_actor_id IS NULL OR BTRIM(p_actor_id) = ''
    OR p_request_id IS NULL OR BTRIM(p_request_id) = ''
  THEN
    RAISE EXCEPTION 'Actor and request identifiers are required'
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
    SELECT 1
    FROM public.profiles
    WHERE id = p_user_id
  )
  INTO v_profile_existed;

  RETURN QUERY
  INSERT INTO public.profiles (
    id,
    first_name,
    last_name,
    email,
    role,
    is_active
  )
  VALUES (
    p_user_id,
    BTRIM(p_first_name),
    BTRIM(p_last_name),
    BTRIM(v_auth_email),
    p_role,
    TRUE
  )
  ON CONFLICT (id) DO UPDATE
  SET
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    email = EXCLUDED.email,
    role = EXCLUDED.role
  RETURNING public.profiles.*;

  INSERT INTO public.audit_events (
    action,
    actor_type,
    actor_id,
    canonical_role,
    source_system,
    outcome,
    request_id,
    metadata
  )
  VALUES (
    'USER_PROFILE_REPAIRED',
    'USER',
    BTRIM(p_actor_id),
    p_canonical_role,
    'BELTRAK_ADMIN',
    'SUCCESS',
    BTRIM(p_request_id),
    JSONB_BUILD_OBJECT(
      'targetUserId', p_user_id,
      'profileCreated', NOT v_profile_existed,
      'role', p_role
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.repair_user_profile_v1(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.repair_user_profile_v1(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT
) TO service_role;
