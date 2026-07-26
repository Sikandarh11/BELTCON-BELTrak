-- Authoritative RFID tag assignment for the Tagging Station.
--
-- The application calls this function through the server-side service-role
-- client. Bag transition and durable audit insertion happen in one database
-- transaction; browser clients never write the bag directly.

DO $$
BEGIN
  IF EXISTS (
    SELECT UPPER(BTRIM(epc))
    FROM public.bags
    WHERE epc IS NOT NULL
      AND BTRIM(epc) <> ''
    GROUP BY UPPER(BTRIM(epc))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Case-insensitive duplicate EPC values prevent normalized EPC uniqueness'
      USING HINT = 'Review with: SELECT UPPER(BTRIM(epc)), array_agg(id) FROM public.bags WHERE epc IS NOT NULL AND BTRIM(epc) <> '''' GROUP BY UPPER(BTRIM(epc)) HAVING COUNT(*) > 1;';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bags_epc_normalized_unique
ON public.bags((UPPER(BTRIM(epc))))
WHERE epc IS NOT NULL
  AND BTRIM(epc) <> '';

CREATE INDEX IF NOT EXISTS idx_bags_pending_tagging_flagged_at
ON public.bags(flagged_at ASC, id ASC)
WHERE status = 'IDENTIFIED';

CREATE OR REPLACE FUNCTION public.encode_bag_tag_v1(
  p_bag_id TEXT,
  p_epc TEXT,
  p_actor_id TEXT,
  p_canonical_role TEXT,
  p_request_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_bag_id TEXT := NULLIF(BTRIM(p_bag_id), '');
  v_normalized_epc TEXT := UPPER(BTRIM(COALESCE(p_epc, '')));
  v_constraint_name TEXT;
  v_bag public.bags%ROWTYPE;
BEGIN
  IF v_bag_id IS NULL THEN
    RETURN JSONB_BUILD_OBJECT(
      'status', 'INVALID_BAG_ID',
      'errorMessage', 'Bag ID is required'
    );
  END IF;

  IF v_normalized_epc = ''
    OR LENGTH(v_normalized_epc) > 128
    OR v_normalized_epc !~ '^[A-Z0-9][A-Z0-9._:-]*$'
  THEN
    RETURN JSONB_BUILD_OBJECT(
      'status', 'INVALID_EPC',
      'errorMessage', 'EPC contains unsupported characters'
    );
  END IF;

  -- Serialize both the bag lifecycle and normalized EPC identity. The unique
  -- expression index remains the final database-level collision guard.
  PERFORM PG_ADVISORY_XACT_LOCK(
    HASHTEXTEXTENDED('tagging:bag:' || v_bag_id, 0)
  );
  PERFORM PG_ADVISORY_XACT_LOCK(
    HASHTEXTEXTENDED('tagging:epc:' || v_normalized_epc, 0)
  );

  SELECT *
  INTO v_bag
  FROM public.bags
  WHERE id = v_bag_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN JSONB_BUILD_OBJECT(
      'status', 'BAG_NOT_FOUND',
      'errorMessage', 'Bag was not found'
    );
  END IF;

  IF v_bag.status <> 'IDENTIFIED' OR v_bag.epc IS NOT NULL THEN
    RETURN JSONB_BUILD_OBJECT(
      'status', 'ALREADY_TAGGED',
      'bagStatus', v_bag.status,
      'errorMessage', 'Bag is no longer pending RFID encoding'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bags
    WHERE id <> v_bag_id
      AND epc IS NOT NULL
      AND UPPER(BTRIM(epc)) = v_normalized_epc
  ) THEN
    RETURN JSONB_BUILD_OBJECT(
      'status', 'DUPLICATE_EPC',
      'errorMessage', 'EPC is already assigned to another bag'
    );
  END IF;

  UPDATE public.bags
  SET
    epc = v_normalized_epc,
    status = 'TAGGED',
    tagged_at = v_now,
    updated_at = v_now
  WHERE id = v_bag_id
    AND status = 'IDENTIFIED'
    AND epc IS NULL
  RETURNING * INTO v_bag;

  IF NOT FOUND THEN
    RETURN JSONB_BUILD_OBJECT(
      'status', 'ALREADY_TAGGED',
      'errorMessage', 'Bag was encoded by another request'
    );
  END IF;

  INSERT INTO public.audit_events (
    action,
    actor_type,
    actor_id,
    canonical_role,
    bag_id,
    source_system,
    outcome,
    request_id,
    metadata
  )
  VALUES (
    'TAG_ENCODED',
    'USER',
    NULLIF(BTRIM(p_actor_id), ''),
    NULLIF(BTRIM(p_canonical_role), ''),
    v_bag.id,
    v_bag.source_system,
    'SUCCESS',
    NULLIF(BTRIM(p_request_id), ''),
    JSONB_BUILD_OBJECT(
      'epc', v_normalized_epc,
      'taggedAt', v_bag.tagged_at
    )
  );

  RETURN JSONB_BUILD_OBJECT(
    'status', 'ENCODED',
    'bag', TO_JSONB(v_bag)
  );

EXCEPTION
  WHEN UNIQUE_VIOLATION THEN
    GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
    IF v_constraint_name IN (
      'idx_bags_epc_unique',
      'idx_bags_epc_normalized_unique'
    ) THEN
      RETURN JSONB_BUILD_OBJECT(
        'status', 'DUPLICATE_EPC',
        'errorMessage', 'EPC is already assigned to another bag'
      );
    END IF;
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.encode_bag_tag_v1(TEXT, TEXT, TEXT, TEXT, TEXT)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.encode_bag_tag_v1(TEXT, TEXT, TEXT, TEXT, TEXT)
TO service_role;
