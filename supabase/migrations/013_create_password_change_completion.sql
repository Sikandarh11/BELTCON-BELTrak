-- Completes the database half of a password change only after Supabase Auth
-- has accepted the new password. The profile update and audit are atomic.

CREATE OR REPLACE FUNCTION public.complete_password_change_v1(
  p_user_id UUID,
  p_actor_id UUID,
  p_canonical_role TEXT,
  p_request_id TEXT,
  p_changed_at TIMESTAMPTZ,
  p_other_sessions_revoked BOOLEAN
)
RETURNS SETOF public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_profile_role TEXT;
BEGIN
  IF p_user_id IS NULL
    OR p_actor_id IS NULL
    OR p_user_id <> p_actor_id
    OR p_request_id IS NULL
    OR BTRIM(p_request_id) = ''
    OR p_changed_at IS NULL
    OR p_other_sessions_revoked IS NULL
  THEN
    RAISE EXCEPTION 'Valid password-change context is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT role
  INTO v_profile_role
  FROM public.profiles
  WHERE id = p_user_id
    AND status = 'ACTIVE'
    AND is_active = TRUE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Eligible BELTrak profile was not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_canonical_role IS NULL
    OR p_canonical_role <> v_profile_role
  THEN
    RAISE EXCEPTION 'Canonical role does not match the profile'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  UPDATE public.profiles
  SET
    must_change_password = FALSE,
    updated_at = p_changed_at,
    version = version + 1
  WHERE id = p_user_id
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
    'PASSWORD_CHANGED',
    'USER',
    p_actor_id::TEXT,
    p_canonical_role,
    'BELTRAK_AUTH',
    'SUCCESS',
    BTRIM(p_request_id),
    JSONB_BUILD_OBJECT(
      'targetUserId', p_user_id,
      'otherSessionsRevoked', p_other_sessions_revoked
    ),
    p_changed_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_password_change_v1(
  UUID,
  UUID,
  TEXT,
  TEXT,
  TIMESTAMPTZ,
  BOOLEAN
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.complete_password_change_v1(
  UUID,
  UUID,
  TEXT,
  TEXT,
  TIMESTAMPTZ,
  BOOLEAN
) TO service_role;
