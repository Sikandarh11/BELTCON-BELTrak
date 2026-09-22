-- SBTS Phase 3: complete software-only Tagging Station workflow.
--
-- This is a forward-only extension of the Phase 2 tagging association. It
-- deliberately does not claim a physical printer, encoder, RFID reader,
-- camera, conveyor, or supplier-specific EPC layout.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO public.permissions(code,name,description,category,risk_level)
VALUES
  ('tagging.session.start','Start tagging sessions','Start or resume a server-controlled session for the active station bag.','Tagging','HIGH'),
  ('tagging.tag.capture','Capture RFID tag identity','Capture a supplier barcode and expected EPC through a trusted station path.','Tagging','HIGH'),
  ('tagging.encode','Encode RFID tags','Run a configured software or physical encoder adapter.','Tagging','HIGH'),
  ('tagging.verify','Verify RFID tags','Record trusted verify-after-write evidence.','Tagging','HIGH'),
  ('tagging.photo.capture','Capture bag photos','Capture and stage validated bag-photo evidence.','Tagging','HIGH'),
  ('tagging.commit','Commit tag assignments','Atomically commit a verified tag assignment.','Tagging','CRITICAL'),
  ('tagging.cancel','Cancel tagging sessions','Cancel an incomplete tagging session with an audit reason.','Tagging','HIGH'),
  ('tagging.replace','Replace RFID tags','Replace an active or failed tag while preserving history.','Tagging','CRITICAL'),
  ('tagging.override.photo','Override required bag photo','Authorize a reasoned missing-photo continuity override.','Tagging','CRITICAL'),
  ('tagging.manual-entry','Enter tag identity manually','Use controlled manual barcode or EPC entry.','Tagging','HIGH'),
  ('tagging.inventory.import','Import RFID inventory','Validate and import supplier tag inventory.','Tagging','CRITICAL'),
  ('tagging.view.history','View tagging history','View sessions, attempts, photos, and replacement history.','Tagging','MEDIUM'),
  ('tagging.metrics.view','View tagging metrics','View site/station-scoped tagging metrics.','Tagging','MEDIUM')
ON CONFLICT(code) DO UPDATE SET
  name=EXCLUDED.name,description=EXCLUDED.description,
  category=EXCLUDED.category,risk_level=EXCLUDED.risk_level;

WITH grants(role_code,permission_code) AS (
  VALUES
    ('operations_officer','tagging.session.start'),
    ('operations_officer','tagging.tag.capture'),
    ('operations_officer','tagging.encode'),
    ('operations_officer','tagging.verify'),
    ('operations_officer','tagging.photo.capture'),
    ('operations_officer','tagging.commit'),
    ('operations_officer','tagging.cancel'),
    ('operations_officer','tagging.view.history'),
    ('customs_supervisor','tagging.session.start'),
    ('customs_supervisor','tagging.tag.capture'),
    ('customs_supervisor','tagging.encode'),
    ('customs_supervisor','tagging.verify'),
    ('customs_supervisor','tagging.photo.capture'),
    ('customs_supervisor','tagging.commit'),
    ('customs_supervisor','tagging.cancel'),
    ('customs_supervisor','tagging.replace'),
    ('customs_supervisor','tagging.override.photo'),
    ('customs_supervisor','tagging.manual-entry'),
    ('customs_supervisor','tagging.view.history'),
    ('customs_supervisor','tagging.metrics.view'),
    ('airport_administrator','tagging.session.start'),
    ('airport_administrator','tagging.tag.capture'),
    ('airport_administrator','tagging.encode'),
    ('airport_administrator','tagging.verify'),
    ('airport_administrator','tagging.photo.capture'),
    ('airport_administrator','tagging.commit'),
    ('airport_administrator','tagging.cancel'),
    ('airport_administrator','tagging.replace'),
    ('airport_administrator','tagging.override.photo'),
    ('airport_administrator','tagging.manual-entry'),
    ('airport_administrator','tagging.inventory.import'),
    ('airport_administrator','tagging.view.history'),
    ('airport_administrator','tagging.metrics.view'),
    ('system_administrator','tagging.session.start'),
    ('system_administrator','tagging.tag.capture'),
    ('system_administrator','tagging.encode'),
    ('system_administrator','tagging.verify'),
    ('system_administrator','tagging.photo.capture'),
    ('system_administrator','tagging.commit'),
    ('system_administrator','tagging.cancel'),
    ('system_administrator','tagging.replace'),
    ('system_administrator','tagging.override.photo'),
    ('system_administrator','tagging.manual-entry'),
    ('system_administrator','tagging.inventory.import'),
    ('system_administrator','tagging.view.history'),
    ('system_administrator','tagging.metrics.view')
)
INSERT INTO public.role_permissions(role_id,permission_id,granted)
SELECT roles.id,permissions.id,TRUE
FROM grants
JOIN public.roles ON roles.code=grants.role_code
JOIN public.permissions ON permissions.code=grants.permission_code
ON CONFLICT(role_id,permission_id) DO UPDATE SET granted=TRUE,updated_at=NOW();

CREATE TABLE public.tagging_station_configurations (
  site_id TEXT NOT NULL CHECK(site_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  station_id TEXT NOT NULL CHECK(station_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  allowed_line_ids TEXT[] NOT NULL CHECK(cardinality(allowed_line_ids)>0),
  provisioning_mode TEXT NOT NULL CHECK(provisioning_mode IN ('PRE_ENCODED_TAG','PRINT_AND_ENCODE')),
  photo_policy TEXT NOT NULL DEFAULT 'REQUIRED' CHECK(photo_policy IN ('REQUIRED','OPTIONAL','DISABLED')),
  verification_required_preencoded BOOLEAN NOT NULL DEFAULT TRUE,
  verification_stable_read_count INTEGER NOT NULL DEFAULT 3 CHECK(verification_stable_read_count BETWEEN 1 AND 100),
  epc_allowed_bit_lengths INTEGER[] NOT NULL DEFAULT ARRAY[96] CHECK(cardinality(epc_allowed_bit_lengths)>0),
  epc_canonical_case TEXT NOT NULL DEFAULT 'UPPER' CHECK(epc_canonical_case='UPPER'),
  manual_barcode_entry BOOLEAN NOT NULL DEFAULT FALSE,
  manual_epc_entry BOOLEAN NOT NULL DEFAULT FALSE,
  inventory_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  simulation_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  session_ttl_seconds INTEGER NOT NULL DEFAULT 1800 CHECK(session_ttl_seconds BETWEEN 60 AND 28800),
  photo_max_bytes INTEGER NOT NULL DEFAULT 10485760 CHECK(photo_max_bytes BETWEEN 1024 AND 52428800),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(site_id,station_id),
  CHECK(NOT simulation_enabled OR provisioning_mode IN ('PRE_ENCODED_TAG','PRINT_AND_ENCODE'))
);

CREATE TABLE public.tagging_station_queue_items (
  id UUID PRIMARY KEY,
  site_id TEXT NOT NULL,
  station_id TEXT NOT NULL,
  integration_event_id UUID NOT NULL REFERENCES public.screening_integration_events(id) ON DELETE RESTRICT,
  bag_id TEXT NOT NULL REFERENCES public.bags(id) ON DELETE RESTRICT,
  bhs_uid TEXT NOT NULL,
  line_id TEXT NOT NULL,
  evaluation TEXT NOT NULL CHECK(evaluation IN ('R','T','N','?')),
  position SMALLINT CHECK(position IN (1,2)),
  state TEXT NOT NULL CHECK(state IN (
    'ACTIVE','WAITING','TAGGING_IN_PROGRESS','TAGGED','DISPATCHED',
    'JAMMED','MANUALLY_CLEARED','CANCELLED','FAILED'
  )),
  local_version INTEGER NOT NULL DEFAULT 1 CHECK(local_version>=1),
  received_at TIMESTAMPTZ NOT NULL,
  synchronized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(site_id,station_id)
    REFERENCES public.tagging_station_configurations(site_id,station_id) ON DELETE RESTRICT,
  CHECK(
    (state IN ('ACTIVE','WAITING','TAGGING_IN_PROGRESS','JAMMED') AND position IS NOT NULL)
    OR (state IN ('TAGGED','DISPATCHED','MANUALLY_CLEARED','CANCELLED','FAILED') AND position IS NULL)
  )
);
CREATE UNIQUE INDEX tagging_station_queue_position_active_uq
ON public.tagging_station_queue_items(site_id,station_id,position)
WHERE position IS NOT NULL;
CREATE UNIQUE INDEX tagging_station_queue_bag_active_uq
ON public.tagging_station_queue_items(bag_id)
WHERE position IS NOT NULL;

ALTER TABLE public.tags DROP CONSTRAINT IF EXISTS tags_bag_id_key;
ALTER TABLE public.tags ALTER COLUMN bag_id DROP NOT NULL;
ALTER TABLE public.tags
  ADD COLUMN status TEXT NOT NULL DEFAULT 'ASSIGNED'
    CHECK(status IN ('AVAILABLE','RESERVED','VERIFIED','ASSIGNED','FAILED','VOIDED','REPLACED','LOST','EXPIRED')),
  ADD COLUMN site_id TEXT,
  ADD COLUMN station_id TEXT,
  ADD COLUMN supplier TEXT,
  ADD COLUMN batch_number TEXT,
  ADD COLUMN received_at TIMESTAMPTZ,
  ADD COLUMN failure_code TEXT,
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX idx_tags_inventory_status ON public.tags(site_id,station_id,status,created_at);

CREATE TABLE public.bag_tag_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bag_id TEXT NOT NULL REFERENCES public.bags(id) ON DELETE RESTRICT,
  tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE RESTRICT,
  assignment_version INTEGER NOT NULL CHECK(assignment_version>=1),
  assignment_status TEXT NOT NULL CHECK(assignment_status IN ('ACTIVE','REPLACED','ENDED')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by TEXT NOT NULL,
  site_id TEXT NOT NULL,
  station_id TEXT NOT NULL,
  tagging_session_id UUID,
  replaced_assignment_id UUID REFERENCES public.bag_tag_assignments(id) ON DELETE RESTRICT,
  ended_at TIMESTAMPTZ,
  end_reason TEXT,
  commit_request_id TEXT NOT NULL,
  commit_payload_hash TEXT NOT NULL CHECK(commit_payload_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(id IS DISTINCT FROM replaced_assignment_id),
  CHECK(
    (assignment_status='ACTIVE' AND ended_at IS NULL AND end_reason IS NULL)
    OR (assignment_status<>'ACTIVE' AND ended_at IS NOT NULL AND NULLIF(BTRIM(end_reason),'') IS NOT NULL)
  ),
  UNIQUE(site_id,station_id,commit_request_id)
);
CREATE UNIQUE INDEX bag_tag_assignments_active_bag_uq
ON public.bag_tag_assignments(bag_id) WHERE assignment_status='ACTIVE';
CREATE UNIQUE INDEX bag_tag_assignments_active_tag_uq
ON public.bag_tag_assignments(tag_id) WHERE assignment_status='ACTIVE';
CREATE INDEX idx_bag_tag_assignments_history
ON public.bag_tag_assignments(bag_id,assignment_version DESC,assigned_at DESC);

INSERT INTO public.bag_tag_assignments(
  bag_id,tag_id,assignment_version,assignment_status,assigned_at,assigned_by,
  site_id,station_id,commit_request_id,commit_payload_hash
)
SELECT tags.bag_id,tags.id,1,'ACTIVE',tags.assigned_at,
       COALESCE(tags.assigned_by,'migration-027'),'LEGACY','LEGACY',
       COALESCE(tags.request_id,'migration-027-'||tags.id::TEXT),
      encode(extensions.digest('migration-027:'||tags.id::TEXT,'sha256'),'hex')
FROM public.tags
WHERE tags.bag_id IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE TABLE public.tagging_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id TEXT NOT NULL,
  station_id TEXT NOT NULL,
  queue_item_id UUID NOT NULL REFERENCES public.tagging_station_queue_items(id) ON DELETE RESTRICT,
  bag_id TEXT NOT NULL REFERENCES public.bags(id) ON DELETE RESTRICT,
  bhs_uid TEXT NOT NULL,
  line_id TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  operator_role TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN (
    'CREATED','VALIDATING_BAG','READY_FOR_INPUT','TAG_CAPTURED','ENCODE_PENDING',
    'ENCODING','ENCODED','VERIFY_PENDING','VERIFYING','VERIFIED','PHOTO_PENDING',
    'PHOTO_CAPTURED','READY_TO_COMMIT','COMMITTING','COMMITTED','FAILED','CANCELLED','EXPIRED'
  )),
  provisioning_mode TEXT NOT NULL CHECK(provisioning_mode IN ('PRE_ENCODED_TAG','PRINT_AND_ENCODE')),
  configuration_version INTEGER NOT NULL,
  rfid_tag_barcode TEXT,
  expected_epc TEXT,
  verified_epc TEXT,
  iata_lpc TEXT CHECK(iata_lpc IS NULL OR iata_lpc ~ '^\d{10}$'),
  photo_policy TEXT NOT NULL CHECK(photo_policy IN ('REQUIRED','OPTIONAL','DISABLED')),
  photo_status TEXT NOT NULL DEFAULT 'NOT_CAPTURED'
    CHECK(photo_status IN ('NOT_CAPTURED','STAGED','CAPTURED','MISSING_OVERRIDE','FAILED')),
  photo_override_reason TEXT,
  verification_required BOOLEAN NOT NULL,
  required_stable_read_count INTEGER NOT NULL CHECK(required_stable_read_count BETWEEN 1 AND 100),
  failure_code TEXT,
  failure_detail TEXT,
  replacement_of_assignment_id UUID REFERENCES public.bag_tag_assignments(id) ON DELETE RESTRICT,
  create_request_id TEXT NOT NULL,
  create_payload_hash TEXT NOT NULL CHECK(create_payload_hash ~ '^[0-9a-f]{64}$'),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  is_simulated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  committed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  FOREIGN KEY(site_id,station_id)
    REFERENCES public.tagging_station_configurations(site_id,station_id) ON DELETE RESTRICT,
  UNIQUE(site_id,station_id,create_request_id),
  CHECK(bhs_uid=btrim(bhs_uid) AND char_length(bhs_uid)=10 AND octet_length(bhs_uid)=10),
  CHECK((state='COMMITTED')=(committed_at IS NOT NULL)),
  CHECK((state='CANCELLED')=(cancelled_at IS NOT NULL))
);
CREATE UNIQUE INDEX tagging_sessions_active_bag_uq ON public.tagging_sessions(bag_id)
WHERE state NOT IN ('COMMITTED','CANCELLED','EXPIRED');
CREATE UNIQUE INDEX tagging_sessions_active_queue_uq ON public.tagging_sessions(queue_item_id)
WHERE state NOT IN ('COMMITTED','CANCELLED','EXPIRED');
CREATE INDEX idx_tagging_sessions_station_state
ON public.tagging_sessions(site_id,station_id,state,updated_at DESC);

ALTER TABLE public.bag_tag_assignments
  ADD CONSTRAINT bag_tag_assignments_session_fk
  FOREIGN KEY(tagging_session_id) REFERENCES public.tagging_sessions(id) ON DELETE RESTRICT;

CREATE TABLE public.tagging_operation_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.tagging_sessions(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL,
  request_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
  response JSONB NOT NULL CHECK(jsonb_typeof(response)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(operation,request_id)
);

CREATE TABLE public.epc_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL UNIQUE REFERENCES public.tagging_sessions(id) ON DELETE RESTRICT,
  epc TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('RESERVED','ENCODING','ENCODED','VERIFIED','ASSIGNED','RELEASED','EXPIRED','FAILED','VOIDED')),
  request_id TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX epc_reservations_epc_no_reuse_uq
ON public.epc_reservations(UPPER(BTRIM(epc)));

CREATE TABLE public.tag_provisioning_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.tagging_sessions(id) ON DELETE RESTRICT,
  reservation_id UUID NOT NULL REFERENCES public.epc_reservations(id) ON DELETE RESTRICT,
  station_id TEXT NOT NULL,
  logical_device_id TEXT NOT NULL,
  rfid_tag_barcode TEXT,
  epc TEXT NOT NULL,
  label_template_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('PENDING','ENCODING','SUCCEEDED','FAILED','TIMED_OUT','CANCELLED','AMBIGUOUS')),
  failure_code TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count>=0),
  request_id TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  sanitized_result JSONB NOT NULL DEFAULT '{}'::JSONB CHECK(jsonb_typeof(sanitized_result)='object')
);

CREATE TABLE public.tag_verification_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.tagging_sessions(id) ON DELETE RESTRICT,
  station_id TEXT NOT NULL,
  logical_device_id TEXT NOT NULL,
  expected_epc TEXT NOT NULL,
  observed_epcs JSONB NOT NULL CHECK(jsonb_typeof(observed_epcs)='array'),
  stable_read_count INTEGER NOT NULL DEFAULT 0 CHECK(stable_read_count>=0),
  result TEXT NOT NULL CHECK(result IN (
    'VERIFIED','NO_TAG','EPC_MISMATCH','MULTIPLE_TAGS','UNSTABLE_READ',
    'DEVICE_UNAVAILABLE','TIMED_OUT','CANCELLED'
  )),
  failure_code TEXT,
  request_id TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
  is_simulated BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.bag_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bag_id TEXT NOT NULL REFERENCES public.bags(id) ON DELETE RESTRICT,
  bhs_uid TEXT NOT NULL,
  tagging_session_id UUID NOT NULL REFERENCES public.tagging_sessions(id) ON DELETE RESTRICT,
  site_id TEXT NOT NULL,
  station_id TEXT NOT NULL,
  captured_by TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  original_mime_type TEXT NOT NULL CHECK(original_mime_type IN ('image/jpeg','image/png')),
  stored_mime_type TEXT NOT NULL CHECK(stored_mime_type IN ('image/jpeg','image/png')),
  width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 20000),
  height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 20000),
  file_size INTEGER NOT NULL CHECK(file_size>0),
  checksum_sha256 TEXT NOT NULL CHECK(checksum_sha256 ~ '^[0-9a-f]{64}$'),
  storage_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('STAGED','ACTIVE','REPLACED','ABANDONED','FAILED')),
  replacement_reason TEXT,
  request_id TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  is_simulated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(storage_key !~ '(^|/)\.\.(/|$)' AND storage_key !~ '^[A-Za-z][A-Za-z0-9+.-]*://')
);
CREATE UNIQUE INDEX bag_photos_one_staged_uq
ON public.bag_photos(tagging_session_id) WHERE status='STAGED';
CREATE UNIQUE INDEX bag_photos_one_active_uq
ON public.bag_photos(tagging_session_id) WHERE status='ACTIVE';
CREATE INDEX idx_bag_photos_bag_history ON public.bag_photos(bag_id,captured_at DESC);

CREATE TABLE public.tagging_session_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.tagging_sessions(id) ON DELETE RESTRICT,
  bag_id TEXT NOT NULL REFERENCES public.bags(id) ON DELETE RESTRICT,
  site_id TEXT NOT NULL,
  station_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  result TEXT NOT NULL,
  previous_state TEXT,
  next_state TEXT,
  failure_code TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB CHECK(jsonb_typeof(metadata)='object'),
  is_simulated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tagging_session_events_session
ON public.tagging_session_events(session_id,created_at,id);

ALTER TABLE public.tagging_station_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tagging_station_queue_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bag_tag_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tagging_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tagging_operation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.epc_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tag_provisioning_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tag_verification_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bag_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tagging_session_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.tagging_station_configurations FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.tagging_station_queue_items FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.bag_tag_assignments FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.tagging_sessions FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.tagging_operation_requests FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.epc_reservations FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.tag_provisioning_jobs FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.tag_verification_attempts FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.bag_photos FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.tagging_session_events FROM PUBLIC,anon,authenticated;

GRANT SELECT ON public.tagging_station_configurations TO service_role;
GRANT SELECT ON public.tagging_station_queue_items TO service_role;
GRANT SELECT ON public.bag_tag_assignments TO service_role;
GRANT SELECT ON public.tagging_sessions TO service_role;
GRANT SELECT ON public.epc_reservations TO service_role;
GRANT SELECT ON public.tag_provisioning_jobs TO service_role;
GRANT SELECT ON public.tag_verification_attempts TO service_role;
GRANT SELECT ON public.bag_photos TO service_role;
GRANT SELECT ON public.tagging_session_events TO service_role;

CREATE OR REPLACE FUNCTION public.reject_tagging_history_mutation_v1()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Tagging history is append-only' USING ERRCODE='42501';
END;
$$;
CREATE TRIGGER tagging_session_events_append_only
BEFORE UPDATE OR DELETE ON public.tagging_session_events
FOR EACH ROW EXECUTE FUNCTION public.reject_tagging_history_mutation_v1();
CREATE TRIGGER tag_verification_attempts_append_only
BEFORE UPDATE OR DELETE ON public.tag_verification_attempts
FOR EACH ROW EXECUTE FUNCTION public.reject_tagging_history_mutation_v1();

CREATE OR REPLACE FUNCTION public.enforce_tagging_session_transition_v1()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.bag_id IS DISTINCT FROM OLD.bag_id
    OR NEW.bhs_uid IS DISTINCT FROM OLD.bhs_uid
    OR NEW.queue_item_id IS DISTINCT FROM OLD.queue_item_id
    OR NEW.site_id IS DISTINCT FROM OLD.site_id
    OR NEW.station_id IS DISTINCT FROM OLD.station_id
    OR NEW.provisioning_mode IS DISTINCT FROM OLD.provisioning_mode
    OR NEW.operator_id IS DISTINCT FROM OLD.operator_id
    OR NEW.replacement_of_assignment_id IS DISTINCT FROM OLD.replacement_of_assignment_id
  THEN
    RAISE EXCEPTION 'Tagging session identity is immutable'
      USING ERRCODE='23514',CONSTRAINT='tagging_session_identity_immutable';
  END IF;
  IF NEW.state=OLD.state THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.state='CREATED' AND NEW.state IN ('VALIDATING_BAG','READY_FOR_INPUT','FAILED','CANCELLED','EXPIRED')) OR
    (OLD.state='VALIDATING_BAG' AND NEW.state IN ('READY_FOR_INPUT','FAILED','CANCELLED','EXPIRED')) OR
    (OLD.state='READY_FOR_INPUT' AND NEW.state IN ('TAG_CAPTURED','ENCODE_PENDING','VERIFY_PENDING','FAILED','CANCELLED','EXPIRED')) OR
    (OLD.state='TAG_CAPTURED' AND NEW.state IN ('ENCODE_PENDING','VERIFY_PENDING','FAILED','CANCELLED','EXPIRED')) OR
    (OLD.state='ENCODE_PENDING' AND NEW.state IN ('ENCODING','FAILED','CANCELLED','EXPIRED')) OR
    (OLD.state='ENCODING' AND NEW.state IN ('ENCODED','FAILED','CANCELLED')) OR
    (OLD.state='ENCODED' AND NEW.state IN ('VERIFY_PENDING','VERIFYING','FAILED','CANCELLED','EXPIRED')) OR
    (OLD.state='VERIFY_PENDING' AND NEW.state IN ('VERIFYING','FAILED','CANCELLED','EXPIRED')) OR
    (OLD.state='VERIFYING' AND NEW.state IN ('VERIFIED','FAILED','CANCELLED')) OR
    (OLD.state='VERIFIED' AND NEW.state IN ('PHOTO_PENDING','PHOTO_CAPTURED','READY_TO_COMMIT','COMMITTING','FAILED','CANCELLED','EXPIRED')) OR
    (OLD.state='PHOTO_PENDING' AND NEW.state IN ('PHOTO_CAPTURED','READY_TO_COMMIT','FAILED','CANCELLED','EXPIRED')) OR
    (OLD.state='PHOTO_CAPTURED' AND NEW.state IN ('READY_TO_COMMIT','COMMITTING','FAILED','CANCELLED','EXPIRED')) OR
    (OLD.state='READY_TO_COMMIT' AND NEW.state IN ('COMMITTING','FAILED','CANCELLED','EXPIRED')) OR
    (OLD.state='COMMITTING' AND NEW.state IN ('COMMITTED','FAILED')) OR
    (OLD.state='FAILED' AND NEW.state IN ('READY_FOR_INPUT','CANCELLED','EXPIRED'))
  ) THEN
    RAISE EXCEPTION 'Invalid tagging session transition % -> %',OLD.state,NEW.state
      USING ERRCODE='23514',CONSTRAINT='tagging_session_transition_invalid';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enforce_tagging_session_transition_v1
BEFORE UPDATE ON public.tagging_sessions
FOR EACH ROW EXECUTE FUNCTION public.enforce_tagging_session_transition_v1();

CREATE OR REPLACE FUNCTION public.enforce_bag_tag_assignment_history_v1()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.bag_id IS DISTINCT FROM OLD.bag_id
    OR NEW.tag_id IS DISTINCT FROM OLD.tag_id
    OR NEW.assignment_version IS DISTINCT FROM OLD.assignment_version
    OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at
    OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by
    OR NEW.site_id IS DISTINCT FROM OLD.site_id
    OR NEW.station_id IS DISTINCT FROM OLD.station_id
    OR NEW.tagging_session_id IS DISTINCT FROM OLD.tagging_session_id
    OR NEW.replaced_assignment_id IS DISTINCT FROM OLD.replaced_assignment_id
  THEN RAISE EXCEPTION 'Tag assignment history is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.assignment_status<>'ACTIVE'
    OR NEW.assignment_status NOT IN ('REPLACED','ENDED')
    OR NEW.ended_at IS NULL OR NULLIF(BTRIM(NEW.end_reason),'') IS NULL
  THEN RAISE EXCEPTION 'Invalid tag assignment end transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enforce_bag_tag_assignment_history_v1
BEFORE UPDATE ON public.bag_tag_assignments
FOR EACH ROW EXECUTE FUNCTION public.enforce_bag_tag_assignment_history_v1();

CREATE OR REPLACE FUNCTION public.tagging_operation_replay_v1(
  p_operation TEXT,p_request_id TEXT,p_payload_hash TEXT
) RETURNS JSONB LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE v_request public.tagging_operation_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request FROM public.tagging_operation_requests
  WHERE operation=p_operation AND request_id=p_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_request.payload_hash IS DISTINCT FROM p_payload_hash THEN
    RETURN jsonb_build_object('status','IDEMPOTENCY_CONFLICT','errorCode','IDEMPOTENCY_PAYLOAD_CONFLICT');
  END IF;
  RETURN v_request.response;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_tagging_session_event_v1(
  p_session public.tagging_sessions,p_action TEXT,p_result TEXT,p_previous_state TEXT,
  p_actor_id TEXT,p_failure_code TEXT DEFAULT NULL,p_metadata JSONB DEFAULT '{}'::JSONB
) RETURNS VOID LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  INSERT INTO public.tagging_session_events(
    session_id,bag_id,site_id,station_id,actor_id,action,result,
    previous_state,next_state,failure_code,metadata,is_simulated
  ) VALUES (
    p_session.id,p_session.bag_id,p_session.site_id,p_session.station_id,
    p_actor_id,p_action,p_result,p_previous_state,p_session.state,
    p_failure_code,COALESCE(p_metadata,'{}'::JSONB),p_session.is_simulated
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.configure_tagging_station_v1(
  p_site_id TEXT,p_station_id TEXT,p_allowed_line_ids TEXT[],
  p_provisioning_mode TEXT,p_photo_policy TEXT,
  p_verification_required_preencoded BOOLEAN,p_stable_read_count INTEGER,
  p_epc_allowed_bit_lengths INTEGER[],p_manual_barcode_entry BOOLEAN,
  p_manual_epc_entry BOOLEAN,p_inventory_enabled BOOLEAN,p_simulation_enabled BOOLEAN,
  p_session_ttl_seconds INTEGER,p_photo_max_bytes INTEGER,
  p_actor_id TEXT,p_request_id TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_config public.tagging_station_configurations%ROWTYPE;
BEGIN
  IF p_site_id !~ '^[A-Za-z0-9._:-]{1,64}$'
    OR p_station_id !~ '^[A-Za-z0-9._:-]{1,64}$'
    OR cardinality(p_allowed_line_ids)<1
    OR EXISTS(SELECT 1 FROM unnest(p_allowed_line_ids) line_id WHERE line_id !~ '^[ -~]{2}$' OR line_id<>btrim(line_id))
    OR p_provisioning_mode NOT IN ('PRE_ENCODED_TAG','PRINT_AND_ENCODE')
    OR p_photo_policy NOT IN ('REQUIRED','OPTIONAL','DISABLED')
    OR p_stable_read_count NOT BETWEEN 1 AND 100
    OR cardinality(p_epc_allowed_bit_lengths)<1
    OR EXISTS(SELECT 1 FROM unnest(p_epc_allowed_bit_lengths) bits WHERE bits<32 OR bits>512 OR bits%8<>0)
    OR p_session_ttl_seconds NOT BETWEEN 60 AND 28800
    OR p_photo_max_bytes NOT BETWEEN 1024 AND 52428800
  THEN RETURN jsonb_build_object('status','INVALID_CONFIGURATION'); END IF;
  INSERT INTO public.tagging_station_configurations(
    site_id,station_id,allowed_line_ids,provisioning_mode,photo_policy,
    verification_required_preencoded,verification_stable_read_count,
    epc_allowed_bit_lengths,manual_barcode_entry,manual_epc_entry,
    inventory_enabled,simulation_enabled,session_ttl_seconds,photo_max_bytes
  ) VALUES (
    p_site_id,p_station_id,p_allowed_line_ids,p_provisioning_mode,p_photo_policy,
    p_verification_required_preencoded,p_stable_read_count,p_epc_allowed_bit_lengths,
    p_manual_barcode_entry,p_manual_epc_entry,p_inventory_enabled,p_simulation_enabled,
    p_session_ttl_seconds,p_photo_max_bytes
  )
  ON CONFLICT(site_id,station_id) DO UPDATE SET
    allowed_line_ids=EXCLUDED.allowed_line_ids,
    provisioning_mode=EXCLUDED.provisioning_mode,
    photo_policy=EXCLUDED.photo_policy,
    verification_required_preencoded=EXCLUDED.verification_required_preencoded,
    verification_stable_read_count=EXCLUDED.verification_stable_read_count,
    epc_allowed_bit_lengths=EXCLUDED.epc_allowed_bit_lengths,
    manual_barcode_entry=EXCLUDED.manual_barcode_entry,
    manual_epc_entry=EXCLUDED.manual_epc_entry,
    inventory_enabled=EXCLUDED.inventory_enabled,
    simulation_enabled=EXCLUDED.simulation_enabled,
    session_ttl_seconds=EXCLUDED.session_ttl_seconds,
    photo_max_bytes=EXCLUDED.photo_max_bytes,
    version=tagging_station_configurations.version+1,updated_at=NOW()
  RETURNING * INTO v_config;
  INSERT INTO public.audit_events(action,actor_type,actor_id,source_system,outcome,request_id,metadata)
  VALUES('TAGGING_CONFIGURATION_CHANGED','USER',p_actor_id,'SBTS_TAGGING','SUCCESS',p_request_id,
    jsonb_build_object('siteId',p_site_id,'stationId',p_station_id,'configurationVersion',v_config.version));
  RETURN jsonb_build_object('status','CONFIGURED','configuration',to_jsonb(v_config));
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_tagging_station_queue_item_v1(
  p_queue_item_id UUID,p_site_id TEXT,p_station_id TEXT,p_bhs_uid TEXT,p_line_id TEXT,
  p_evaluation TEXT,p_position INTEGER,p_state TEXT,p_local_version INTEGER,
  p_received_at TIMESTAMPTZ,p_request_id TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_config public.tagging_station_configurations%ROWTYPE;
  v_bag public.bags%ROWTYPE;
  v_event public.screening_integration_events%ROWTYPE;
  v_existing public.tagging_station_queue_items%ROWTYPE;
  v_queue public.tagging_station_queue_items%ROWTYPE;
BEGIN
  SELECT * INTO v_config FROM public.tagging_station_configurations
  WHERE site_id=p_site_id AND station_id=p_station_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','STATION_NOT_CONFIGURED'); END IF;
  IF p_line_id<>ALL(v_config.allowed_line_ids) THEN
    RETURN jsonb_build_object('status','WRONG_LINE','errorCode','TAGGING_LINE_NOT_ASSIGNED');
  END IF;
  IF p_evaluation NOT IN ('R','T','N','?')
    OR p_position NOT IN (1,2)
    OR p_state NOT IN ('ACTIVE','WAITING','TAGGING_IN_PROGRESS','JAMMED')
    OR (p_position=2 AND p_state<>'WAITING')
  THEN RETURN jsonb_build_object('status','INVALID_QUEUE_STATE'); END IF;
  SELECT * INTO v_bag FROM public.bags
  WHERE bhs_uid=p_bhs_uid AND bhs_line_id=p_line_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','BAG_NOT_FOUND'); END IF;
  IF v_bag.screening_evaluation_raw IS DISTINCT FROM p_evaluation
    OR v_bag.screening_evaluation='ACCEPT'
  THEN RETURN jsonb_build_object('status','BAG_EVALUATION_CONFLICT'); END IF;
  SELECT * INTO v_event FROM public.screening_integration_events
  WHERE bag_id=v_bag.id AND event_type='BHS_MESSAGE'
    AND station_id=p_station_id AND site_id=p_site_id
    AND bhs_line_id=p_line_id AND screening_evaluation_raw=p_evaluation
    AND processing_status IN ('ACCEPTED','DUPLICATE')
  ORDER BY received_at DESC,id DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','STATION_DELIVERY_NOT_FOUND'); END IF;
  SELECT * INTO v_existing FROM public.tagging_station_queue_items
  WHERE id=p_queue_item_id FOR UPDATE;
  IF FOUND AND (
    v_existing.site_id IS DISTINCT FROM p_site_id
    OR v_existing.station_id IS DISTINCT FROM p_station_id
    OR v_existing.bag_id IS DISTINCT FROM v_bag.id
    OR v_existing.bhs_uid IS DISTINCT FROM p_bhs_uid
  ) THEN RETURN jsonb_build_object('status','QUEUE_BINDING_CONFLICT'); END IF;
  INSERT INTO public.tagging_station_queue_items(
    id,site_id,station_id,integration_event_id,bag_id,bhs_uid,line_id,evaluation,
    position,state,local_version,received_at
  ) VALUES (
    p_queue_item_id,p_site_id,p_station_id,v_event.id,v_bag.id,p_bhs_uid,p_line_id,
    p_evaluation,p_position,p_state,p_local_version,p_received_at
  )
  ON CONFLICT(id) DO UPDATE SET
    position=EXCLUDED.position,state=EXCLUDED.state,
    local_version=GREATEST(tagging_station_queue_items.local_version,EXCLUDED.local_version),
    synchronized_at=NOW(),updated_at=NOW()
  RETURNING * INTO v_queue;
  RETURN jsonb_build_object('status','SYNCHRONIZED','queueItem',to_jsonb(v_queue));
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('status','QUEUE_POSITION_CONFLICT');
END;
$$;

CREATE OR REPLACE FUNCTION public.create_tagging_session_v1(
  p_queue_item_id UUID,p_operator_id TEXT,p_operator_role TEXT,
  p_request_id TEXT,p_payload_hash TEXT,p_is_simulated BOOLEAN DEFAULT FALSE
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_queue public.tagging_station_queue_items%ROWTYPE;
  v_config public.tagging_station_configurations%ROWTYPE;
  v_bag public.bags%ROWTYPE;
  v_existing public.tagging_sessions%ROWTYPE;
  v_session public.tagging_sessions%ROWTYPE;
  v_result JSONB;
BEGIN
  IF NULLIF(BTRIM(p_request_id),'') IS NULL OR p_payload_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('status','INVALID_REQUEST');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('tagging:create:'||p_request_id,0));
  SELECT * INTO v_existing FROM public.tagging_sessions
  WHERE create_request_id=p_request_id;
  IF FOUND THEN
    IF v_existing.create_payload_hash IS DISTINCT FROM p_payload_hash THEN
      RETURN jsonb_build_object('status','IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN jsonb_build_object('status','DUPLICATE','session',to_jsonb(v_existing));
  END IF;
  SELECT * INTO v_queue FROM public.tagging_station_queue_items
  WHERE id=p_queue_item_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','QUEUE_ITEM_NOT_FOUND'); END IF;
  IF v_queue.position<>1 OR v_queue.state NOT IN ('ACTIVE','TAGGING_IN_PROGRESS') THEN
    RETURN jsonb_build_object('status','QUEUE_ITEM_NOT_ACTIVE');
  END IF;
  SELECT * INTO v_config FROM public.tagging_station_configurations
  WHERE site_id=v_queue.site_id AND station_id=v_queue.station_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','STATION_NOT_CONFIGURED'); END IF;
  IF p_is_simulated AND NOT v_config.simulation_enabled THEN
    RETURN jsonb_build_object('status','SIMULATOR_DISABLED');
  END IF;
  SELECT * INTO v_bag FROM public.bags WHERE id=v_queue.bag_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','BAG_NOT_FOUND'); END IF;
  IF v_bag.tagging_readiness_status<>'READY_FOR_TAGGING'
    OR v_bag.status<>'IDENTIFIED' OR v_bag.epc IS NOT NULL
    OR v_bag.rfid_tag_barcode IS NOT NULL OR v_bag.screening_evaluation='ACCEPT'
  THEN RETURN jsonb_build_object('status','BAG_NOT_READY'); END IF;
  SELECT * INTO v_existing FROM public.tagging_sessions
  WHERE (bag_id=v_bag.id OR queue_item_id=v_queue.id)
    AND state NOT IN ('COMMITTED','CANCELLED','EXPIRED') FOR UPDATE;
  IF FOUND THEN RETURN jsonb_build_object('status','ACTIVE_SESSION_EXISTS','session',to_jsonb(v_existing)); END IF;
  INSERT INTO public.tagging_sessions(
    site_id,station_id,queue_item_id,bag_id,bhs_uid,line_id,operator_id,operator_role,
    state,provisioning_mode,configuration_version,photo_policy,
    verification_required,required_stable_read_count,create_request_id,
    create_payload_hash,is_simulated,expires_at
  ) VALUES (
    v_queue.site_id,v_queue.station_id,v_queue.id,v_bag.id,v_bag.bhs_uid,v_queue.line_id,
    p_operator_id,p_operator_role,'READY_FOR_INPUT',v_config.provisioning_mode,
    v_config.version,v_config.photo_policy,
    CASE WHEN v_config.provisioning_mode='PRINT_AND_ENCODE' THEN TRUE
      ELSE v_config.verification_required_preencoded END,
    v_config.verification_stable_read_count,p_request_id,p_payload_hash,p_is_simulated,
    NOW()+make_interval(secs=>v_config.session_ttl_seconds)
  ) RETURNING * INTO v_session;
  UPDATE public.tagging_station_queue_items SET state='TAGGING_IN_PROGRESS',updated_at=NOW()
  WHERE id=v_queue.id;
  PERFORM public.record_tagging_session_event_v1(
    v_session,'TAGGING_SESSION_CREATED','SUCCESS',NULL,p_operator_id,NULL,
    jsonb_build_object('bhsUid',v_session.bhs_uid,'lineId',v_session.line_id,
      'provisioningMode',v_session.provisioning_mode,'photoPolicy',v_session.photo_policy)
  );
  INSERT INTO public.audit_events(action,actor_type,actor_id,canonical_role,bag_id,source_system,outcome,request_id,metadata)
  VALUES('TAGGING_SESSION_CREATED','USER',p_operator_id,p_operator_role,v_bag.id,'SBTS_TAGGING','SUCCESS',p_request_id,
    jsonb_build_object('sessionId',v_session.id,'stationId',v_session.station_id,'siteId',v_session.site_id,'bhsUid',v_session.bhs_uid,'simulated',v_session.is_simulated));
  RETURN jsonb_build_object('status','CREATED','session',to_jsonb(v_session));
EXCEPTION WHEN unique_violation THEN
  SELECT * INTO v_existing FROM public.tagging_sessions
  WHERE (bag_id=v_queue.bag_id OR queue_item_id=v_queue.id)
    AND state NOT IN ('COMMITTED','CANCELLED','EXPIRED') LIMIT 1;
  RETURN jsonb_build_object('status','ACTIVE_SESSION_EXISTS','session',CASE WHEN FOUND THEN to_jsonb(v_existing) ELSE NULL END);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_tagging_session_v1(
  p_session_id UUID,p_site_id TEXT,p_station_id TEXT,p_operator_id TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_session public.tagging_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_session FROM public.tagging_sessions WHERE id=p_session_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','NOT_FOUND'); END IF;
  IF v_session.site_id<>p_site_id OR v_session.station_id<>p_station_id THEN
    RETURN jsonb_build_object('status','STATION_BINDING_CONFLICT');
  END IF;
  IF v_session.operator_id<>p_operator_id AND v_session.state NOT IN ('COMMITTED','CANCELLED','EXPIRED') THEN
    RETURN jsonb_build_object('status','OPERATOR_BINDING_CONFLICT');
  END IF;
  RETURN jsonb_build_object('status','FOUND','session',to_jsonb(v_session));
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_tagging_identity_v1(
  p_session_id UUID,p_barcode TEXT,p_expected_epc TEXT,p_input_kind TEXT,p_reason TEXT,
  p_expected_version INTEGER,p_actor_id TEXT,p_request_id TEXT,p_payload_hash TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_session public.tagging_sessions%ROWTYPE;
  v_config public.tagging_station_configurations%ROWTYPE;
  v_barcode TEXT:=p_barcode;
  v_epc TEXT;
  v_bits INTEGER;
  v_previous TEXT;
  v_result JSONB;
  v_replay JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('tagging:operation:'||p_request_id,0));
  v_replay:=public.tagging_operation_replay_v1('CAPTURE_IDENTITY',p_request_id,p_payload_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_session FROM public.tagging_sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','SESSION_NOT_FOUND'); END IF;
  IF v_session.operator_id<>p_actor_id THEN RETURN jsonb_build_object('status','OPERATOR_BINDING_CONFLICT'); END IF;
  IF v_session.version<>p_expected_version THEN RETURN jsonb_build_object('status','VERSION_CONFLICT'); END IF;
  IF NOW()>=v_session.expires_at THEN
    UPDATE public.tagging_sessions SET state='EXPIRED',version=version+1,updated_at=NOW() WHERE id=v_session.id RETURNING * INTO v_session;
    RETURN jsonb_build_object('status','SESSION_EXPIRED');
  END IF;
  IF v_session.state<>'READY_FOR_INPUT' THEN RETURN jsonb_build_object('status','INVALID_STATE'); END IF;
  SELECT * INTO v_config FROM public.tagging_station_configurations
  WHERE site_id=v_session.site_id AND station_id=v_session.station_id;
  IF p_input_kind NOT IN ('SCANNER','SIMULATED','MANUAL') THEN RETURN jsonb_build_object('status','INVALID_INPUT_KIND'); END IF;
  IF p_input_kind='MANUAL' AND (
    NOT v_config.manual_barcode_entry
    OR (v_session.provisioning_mode='PRE_ENCODED_TAG' AND NOT v_config.manual_epc_entry)
    OR NULLIF(BTRIM(p_reason),'') IS NULL
  ) THEN RETURN jsonb_build_object('status','MANUAL_ENTRY_NOT_ALLOWED'); END IF;
  IF v_barcode IS NULL OR length(v_barcode)>128 OR v_barcode='' OR v_barcode<>btrim(v_barcode)
    OR v_barcode !~ '^[ -~]+$' OR v_barcode ~ '[[:cntrl:]]'
  THEN RETURN jsonb_build_object('status','INVALID_BARCODE'); END IF;
  IF EXISTS(SELECT 1 FROM public.tags WHERE rfid_tag_barcode IS NOT NULL AND upper(btrim(rfid_tag_barcode))=upper(v_barcode)) THEN
    RETURN jsonb_build_object('status','DUPLICATE_BARCODE');
  END IF;
  IF v_session.provisioning_mode='PRE_ENCODED_TAG' THEN
    IF p_expected_epc IS NULL OR p_expected_epc<>btrim(p_expected_epc) OR p_expected_epc!~'^[0-9A-Fa-f]+$'
      OR length(p_expected_epc)%2<>0
    THEN RETURN jsonb_build_object('status','INVALID_EPC'); END IF;
    v_epc:=upper(p_expected_epc); v_bits:=length(v_epc)*4;
    IF v_bits<>ALL(v_config.epc_allowed_bit_lengths) THEN RETURN jsonb_build_object('status','UNSUPPORTED_EPC_LENGTH'); END IF;
    IF EXISTS(SELECT 1 FROM public.tags WHERE upper(btrim(epc))=v_epc)
      OR EXISTS(SELECT 1 FROM public.epc_reservations WHERE upper(btrim(epc))=v_epc)
    THEN RETURN jsonb_build_object('status','DUPLICATE_EPC'); END IF;
  ELSE
    IF p_expected_epc IS NOT NULL THEN RETURN jsonb_build_object('status','EPC_MUST_BE_RESERVED'); END IF;
  END IF;
  v_previous:=v_session.state;
  UPDATE public.tagging_sessions SET
    rfid_tag_barcode=v_barcode,expected_epc=v_epc,
    state=CASE WHEN provisioning_mode='PRE_ENCODED_TAG' THEN 'VERIFY_PENDING' ELSE 'TAG_CAPTURED' END,
    failure_code=NULL,failure_detail=NULL,version=version+1,updated_at=NOW()
  WHERE id=v_session.id RETURNING * INTO v_session;
  PERFORM public.record_tagging_session_event_v1(
    v_session,'RFID_TAG_IDENTITY_CAPTURED','SUCCESS',v_previous,p_actor_id,NULL,
    jsonb_build_object('inputKind',p_input_kind,'manualReasonProvided',p_input_kind='MANUAL','barcode',v_barcode,'expectedEpc',v_epc)
  );
  v_result:=jsonb_build_object('status','CAPTURED','session',to_jsonb(v_session));
  INSERT INTO public.tagging_operation_requests(session_id,operation,request_id,payload_hash,response)
  VALUES(v_session.id,'CAPTURE_IDENTITY',p_request_id,p_payload_hash,v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_tagging_epc_v1(
  p_session_id UUID,p_requested_epc TEXT,p_expected_version INTEGER,
  p_actor_id TEXT,p_request_id TEXT,p_payload_hash TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_session public.tagging_sessions%ROWTYPE;
  v_config public.tagging_station_configurations%ROWTYPE;
  v_reservation public.epc_reservations%ROWTYPE;
  v_epc TEXT; v_bits INTEGER; v_previous TEXT; v_result JSONB; v_replay JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('tagging:operation:'||p_request_id,0));
  v_replay:=public.tagging_operation_replay_v1('RESERVE_EPC',p_request_id,p_payload_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_session FROM public.tagging_sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','SESSION_NOT_FOUND'); END IF;
  IF v_session.operator_id<>p_actor_id THEN RETURN jsonb_build_object('status','OPERATOR_BINDING_CONFLICT'); END IF;
  IF v_session.version<>p_expected_version THEN RETURN jsonb_build_object('status','VERSION_CONFLICT'); END IF;
  IF v_session.provisioning_mode<>'PRINT_AND_ENCODE' THEN RETURN jsonb_build_object('status','WRONG_PROVISIONING_MODE'); END IF;
  IF v_session.state NOT IN ('READY_FOR_INPUT','TAG_CAPTURED') THEN RETURN jsonb_build_object('status','INVALID_STATE'); END IF;
  SELECT * INTO v_config FROM public.tagging_station_configurations
  WHERE site_id=v_session.site_id AND station_id=v_session.station_id;
  v_bits:=v_config.epc_allowed_bit_lengths[1];
  IF p_requested_epc IS NULL OR p_requested_epc='' THEN
    v_epc:=upper(encode(gen_random_bytes(v_bits/8),'hex'));
  ELSE
    IF p_requested_epc<>btrim(p_requested_epc) OR p_requested_epc!~'^[0-9A-Fa-f]+$'
      OR length(p_requested_epc)%2<>0 THEN RETURN jsonb_build_object('status','INVALID_EPC'); END IF;
    v_epc:=upper(p_requested_epc); v_bits:=length(v_epc)*4;
    IF v_bits<>ALL(v_config.epc_allowed_bit_lengths) THEN RETURN jsonb_build_object('status','UNSUPPORTED_EPC_LENGTH'); END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('tagging:epc:'||v_epc,0));
  IF EXISTS(SELECT 1 FROM public.tags WHERE upper(btrim(epc))=v_epc)
    OR EXISTS(SELECT 1 FROM public.epc_reservations WHERE upper(btrim(epc))=v_epc)
  THEN RETURN jsonb_build_object('status','DUPLICATE_EPC'); END IF;
  INSERT INTO public.epc_reservations(session_id,epc,status,request_id,payload_hash,expires_at)
  VALUES(v_session.id,v_epc,'RESERVED',p_request_id,p_payload_hash,v_session.expires_at)
  RETURNING * INTO v_reservation;
  v_previous:=v_session.state;
  UPDATE public.tagging_sessions SET expected_epc=v_epc,state='ENCODE_PENDING',
    failure_code=NULL,failure_detail=NULL,version=version+1,updated_at=NOW()
  WHERE id=v_session.id RETURNING * INTO v_session;
  PERFORM public.record_tagging_session_event_v1(
    v_session,'EPC_RESERVED','SUCCESS',v_previous,p_actor_id,NULL,
    jsonb_build_object('reservationId',v_reservation.id,'epc',v_epc)
  );
  v_result:=jsonb_build_object('status','RESERVED','session',to_jsonb(v_session),'reservation',to_jsonb(v_reservation));
  INSERT INTO public.tagging_operation_requests(session_id,operation,request_id,payload_hash,response)
  VALUES(v_session.id,'RESERVE_EPC',p_request_id,p_payload_hash,v_result);
  RETURN v_result;
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('status','DUPLICATE_EPC');
END;
$$;

CREATE OR REPLACE FUNCTION public.start_tagging_encode_v1(
  p_session_id UUID,p_logical_device_id TEXT,p_label_template_id TEXT,
  p_expected_version INTEGER,p_actor_id TEXT,p_request_id TEXT,p_payload_hash TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_session public.tagging_sessions%ROWTYPE;
  v_reservation public.epc_reservations%ROWTYPE;
  v_job public.tag_provisioning_jobs%ROWTYPE;
  v_previous TEXT; v_result JSONB; v_replay JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('tagging:operation:'||p_request_id,0));
  v_replay:=public.tagging_operation_replay_v1('START_ENCODE',p_request_id,p_payload_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_session FROM public.tagging_sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','SESSION_NOT_FOUND'); END IF;
  IF v_session.operator_id<>p_actor_id THEN RETURN jsonb_build_object('status','OPERATOR_BINDING_CONFLICT'); END IF;
  IF v_session.version<>p_expected_version THEN RETURN jsonb_build_object('status','VERSION_CONFLICT'); END IF;
  IF v_session.provisioning_mode<>'PRINT_AND_ENCODE' OR v_session.state<>'ENCODE_PENDING' THEN
    RETURN jsonb_build_object('status','INVALID_STATE');
  END IF;
  IF NULLIF(BTRIM(p_logical_device_id),'') IS NULL OR length(p_logical_device_id)>64 THEN
    RETURN jsonb_build_object('status','DEVICE_MISCONFIGURED');
  END IF;
  SELECT * INTO v_reservation FROM public.epc_reservations
  WHERE session_id=v_session.id FOR UPDATE;
  IF NOT FOUND OR v_reservation.status<>'RESERVED' OR NOW()>=v_reservation.expires_at THEN
    RETURN jsonb_build_object('status','RESERVATION_NOT_ACTIVE');
  END IF;
  INSERT INTO public.tag_provisioning_jobs(
    session_id,reservation_id,station_id,logical_device_id,rfid_tag_barcode,epc,
    label_template_id,status,request_id,payload_hash,started_at
  ) VALUES (
    v_session.id,v_reservation.id,v_session.station_id,p_logical_device_id,
    v_session.rfid_tag_barcode,v_reservation.epc,NULLIF(BTRIM(p_label_template_id),''),
    'ENCODING',p_request_id,p_payload_hash,NOW()
  ) RETURNING * INTO v_job;
  UPDATE public.epc_reservations SET status='ENCODING',updated_at=NOW()
  WHERE id=v_reservation.id;
  v_previous:=v_session.state;
  UPDATE public.tagging_sessions SET state='ENCODING',version=version+1,updated_at=NOW()
  WHERE id=v_session.id RETURNING * INTO v_session;
  PERFORM public.record_tagging_session_event_v1(
    v_session,'TAG_ENCODE_STARTED','SUCCESS',v_previous,p_actor_id,NULL,
    jsonb_build_object('jobId',v_job.id,'logicalDeviceId',p_logical_device_id,'epc',v_job.epc)
  );
  v_result:=jsonb_build_object('status','ENCODING','session',to_jsonb(v_session),'job',to_jsonb(v_job));
  INSERT INTO public.tagging_operation_requests(session_id,operation,request_id,payload_hash,response)
  VALUES(v_session.id,'START_ENCODE',p_request_id,p_payload_hash,v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_tagging_encode_v1(
  p_job_id UUID,p_result TEXT,p_failure_code TEXT,p_sanitized_result JSONB,
  p_expected_session_version INTEGER,p_actor_id TEXT,p_request_id TEXT,p_payload_hash TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_job public.tag_provisioning_jobs%ROWTYPE;
  v_session public.tagging_sessions%ROWTYPE;
  v_previous TEXT; v_result JSONB; v_replay JSONB; v_job_status TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('tagging:operation:'||p_request_id,0));
  v_replay:=public.tagging_operation_replay_v1('COMPLETE_ENCODE',p_request_id,p_payload_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF p_result NOT IN ('SUCCEEDED','FAILED','TIMED_OUT','CANCELLED','AMBIGUOUS')
    OR jsonb_typeof(COALESCE(p_sanitized_result,'{}'::JSONB))<>'object'
    OR length(COALESCE(p_sanitized_result,'{}'::JSONB)::TEXT)>4096
    OR COALESCE(p_sanitized_result,'{}'::JSONB)::TEXT ~* '"[^"]*(secret|password|credential|token|api[-_]?key)[^"]*"\s*:'
  THEN RETURN jsonb_build_object('status','INVALID_DEVICE_RESULT'); END IF;
  SELECT * INTO v_job FROM public.tag_provisioning_jobs WHERE id=p_job_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','JOB_NOT_FOUND'); END IF;
  SELECT * INTO v_session FROM public.tagging_sessions WHERE id=v_job.session_id FOR UPDATE;
  IF v_session.operator_id<>p_actor_id THEN RETURN jsonb_build_object('status','OPERATOR_BINDING_CONFLICT'); END IF;
  IF v_session.version<>p_expected_session_version THEN RETURN jsonb_build_object('status','VERSION_CONFLICT'); END IF;
  IF v_session.state<>'ENCODING' OR v_job.status<>'ENCODING' THEN
    RETURN jsonb_build_object('status','LATE_RESULT_IGNORED');
  END IF;
  v_job_status:=p_result;
  UPDATE public.tag_provisioning_jobs SET
    status=v_job_status,failure_code=CASE WHEN p_result='SUCCEEDED' THEN NULL ELSE COALESCE(NULLIF(BTRIM(p_failure_code),''),'RFID_ENCODE_FAILED') END,
    sanitized_result=COALESCE(p_sanitized_result,'{}'::JSONB),completed_at=NOW()
  WHERE id=v_job.id RETURNING * INTO v_job;
  UPDATE public.epc_reservations SET
    status=CASE WHEN p_result='SUCCEEDED' THEN 'ENCODED' ELSE 'FAILED' END,
    failure_code=CASE WHEN p_result='SUCCEEDED' THEN NULL ELSE v_job.failure_code END,updated_at=NOW()
  WHERE id=v_job.reservation_id;
  v_previous:=v_session.state;
  UPDATE public.tagging_sessions SET
    state=CASE WHEN p_result='SUCCEEDED' THEN 'ENCODED' ELSE 'FAILED' END,
    failure_code=CASE WHEN p_result='SUCCEEDED' THEN NULL ELSE v_job.failure_code END,
    failure_detail=NULL,version=version+1,updated_at=NOW()
  WHERE id=v_session.id RETURNING * INTO v_session;
  PERFORM public.record_tagging_session_event_v1(
    v_session,CASE WHEN p_result='SUCCEEDED' THEN 'TAG_ENCODE_SUCCEEDED' ELSE 'TAG_ENCODE_FAILED' END,
    p_result,v_previous,p_actor_id,v_job.failure_code,
    jsonb_build_object('jobId',v_job.id,'logicalDeviceId',v_job.logical_device_id,'result',p_result)
  );
  v_result:=jsonb_build_object('status',p_result,'session',to_jsonb(v_session),'job',to_jsonb(v_job));
  INSERT INTO public.tagging_operation_requests(session_id,operation,request_id,payload_hash,response)
  VALUES(v_session.id,'COMPLETE_ENCODE',p_request_id,p_payload_hash,v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_tagging_verification_v1(
  p_session_id UUID,p_logical_device_id TEXT,p_observed_epcs JSONB,
  p_stable_read_count INTEGER,p_result TEXT,p_failure_code TEXT,
  p_expected_version INTEGER,p_actor_id TEXT,p_request_id TEXT,p_payload_hash TEXT,
  p_is_simulated BOOLEAN DEFAULT FALSE
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_session public.tagging_sessions%ROWTYPE;
  v_attempt public.tag_verification_attempts%ROWTYPE;
  v_previous TEXT; v_result_json JSONB; v_replay JSONB;
  v_unexpected INTEGER; v_observed_count INTEGER; v_failure TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('tagging:operation:'||p_request_id,0));
  v_replay:=public.tagging_operation_replay_v1('VERIFY_TAG',p_request_id,p_payload_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF p_result NOT IN ('VERIFIED','NO_TAG','EPC_MISMATCH','MULTIPLE_TAGS','UNSTABLE_READ','DEVICE_UNAVAILABLE','TIMED_OUT','CANCELLED')
    OR jsonb_typeof(COALESCE(p_observed_epcs,'[]'::JSONB))<>'array'
    OR p_stable_read_count<0 OR jsonb_array_length(COALESCE(p_observed_epcs,'[]'::JSONB))>100
  THEN RETURN jsonb_build_object('status','INVALID_VERIFICATION_RESULT'); END IF;
  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(p_observed_epcs,'[]'::JSONB)) value
    WHERE value<>upper(value) OR value!~'^[0-9A-F]+$'
  ) THEN RETURN jsonb_build_object('status','INVALID_OBSERVED_EPC'); END IF;
  SELECT * INTO v_session FROM public.tagging_sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','SESSION_NOT_FOUND'); END IF;
  IF v_session.operator_id<>p_actor_id THEN RETURN jsonb_build_object('status','OPERATOR_BINDING_CONFLICT'); END IF;
  IF v_session.version<>p_expected_version THEN RETURN jsonb_build_object('status','VERSION_CONFLICT'); END IF;
  IF v_session.state NOT IN ('VERIFY_PENDING','ENCODED') THEN RETURN jsonb_build_object('status','LATE_RESULT_IGNORED'); END IF;
  IF p_is_simulated IS DISTINCT FROM v_session.is_simulated THEN RETURN jsonb_build_object('status','SIMULATION_CONTEXT_MISMATCH'); END IF;
  SELECT count(*),count(*) FILTER(WHERE value IS DISTINCT FROM v_session.expected_epc)
  INTO v_observed_count,v_unexpected
  FROM jsonb_array_elements_text(COALESCE(p_observed_epcs,'[]'::JSONB)) value;
  IF p_result='VERIFIED' AND (
    NOT v_session.verification_required
      AND v_observed_count=0
    OR v_session.expected_epc IS NULL
    OR p_stable_read_count<v_session.required_stable_read_count
    OR v_observed_count<p_stable_read_count
    OR v_unexpected<>0
  ) THEN RETURN jsonb_build_object('status','VERIFICATION_EVIDENCE_MISMATCH'); END IF;
  IF p_result='VERIFIED' AND v_observed_count=0 THEN
    RETURN jsonb_build_object('status','VERIFICATION_EVIDENCE_MISMATCH');
  END IF;
  v_previous:=v_session.state;
  UPDATE public.tagging_sessions SET state='VERIFYING',version=version+1,updated_at=NOW()
  WHERE id=v_session.id RETURNING * INTO v_session;
  v_failure:=CASE WHEN p_result='VERIFIED' THEN NULL ELSE COALESCE(NULLIF(BTRIM(p_failure_code),''),'RFID_VERIFY_'||p_result) END;
  INSERT INTO public.tag_verification_attempts(
    session_id,station_id,logical_device_id,expected_epc,observed_epcs,
    stable_read_count,result,failure_code,request_id,payload_hash,is_simulated
  ) VALUES (
    v_session.id,v_session.station_id,p_logical_device_id,v_session.expected_epc,
    COALESCE(p_observed_epcs,'[]'::JSONB),p_stable_read_count,p_result,v_failure,
    p_request_id,p_payload_hash,p_is_simulated
  ) RETURNING * INTO v_attempt;
  UPDATE public.epc_reservations SET
    status=CASE WHEN p_result='VERIFIED' THEN 'VERIFIED' ELSE 'FAILED' END,
    failure_code=v_failure,updated_at=NOW()
  WHERE session_id=v_session.id;
  IF p_result<>'VERIFIED' THEN
    INSERT INTO public.tags(
      bag_id,epc,rfid_tag_barcode,status,site_id,station_id,failure_code,assigned_by,request_id
    ) VALUES (
      NULL,v_session.expected_epc,v_session.rfid_tag_barcode,'FAILED',v_session.site_id,
      v_session.station_id,v_failure,p_actor_id,p_request_id
    ) ON CONFLICT DO NOTHING;
  END IF;
  UPDATE public.tagging_sessions SET
    state=CASE WHEN p_result='VERIFIED' THEN 'VERIFIED' ELSE 'FAILED' END,
    verified_epc=CASE WHEN p_result='VERIFIED' THEN expected_epc ELSE NULL END,
    failure_code=v_failure,failure_detail=NULL,version=version+1,updated_at=NOW()
  WHERE id=v_session.id RETURNING * INTO v_session;
  PERFORM public.record_tagging_session_event_v1(
    v_session,CASE WHEN p_result='VERIFIED' THEN 'TAG_VERIFICATION_SUCCEEDED' ELSE 'TAG_VERIFICATION_FAILED' END,
    p_result,v_previous,p_actor_id,v_failure,
    jsonb_build_object('attemptId',v_attempt.id,'expectedEpc',v_session.expected_epc,
      'observedEpcs',p_observed_epcs,'stableReadCount',p_stable_read_count)
  );
  v_result_json:=jsonb_build_object('status',p_result,'session',to_jsonb(v_session),'attempt',to_jsonb(v_attempt));
  INSERT INTO public.tagging_operation_requests(session_id,operation,request_id,payload_hash,response)
  VALUES(v_session.id,'VERIFY_TAG',p_request_id,p_payload_hash,v_result_json);
  RETURN v_result_json;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_tagging_lpc_v1(
  p_session_id UUID,p_iata_lpc TEXT,p_expected_version INTEGER,p_actor_id TEXT,
  p_request_id TEXT,p_payload_hash TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_session public.tagging_sessions%ROWTYPE; v_old TEXT; v_result JSONB; v_replay JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('tagging:operation:'||p_request_id,0));
  v_replay:=public.tagging_operation_replay_v1('UPDATE_LPC',p_request_id,p_payload_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_session FROM public.tagging_sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','SESSION_NOT_FOUND'); END IF;
  IF v_session.operator_id<>p_actor_id THEN RETURN jsonb_build_object('status','OPERATOR_BINDING_CONFLICT'); END IF;
  IF v_session.version<>p_expected_version THEN RETURN jsonb_build_object('status','VERSION_CONFLICT'); END IF;
  IF v_session.state IN ('COMMITTED','CANCELLED','EXPIRED') THEN RETURN jsonb_build_object('status','INVALID_STATE'); END IF;
  IF p_iata_lpc IS NOT NULL AND p_iata_lpc<>'' AND p_iata_lpc!~'^\d{10}$' THEN
    RETURN jsonb_build_object('status','INVALID_LPC');
  END IF;
  v_old:=v_session.iata_lpc;
  UPDATE public.tagging_sessions SET iata_lpc=NULLIF(p_iata_lpc,''),version=version+1,updated_at=NOW()
  WHERE id=v_session.id RETURNING * INTO v_session;
  PERFORM public.record_tagging_session_event_v1(
    v_session,'IATA_LPC_UPDATED','SUCCESS',v_session.state,p_actor_id,NULL,
    jsonb_build_object('oldLpc',v_old,'newLpc',v_session.iata_lpc)
  );
  v_result:=jsonb_build_object('status','UPDATED','session',to_jsonb(v_session));
  INSERT INTO public.tagging_operation_requests(session_id,operation,request_id,payload_hash,response)
  VALUES(v_session.id,'UPDATE_LPC',p_request_id,p_payload_hash,v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.stage_tagging_bag_photo_v1(
  p_session_id UUID,p_storage_key TEXT,p_original_mime_type TEXT,p_stored_mime_type TEXT,
  p_width INTEGER,p_height INTEGER,p_file_size INTEGER,p_checksum_sha256 TEXT,
  p_captured_at TIMESTAMPTZ,p_expected_version INTEGER,p_actor_id TEXT,
  p_request_id TEXT,p_payload_hash TEXT,p_actor_role TEXT,p_replacement_reason TEXT,
  p_is_simulated BOOLEAN DEFAULT FALSE
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_session public.tagging_sessions%ROWTYPE;
  v_config public.tagging_station_configurations%ROWTYPE;
  v_photo public.bag_photos%ROWTYPE;
  v_previous TEXT; v_result JSONB; v_replay JSONB; v_operation TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('tagging:operation:'||p_request_id,0));
  v_operation:=CASE WHEN p_replacement_reason IS NULL THEN 'STAGE_PHOTO' ELSE 'REPLACE_COMMITTED_PHOTO' END;
  v_replay:=public.tagging_operation_replay_v1(v_operation,p_request_id,p_payload_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_session FROM public.tagging_sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','SESSION_NOT_FOUND'); END IF;
  IF p_replacement_reason IS NULL AND v_session.operator_id<>p_actor_id THEN RETURN jsonb_build_object('status','OPERATOR_BINDING_CONFLICT'); END IF;
  IF v_session.version<>p_expected_version THEN RETURN jsonb_build_object('status','VERSION_CONFLICT'); END IF;
  IF p_replacement_reason IS NULL AND v_session.state NOT IN ('VERIFIED','PHOTO_PENDING','PHOTO_CAPTURED') THEN
    RETURN jsonb_build_object('status','INVALID_STATE');
  END IF;
  IF p_replacement_reason IS NOT NULL AND (
    v_session.state<>'COMMITTED'
    OR p_actor_role NOT IN ('Customs Supervisor','Airport Administrator','System Administrator')
    OR length(BTRIM(p_replacement_reason)) NOT BETWEEN 3 AND 512
  ) THEN RETURN jsonb_build_object('status','PHOTO_REPLACEMENT_NOT_AUTHORIZED'); END IF;
  IF v_session.photo_policy='DISABLED' THEN RETURN jsonb_build_object('status','PHOTO_DISABLED'); END IF;
  IF p_is_simulated IS DISTINCT FROM v_session.is_simulated THEN RETURN jsonb_build_object('status','SIMULATION_CONTEXT_MISMATCH'); END IF;
  SELECT * INTO v_config FROM public.tagging_station_configurations
  WHERE site_id=v_session.site_id AND station_id=v_session.station_id;
  IF p_original_mime_type NOT IN ('image/jpeg','image/png') OR p_stored_mime_type NOT IN ('image/jpeg','image/png')
    OR p_width NOT BETWEEN 1 AND 20000 OR p_height NOT BETWEEN 1 AND 20000
    OR p_file_size<1 OR p_file_size>v_config.photo_max_bytes
    OR p_checksum_sha256!~'^[0-9a-f]{64}$'
    OR p_storage_key IS NULL OR length(p_storage_key)>1024
    OR p_storage_key~'(^|/)\.\.(/|$)' OR p_storage_key~'^[A-Za-z][A-Za-z0-9+.-]*://'
    OR p_storage_key NOT LIKE 'tagging-staging/'||v_session.site_id||'/'||v_session.station_id||'/'||v_session.id::TEXT||'/%'
  THEN RETURN jsonb_build_object('status','INVALID_PHOTO_METADATA'); END IF;
  UPDATE public.bag_photos SET status='REPLACED',replacement_reason='RETAKE_BEFORE_COMMIT',updated_at=NOW()
  WHERE tagging_session_id=v_session.id AND status='STAGED';
  INSERT INTO public.bag_photos(
    bag_id,bhs_uid,tagging_session_id,site_id,station_id,captured_by,captured_at,
    original_mime_type,stored_mime_type,width,height,file_size,checksum_sha256,
    storage_key,status,request_id,payload_hash,is_simulated
  ) VALUES (
    v_session.bag_id,v_session.bhs_uid,v_session.id,v_session.site_id,v_session.station_id,
    p_actor_id,p_captured_at,p_original_mime_type,p_stored_mime_type,p_width,p_height,
    p_file_size,p_checksum_sha256,p_storage_key,'STAGED',p_request_id,p_payload_hash,p_is_simulated
  ) RETURNING * INTO v_photo;
  IF p_replacement_reason IS NOT NULL THEN
    UPDATE public.bag_photos SET replacement_reason=BTRIM(p_replacement_reason),updated_at=NOW()
    WHERE id=v_photo.id RETURNING * INTO v_photo;
  END IF;
  v_previous:=v_session.state;
  UPDATE public.tagging_sessions SET
    state=CASE WHEN p_replacement_reason IS NULL THEN 'PHOTO_CAPTURED' ELSE state END,
    photo_status=CASE WHEN p_replacement_reason IS NULL THEN 'STAGED' ELSE photo_status END,
    version=version+1,updated_at=NOW() WHERE id=v_session.id RETURNING * INTO v_session;
  PERFORM public.record_tagging_session_event_v1(
    v_session,CASE WHEN p_replacement_reason IS NULL THEN 'BAG_PHOTO_CAPTURED' ELSE 'BAG_PHOTO_REPLACEMENT_STAGED' END,
    'SUCCESS',v_previous,p_actor_id,NULL,
    jsonb_build_object('photoId',v_photo.id,'mimeType',v_photo.stored_mime_type,
      'fileSize',v_photo.file_size,'checksum',v_photo.checksum_sha256,
      'replacementReason',p_replacement_reason)
  );
  v_result:=jsonb_build_object('status','STAGED','session',to_jsonb(v_session),'photo',to_jsonb(v_photo)-'storage_key');
  INSERT INTO public.tagging_operation_requests(session_id,operation,request_id,payload_hash,response)
  VALUES(v_session.id,v_operation,p_request_id,p_payload_hash,v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.override_tagging_photo_v1(
  p_session_id UUID,p_reason TEXT,p_expected_version INTEGER,p_actor_id TEXT,
  p_actor_role TEXT,p_request_id TEXT,p_payload_hash TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_session public.tagging_sessions%ROWTYPE; v_previous TEXT; v_result JSONB; v_replay JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('tagging:operation:'||p_request_id,0));
  v_replay:=public.tagging_operation_replay_v1('OVERRIDE_PHOTO',p_request_id,p_payload_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF p_actor_role NOT IN ('Customs Supervisor','Airport Administrator','System Administrator')
    OR NULLIF(BTRIM(p_reason),'') IS NULL OR length(BTRIM(p_reason))<3 OR length(p_reason)>512
  THEN RETURN jsonb_build_object('status','OVERRIDE_NOT_AUTHORIZED'); END IF;
  SELECT * INTO v_session FROM public.tagging_sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','SESSION_NOT_FOUND'); END IF;
  IF v_session.operator_id<>p_actor_id THEN RETURN jsonb_build_object('status','OPERATOR_BINDING_CONFLICT'); END IF;
  IF v_session.version<>p_expected_version THEN RETURN jsonb_build_object('status','VERSION_CONFLICT'); END IF;
  IF v_session.photo_policy<>'REQUIRED' OR v_session.state NOT IN ('VERIFIED','PHOTO_PENDING') THEN
    RETURN jsonb_build_object('status','INVALID_STATE');
  END IF;
  v_previous:=v_session.state;
  UPDATE public.tagging_sessions SET state='READY_TO_COMMIT',photo_status='MISSING_OVERRIDE',
    photo_override_reason=BTRIM(p_reason),version=version+1,updated_at=NOW()
  WHERE id=v_session.id RETURNING * INTO v_session;
  PERFORM public.record_tagging_session_event_v1(
    v_session,'BAG_PHOTO_OVERRIDE_APPROVED','SUCCESS',v_previous,p_actor_id,NULL,
    jsonb_build_object('reason',BTRIM(p_reason))
  );
  v_result:=jsonb_build_object('status','OVERRIDDEN','session',to_jsonb(v_session));
  INSERT INTO public.tagging_operation_requests(session_id,operation,request_id,payload_hash,response)
  VALUES(v_session.id,'OVERRIDE_PHOTO',p_request_id,p_payload_hash,v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_failed_tagging_session_v1(
  p_session_id UUID,p_reason TEXT,p_expected_version INTEGER,p_actor_id TEXT,
  p_request_id TEXT,p_payload_hash TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_session public.tagging_sessions%ROWTYPE; v_previous TEXT; v_result JSONB; v_replay JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('tagging:operation:'||p_request_id,0));
  v_replay:=public.tagging_operation_replay_v1('RETRY_SESSION',p_request_id,p_payload_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_session FROM public.tagging_sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','SESSION_NOT_FOUND'); END IF;
  IF v_session.operator_id<>p_actor_id THEN RETURN jsonb_build_object('status','OPERATOR_BINDING_CONFLICT'); END IF;
  IF v_session.version<>p_expected_version THEN RETURN jsonb_build_object('status','VERSION_CONFLICT'); END IF;
  IF v_session.state<>'FAILED' OR NULLIF(BTRIM(p_reason),'') IS NULL OR NOW()>=v_session.expires_at THEN
    RETURN jsonb_build_object('status','RETRY_NOT_ALLOWED');
  END IF;
  UPDATE public.tags SET status='FAILED',failure_code=COALESCE(failure_code,v_session.failure_code),updated_at=NOW()
  WHERE upper(btrim(epc))=upper(btrim(v_session.expected_epc)) AND status<>'ASSIGNED';
  v_previous:=v_session.state;
  UPDATE public.tagging_sessions SET state='READY_FOR_INPUT',rfid_tag_barcode=NULL,
    expected_epc=NULL,verified_epc=NULL,failure_code=NULL,failure_detail=NULL,
    version=version+1,updated_at=NOW() WHERE id=v_session.id RETURNING * INTO v_session;
  PERFORM public.record_tagging_session_event_v1(
    v_session,'FAILED_TAG_RETRY_STARTED','SUCCESS',v_previous,p_actor_id,NULL,
    jsonb_build_object('reason',BTRIM(p_reason))
  );
  v_result:=jsonb_build_object('status','READY_FOR_INPUT','session',to_jsonb(v_session));
  INSERT INTO public.tagging_operation_requests(session_id,operation,request_id,payload_hash,response)
  VALUES(v_session.id,'RETRY_SESSION',p_request_id,p_payload_hash,v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_tagging_session_v1(
  p_session_id UUID,p_reason TEXT,p_expected_version INTEGER,p_actor_id TEXT,
  p_request_id TEXT,p_payload_hash TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_session public.tagging_sessions%ROWTYPE; v_previous TEXT; v_result JSONB; v_replay JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('tagging:operation:'||p_request_id,0));
  v_replay:=public.tagging_operation_replay_v1('CANCEL_SESSION',p_request_id,p_payload_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NULLIF(BTRIM(p_reason),'') IS NULL THEN RETURN jsonb_build_object('status','REASON_REQUIRED'); END IF;
  SELECT * INTO v_session FROM public.tagging_sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','SESSION_NOT_FOUND'); END IF;
  IF v_session.operator_id<>p_actor_id THEN RETURN jsonb_build_object('status','OPERATOR_BINDING_CONFLICT'); END IF;
  IF v_session.version<>p_expected_version THEN RETURN jsonb_build_object('status','VERSION_CONFLICT'); END IF;
  IF v_session.state IN ('COMMITTED','CANCELLED','EXPIRED') THEN RETURN jsonb_build_object('status','INVALID_STATE'); END IF;
  UPDATE public.epc_reservations SET status=CASE WHEN status IN ('RESERVED') THEN 'RELEASED' ELSE 'VOIDED' END,
    failure_code='SESSION_CANCELLED',updated_at=NOW()
  WHERE session_id=v_session.id AND status NOT IN ('ASSIGNED','RELEASED','EXPIRED','VOIDED');
  v_previous:=v_session.state;
  UPDATE public.tagging_sessions SET state='CANCELLED',cancelled_at=NOW(),
    failure_code='SESSION_CANCELLED',failure_detail=NULL,version=version+1,updated_at=NOW()
  WHERE id=v_session.id RETURNING * INTO v_session;
  UPDATE public.tagging_station_queue_items SET state='ACTIVE',updated_at=NOW()
  WHERE id=v_session.queue_item_id AND position=1 AND state='TAGGING_IN_PROGRESS';
  PERFORM public.record_tagging_session_event_v1(
    v_session,'TAGGING_SESSION_CANCELLED','CANCELLED',v_previous,p_actor_id,'SESSION_CANCELLED',
    jsonb_build_object('reason',BTRIM(p_reason))
  );
  v_result:=jsonb_build_object('status','CANCELLED','session',to_jsonb(v_session));
  INSERT INTO public.tagging_operation_requests(session_id,operation,request_id,payload_hash,response)
  VALUES(v_session.id,'CANCEL_SESSION',p_request_id,p_payload_hash,v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_tag_replacement_v1(
  p_assignment_id UUID,p_operator_id TEXT,p_operator_role TEXT,p_reason TEXT,
  p_request_id TEXT,p_payload_hash TEXT,p_is_simulated BOOLEAN DEFAULT FALSE
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_assignment public.bag_tag_assignments%ROWTYPE;
  v_prior_session public.tagging_sessions%ROWTYPE;
  v_config public.tagging_station_configurations%ROWTYPE;
  v_bag public.bags%ROWTYPE;
  v_existing public.tagging_sessions%ROWTYPE;
  v_session public.tagging_sessions%ROWTYPE;
BEGIN
  IF p_operator_role NOT IN ('Customs Supervisor','Airport Administrator','System Administrator')
    OR NULLIF(BTRIM(p_reason),'') IS NULL OR length(BTRIM(p_reason))<3 OR length(p_reason)>512
    OR p_payload_hash!~'^[0-9a-f]{64}$'
  THEN RETURN jsonb_build_object('status','REPLACEMENT_NOT_AUTHORIZED'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('tagging:replacement:'||p_assignment_id::TEXT,0));
  SELECT * INTO v_existing FROM public.tagging_sessions WHERE create_request_id=p_request_id;
  IF FOUND THEN
    IF v_existing.create_payload_hash<>p_payload_hash THEN RETURN jsonb_build_object('status','IDEMPOTENCY_CONFLICT'); END IF;
    RETURN jsonb_build_object('status','DUPLICATE','session',to_jsonb(v_existing));
  END IF;
  SELECT * INTO v_assignment FROM public.bag_tag_assignments
  WHERE id=p_assignment_id FOR UPDATE;
  IF NOT FOUND OR v_assignment.assignment_status<>'ACTIVE' THEN RETURN jsonb_build_object('status','ACTIVE_ASSIGNMENT_NOT_FOUND'); END IF;
  SELECT * INTO v_prior_session FROM public.tagging_sessions WHERE id=v_assignment.tagging_session_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','SESSION_HISTORY_NOT_FOUND'); END IF;
  SELECT * INTO v_config FROM public.tagging_station_configurations
  WHERE site_id=v_assignment.site_id AND station_id=v_assignment.station_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','STATION_NOT_CONFIGURED'); END IF;
  IF p_is_simulated AND NOT v_config.simulation_enabled THEN RETURN jsonb_build_object('status','SIMULATOR_DISABLED'); END IF;
  SELECT * INTO v_bag FROM public.bags WHERE id=v_assignment.bag_id FOR UPDATE;
  IF v_bag.status<>'TAGGED' THEN RETURN jsonb_build_object('status','BAG_NOT_REPLACEABLE'); END IF;
  IF EXISTS(SELECT 1 FROM public.tagging_sessions WHERE bag_id=v_bag.id AND state NOT IN ('COMMITTED','CANCELLED','EXPIRED')) THEN
    RETURN jsonb_build_object('status','ACTIVE_SESSION_EXISTS');
  END IF;
  INSERT INTO public.tagging_sessions(
    site_id,station_id,queue_item_id,bag_id,bhs_uid,line_id,operator_id,operator_role,
    state,provisioning_mode,configuration_version,photo_policy,
    verification_required,required_stable_read_count,replacement_of_assignment_id,
    create_request_id,create_payload_hash,is_simulated,expires_at
  ) VALUES (
    v_assignment.site_id,v_assignment.station_id,v_prior_session.queue_item_id,v_bag.id,
    v_bag.bhs_uid,v_bag.bhs_line_id,p_operator_id,p_operator_role,'READY_FOR_INPUT',
    v_config.provisioning_mode,v_config.version,v_config.photo_policy,
    CASE WHEN v_config.provisioning_mode='PRINT_AND_ENCODE' THEN TRUE ELSE v_config.verification_required_preencoded END,
    v_config.verification_stable_read_count,v_assignment.id,p_request_id,p_payload_hash,
    p_is_simulated,NOW()+make_interval(secs=>v_config.session_ttl_seconds)
  ) RETURNING * INTO v_session;
  PERFORM public.record_tagging_session_event_v1(
    v_session,'TAG_REPLACEMENT_REQUESTED','SUCCESS',NULL,p_operator_id,NULL,
    jsonb_build_object('replacedAssignmentId',v_assignment.id,'reason',BTRIM(p_reason))
  );
  INSERT INTO public.audit_events(action,actor_type,actor_id,canonical_role,bag_id,source_system,outcome,request_id,metadata)
  VALUES('TAG_REPLACEMENT_REQUESTED','USER',p_operator_id,p_operator_role,v_bag.id,'SBTS_TAGGING','SUCCESS',p_request_id,
    jsonb_build_object('sessionId',v_session.id,'replacedAssignmentId',v_assignment.id,'reason',BTRIM(p_reason),'simulated',p_is_simulated));
  RETURN jsonb_build_object('status','REQUESTED','session',to_jsonb(v_session));
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_tagging_session_v1(
  p_session_id UUID,p_expected_version INTEGER,p_actor_id TEXT,p_actor_role TEXT,
  p_request_id TEXT,p_payload_hash TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_session public.tagging_sessions%ROWTYPE;
  v_bag public.bags%ROWTYPE;
  v_queue public.tagging_station_queue_items%ROWTYPE;
  v_photo public.bag_photos%ROWTYPE;
  v_tag public.tags%ROWTYPE;
  v_assignment public.bag_tag_assignments%ROWTYPE;
  v_old_assignment public.bag_tag_assignments%ROWTYPE;
  v_existing_assignment public.bag_tag_assignments%ROWTYPE;
  v_previous TEXT; v_assignment_version INTEGER; v_result JSONB;
BEGIN
  IF p_payload_hash!~'^[0-9a-f]{64}$' OR NULLIF(BTRIM(p_request_id),'') IS NULL THEN
    RETURN jsonb_build_object('status','INVALID_REQUEST');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('tagging:commit:'||p_request_id,0));
  SELECT * INTO v_existing_assignment FROM public.bag_tag_assignments
  WHERE commit_request_id=p_request_id;
  IF FOUND THEN
    IF v_existing_assignment.commit_payload_hash<>p_payload_hash THEN
      RETURN jsonb_build_object('status','IDEMPOTENCY_CONFLICT');
    END IF;
    SELECT * INTO v_session FROM public.tagging_sessions WHERE id=v_existing_assignment.tagging_session_id;
    SELECT * INTO v_bag FROM public.bags WHERE id=v_existing_assignment.bag_id;
    RETURN jsonb_build_object('status','DUPLICATE','session',to_jsonb(v_session),
      'assignment',to_jsonb(v_existing_assignment),'bag',to_jsonb(v_bag));
  END IF;
  SELECT * INTO v_session FROM public.tagging_sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','SESSION_NOT_FOUND'); END IF;
  IF v_session.operator_id<>p_actor_id THEN RETURN jsonb_build_object('status','OPERATOR_BINDING_CONFLICT'); END IF;
  IF v_session.version<>p_expected_version THEN RETURN jsonb_build_object('status','VERSION_CONFLICT'); END IF;
  IF NOW()>=v_session.expires_at THEN RETURN jsonb_build_object('status','SESSION_EXPIRED'); END IF;
  IF v_session.verified_epc IS NULL OR v_session.verified_epc IS DISTINCT FROM v_session.expected_epc
    OR v_session.rfid_tag_barcode IS NULL
    OR v_session.state NOT IN ('VERIFIED','PHOTO_CAPTURED','READY_TO_COMMIT')
  THEN RETURN jsonb_build_object('status','VERIFICATION_REQUIRED'); END IF;
  IF v_session.photo_policy='REQUIRED'
    AND v_session.photo_status NOT IN ('STAGED','MISSING_OVERRIDE')
  THEN RETURN jsonb_build_object('status','PHOTO_REQUIRED'); END IF;
  IF v_session.photo_status='MISSING_OVERRIDE' AND NULLIF(BTRIM(v_session.photo_override_reason),'') IS NULL THEN
    RETURN jsonb_build_object('status','PHOTO_OVERRIDE_INVALID');
  END IF;
  SELECT * INTO v_queue FROM public.tagging_station_queue_items
  WHERE id=v_session.queue_item_id FOR UPDATE;
  IF NOT FOUND OR v_queue.site_id<>v_session.site_id OR v_queue.station_id<>v_session.station_id
    OR v_queue.bag_id<>v_session.bag_id OR v_queue.bhs_uid<>v_session.bhs_uid
  THEN RETURN jsonb_build_object('status','QUEUE_BINDING_CONFLICT'); END IF;
  SELECT * INTO v_bag FROM public.bags WHERE id=v_session.bag_id FOR UPDATE;
  IF NOT FOUND OR v_bag.bhs_uid<>v_session.bhs_uid OR v_bag.bhs_line_id<>v_session.line_id THEN
    RETURN jsonb_build_object('status','BAG_BINDING_CONFLICT');
  END IF;
  IF v_session.replacement_of_assignment_id IS NULL THEN
    IF v_queue.position<>1 OR v_queue.state<>'TAGGING_IN_PROGRESS'
      OR v_bag.status<>'IDENTIFIED' OR v_bag.tagging_readiness_status<>'READY_FOR_TAGGING'
      OR v_bag.epc IS NOT NULL OR v_bag.rfid_tag_barcode IS NOT NULL
    THEN RETURN jsonb_build_object('status','BAG_NOT_READY'); END IF;
    v_assignment_version:=1;
  ELSE
    SELECT * INTO v_old_assignment FROM public.bag_tag_assignments
    WHERE id=v_session.replacement_of_assignment_id FOR UPDATE;
    IF NOT FOUND OR v_old_assignment.bag_id<>v_bag.id OR v_old_assignment.assignment_status<>'ACTIVE'
      OR v_bag.status<>'TAGGED'
    THEN RETURN jsonb_build_object('status','REPLACEMENT_CONFLICT'); END IF;
    v_assignment_version:=v_old_assignment.assignment_version+1;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('tagging:epc:'||v_session.expected_epc,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('tagging:barcode:'||upper(v_session.rfid_tag_barcode),0));
  SELECT * INTO v_tag FROM public.tags
  WHERE upper(btrim(epc))=v_session.expected_epc
     OR (rfid_tag_barcode IS NOT NULL AND upper(btrim(rfid_tag_barcode))=upper(v_session.rfid_tag_barcode))
  FOR UPDATE;
  IF FOUND THEN
    IF upper(btrim(v_tag.epc))<>v_session.expected_epc
      OR upper(btrim(COALESCE(v_tag.rfid_tag_barcode,'')))<>upper(v_session.rfid_tag_barcode)
      OR v_tag.status NOT IN ('AVAILABLE','RESERVED','VERIFIED')
    THEN RETURN jsonb_build_object('status',CASE WHEN upper(btrim(v_tag.epc))=v_session.expected_epc THEN 'DUPLICATE_EPC' ELSE 'DUPLICATE_BARCODE' END); END IF;
    UPDATE public.tags SET status='ASSIGNED',assigned_by=p_actor_id,request_id=p_request_id,
      assigned_at=NOW(),site_id=v_session.site_id,station_id=v_session.station_id,updated_at=NOW()
    WHERE id=v_tag.id RETURNING * INTO v_tag;
  ELSE
    INSERT INTO public.tags(
      bag_id,epc,rfid_tag_barcode,iata_lpc,assigned_by,request_id,assigned_at,
      status,site_id,station_id
    ) VALUES (
      v_bag.id,v_session.expected_epc,v_session.rfid_tag_barcode,v_session.iata_lpc,
      p_actor_id,p_request_id,NOW(),'ASSIGNED',v_session.site_id,v_session.station_id
    ) RETURNING * INTO v_tag;
  END IF;
  v_previous:=v_session.state;
  UPDATE public.tagging_sessions SET state='COMMITTING',version=version+1,updated_at=NOW()
  WHERE id=v_session.id RETURNING * INTO v_session;
  IF v_session.replacement_of_assignment_id IS NOT NULL THEN
    UPDATE public.bag_tag_assignments SET assignment_status='REPLACED',ended_at=NOW(),
      end_reason='REPLACED_BY_SESSION:'||v_session.id::TEXT
    WHERE id=v_old_assignment.id;
    UPDATE public.tags SET status='REPLACED',updated_at=NOW() WHERE id=v_old_assignment.tag_id;
  END IF;
  UPDATE public.bags SET
    epc=v_session.expected_epc,rfid_tag_barcode=v_session.rfid_tag_barcode,
    iata_code=COALESCE(v_session.iata_lpc,iata_code),status='TAGGED',
    tagged_at=COALESCE(tagged_at,NOW()),version=version+1,updated_at=NOW()
  WHERE id=v_bag.id RETURNING * INTO v_bag;
  INSERT INTO public.bag_tag_assignments(
    bag_id,tag_id,assignment_version,assignment_status,assigned_at,assigned_by,
    site_id,station_id,tagging_session_id,replaced_assignment_id,
    commit_request_id,commit_payload_hash
  ) VALUES (
    v_bag.id,v_tag.id,v_assignment_version,'ACTIVE',NOW(),p_actor_id,
    v_session.site_id,v_session.station_id,v_session.id,v_session.replacement_of_assignment_id,
    p_request_id,p_payload_hash
  ) RETURNING * INTO v_assignment;
  UPDATE public.epc_reservations SET status='ASSIGNED',updated_at=NOW()
  WHERE session_id=v_session.id AND status='VERIFIED';
  -- Object storage is outside this transaction.  Keep the photo staged until
  -- the server has promoted the object and calls finalize_tagging_photo_v1.
  -- This prevents an ACTIVE database record from pointing at a failed upload.
  SELECT * INTO v_photo FROM public.bag_photos
  WHERE tagging_session_id=v_session.id AND status='STAGED' FOR UPDATE;
  IF v_session.replacement_of_assignment_id IS NULL THEN
    UPDATE public.tagging_station_queue_items SET position=NULL,state='TAGGED',updated_at=NOW()
    WHERE id=v_queue.id;
    UPDATE public.tagging_station_queue_items SET position=1,state='ACTIVE',updated_at=NOW()
    WHERE site_id=v_queue.site_id AND station_id=v_queue.station_id AND position=2;
  END IF;
  UPDATE public.tagging_sessions SET state='COMMITTED',committed_at=NOW(),
    version=version+1,updated_at=NOW()
  WHERE id=v_session.id RETURNING * INTO v_session;
  PERFORM public.record_tagging_session_event_v1(
    v_session,CASE WHEN v_session.replacement_of_assignment_id IS NULL THEN 'TAG_ASSIGNMENT_COMMITTED' ELSE 'TAG_REPLACEMENT_COMPLETED' END,
    'SUCCESS',v_previous,p_actor_id,NULL,
    jsonb_build_object('assignmentId',v_assignment.id,'tagId',v_tag.id,
      'assignmentVersion',v_assignment.assignment_version,'epc',v_tag.epc,
      'rfidTagBarcode',v_tag.rfid_tag_barcode,'photoStatus',v_session.photo_status)
  );
  INSERT INTO public.audit_events(action,actor_type,actor_id,canonical_role,bag_id,source_system,outcome,request_id,metadata)
  VALUES(
    CASE WHEN v_session.replacement_of_assignment_id IS NULL THEN 'TAG_ASSIGNMENT_COMMITTED' ELSE 'TAG_REPLACEMENT_COMPLETED' END,
    'USER',p_actor_id,p_actor_role,v_bag.id,'SBTS_TAGGING','SUCCESS',p_request_id,
    jsonb_build_object('sessionId',v_session.id,'assignmentId',v_assignment.id,
      'stationId',v_session.station_id,'siteId',v_session.site_id,'bhsUid',v_session.bhs_uid,
      'assignmentVersion',v_assignment.assignment_version,'simulated',v_session.is_simulated)
  );
  RETURN jsonb_build_object('status','COMMITTED','session',to_jsonb(v_session),
    'assignment',to_jsonb(v_assignment),'bag',to_jsonb(v_bag));
EXCEPTION WHEN unique_violation THEN
  IF EXISTS(SELECT 1 FROM public.tags WHERE upper(btrim(epc))=upper(btrim(v_session.expected_epc))) THEN
    RETURN jsonb_build_object('status','DUPLICATE_EPC');
  END IF;
  IF EXISTS(SELECT 1 FROM public.tags WHERE upper(btrim(rfid_tag_barcode))=upper(btrim(v_session.rfid_tag_barcode))) THEN
    RETURN jsonb_build_object('status','DUPLICATE_BARCODE');
  END IF;
  RETURN jsonb_build_object('status','CONCURRENT_ASSIGNMENT_CONFLICT');
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_tagging_photo_v1(
  p_session_id UUID,p_photo_id UUID,p_actor_id TEXT,p_request_id TEXT,p_payload_hash TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_session public.tagging_sessions%ROWTYPE;
  v_photo public.bag_photos%ROWTYPE;
  v_result JSONB; v_replay JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('tagging:operation:'||p_request_id,0));
  v_replay:=public.tagging_operation_replay_v1('FINALIZE_PHOTO',p_request_id,p_payload_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_session FROM public.tagging_sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','SESSION_NOT_FOUND'); END IF;
  IF v_session.state<>'COMMITTED' THEN RETURN jsonb_build_object('status','INVALID_STATE'); END IF;
  SELECT * INTO v_photo FROM public.bag_photos
  WHERE id=p_photo_id AND tagging_session_id=v_session.id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','PHOTO_NOT_FOUND'); END IF;
  IF v_session.operator_id<>p_actor_id AND v_photo.captured_by<>p_actor_id THEN
    RETURN jsonb_build_object('status','OPERATOR_BINDING_CONFLICT');
  END IF;
  IF v_photo.status='ACTIVE' THEN
    v_result:=jsonb_build_object('status','DUPLICATE','session',to_jsonb(v_session),
      'photo',to_jsonb(v_photo)-'storage_key');
  ELSIF v_photo.status<>'STAGED' THEN
    RETURN jsonb_build_object('status','INVALID_PHOTO_STATE');
  ELSE
    UPDATE public.bag_photos SET status='REPLACED',replacement_reason=COALESCE(v_photo.replacement_reason,'POST_COMMIT_REPLACEMENT'),updated_at=NOW()
    WHERE tagging_session_id=v_session.id AND status='ACTIVE' AND id<>v_photo.id;
    UPDATE public.bag_photos SET status='ACTIVE',version=version+1,updated_at=NOW()
    WHERE id=v_photo.id RETURNING * INTO v_photo;
    UPDATE public.tagging_sessions SET photo_status='CAPTURED',version=version+1,updated_at=NOW()
    WHERE id=v_session.id RETURNING * INTO v_session;
    PERFORM public.record_tagging_session_event_v1(
      v_session,'BAG_PHOTO_PROMOTED','SUCCESS',v_session.state,p_actor_id,NULL,
      jsonb_build_object('photoId',v_photo.id,'checksum',v_photo.checksum_sha256)
    );
    INSERT INTO public.audit_events(action,actor_type,actor_id,bag_id,source_system,outcome,request_id,metadata)
    VALUES('BAG_PHOTO_PROMOTED','SYSTEM',p_actor_id,v_session.bag_id,'SBTS_TAGGING','SUCCESS',p_request_id,
      jsonb_build_object('sessionId',v_session.id,'photoId',v_photo.id));
    v_result:=jsonb_build_object('status','FINALIZED','session',to_jsonb(v_session),
      'photo',to_jsonb(v_photo)-'storage_key');
  END IF;
  INSERT INTO public.tagging_operation_requests(session_id,operation,request_id,payload_hash,response)
  VALUES(v_session.id,'FINALIZE_PHOTO',p_request_id,p_payload_hash,v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_tagging_photo_promotion_failure_v1(
  p_session_id UUID,p_photo_id UUID,p_failure_code TEXT,p_actor_id TEXT,p_request_id TEXT,p_payload_hash TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_session public.tagging_sessions%ROWTYPE;
  v_photo public.bag_photos%ROWTYPE;
  v_result JSONB; v_replay JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('tagging:operation:'||p_request_id,0));
  v_replay:=public.tagging_operation_replay_v1('PHOTO_PROMOTION_FAILED',p_request_id,p_payload_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_session FROM public.tagging_sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','SESSION_NOT_FOUND'); END IF;
  SELECT * INTO v_photo FROM public.bag_photos
  WHERE id=p_photo_id AND tagging_session_id=v_session.id AND status='STAGED' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','PHOTO_NOT_STAGED'); END IF;
  IF v_session.operator_id<>p_actor_id AND v_photo.captured_by<>p_actor_id THEN
    RETURN jsonb_build_object('status','OPERATOR_BINDING_CONFLICT');
  END IF;
  PERFORM public.record_tagging_session_event_v1(
    v_session,'BAG_PHOTO_PROMOTION_FAILED','FAILED',v_session.state,p_actor_id,p_failure_code,
    jsonb_build_object('photoId',v_photo.id)
  );
  INSERT INTO public.audit_events(action,actor_type,actor_id,bag_id,source_system,outcome,request_id,metadata)
  VALUES('BAG_PHOTO_PROMOTION_FAILED','SYSTEM',p_actor_id,v_session.bag_id,'SBTS_TAGGING','FAILED',p_request_id,
    jsonb_build_object('sessionId',v_session.id,'photoId',v_photo.id,'failureCode',p_failure_code));
  v_result:=jsonb_build_object('status','RECORDED','session',to_jsonb(v_session),
    'photo',to_jsonb(v_photo)-'storage_key');
  INSERT INTO public.tagging_operation_requests(session_id,operation,request_id,payload_hash,response)
  VALUES(v_session.id,'PHOTO_PROMOTION_FAILED',p_request_id,p_payload_hash,v_result);
  RETURN v_result;
END;
$$;

CREATE TABLE public.tag_inventory_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id TEXT NOT NULL,
  station_id TEXT NOT NULL,
  supplier TEXT NOT NULL,
  batch_number TEXT NOT NULL,
  row_count INTEGER NOT NULL CHECK(row_count BETWEEN 1 AND 1000),
  request_id TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL CHECK(payload_hash~'^[0-9a-f]{64}$'),
  imported_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.tag_inventory_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tag_inventory_imports FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.tag_inventory_imports TO service_role;

CREATE OR REPLACE FUNCTION public.import_tag_inventory_v1(
  p_site_id TEXT,p_station_id TEXT,p_supplier TEXT,p_batch_number TEXT,p_rows JSONB,
  p_actor_id TEXT,p_request_id TEXT,p_payload_hash TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_config public.tagging_station_configurations%ROWTYPE;
  v_import public.tag_inventory_imports%ROWTYPE;
  v_row JSONB; v_epc TEXT; v_barcode TEXT; v_bits INTEGER;
BEGIN
  SELECT * INTO v_import FROM public.tag_inventory_imports WHERE request_id=p_request_id;
  IF FOUND THEN
    IF v_import.payload_hash<>p_payload_hash THEN RETURN jsonb_build_object('status','IDEMPOTENCY_CONFLICT'); END IF;
    RETURN jsonb_build_object('status','DUPLICATE','import',to_jsonb(v_import));
  END IF;
  SELECT * INTO v_config FROM public.tagging_station_configurations
  WHERE site_id=p_site_id AND station_id=p_station_id;
  IF NOT FOUND OR NOT v_config.inventory_enabled THEN RETURN jsonb_build_object('status','INVENTORY_DISABLED'); END IF;
  IF jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 1000
    OR NULLIF(BTRIM(p_supplier),'') IS NULL OR NULLIF(BTRIM(p_batch_number),'') IS NULL
    OR left(BTRIM(p_supplier),1) IN ('=','+','-','@') OR left(BTRIM(p_batch_number),1) IN ('=','+','-','@')
  THEN RETURN jsonb_build_object('status','INVALID_IMPORT'); END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(v_row)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(v_row))<>2 THEN
      RAISE EXCEPTION 'Inventory row shape is invalid' USING ERRCODE='22023';
    END IF;
    v_barcode:=v_row->>'barcode'; v_epc:=upper(v_row->>'epc'); v_bits:=length(v_epc)*4;
    IF v_barcode IS NULL OR v_barcode='' OR v_barcode<>btrim(v_barcode)
      OR v_barcode!~'^[ -~]+$' OR length(v_barcode)>128
      OR v_epc!~'^[0-9A-F]+$' OR length(v_epc)%2<>0 OR v_bits<>ALL(v_config.epc_allowed_bit_lengths)
    THEN RAISE EXCEPTION 'Inventory row identity is invalid' USING ERRCODE='22023'; END IF;
    INSERT INTO public.tags(
      bag_id,epc,rfid_tag_barcode,status,site_id,station_id,supplier,batch_number,received_at
    ) VALUES(NULL,v_epc,v_barcode,'AVAILABLE',p_site_id,p_station_id,BTRIM(p_supplier),BTRIM(p_batch_number),NOW());
  END LOOP;
  INSERT INTO public.tag_inventory_imports(
    site_id,station_id,supplier,batch_number,row_count,request_id,payload_hash,imported_by
  ) VALUES(
    p_site_id,p_station_id,BTRIM(p_supplier),BTRIM(p_batch_number),jsonb_array_length(p_rows),
    p_request_id,p_payload_hash,p_actor_id
  ) RETURNING * INTO v_import;
  INSERT INTO public.audit_events(action,actor_type,actor_id,source_system,outcome,request_id,metadata)
  VALUES('TAG_INVENTORY_IMPORTED','USER',p_actor_id,'SBTS_TAGGING','SUCCESS',p_request_id,
    jsonb_build_object('siteId',p_site_id,'stationId',p_station_id,'supplier',BTRIM(p_supplier),
      'batchNumber',BTRIM(p_batch_number),'rowCount',v_import.row_count));
  RETURN jsonb_build_object('status','IMPORTED','import',to_jsonb(v_import));
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Inventory import contains a duplicate EPC or barcode' USING ERRCODE='23505';
END;
$$;

CREATE VIEW public.tagging_metrics_v1 WITH (security_invoker=TRUE) AS
SELECT
  sessions.site_id,sessions.station_id,(sessions.created_at AT TIME ZONE 'UTC')::DATE AS metric_date,
  count(*) FILTER(WHERE sessions.state='COMMITTED') AS successful_tag_assignments,
  count(*) FILTER(WHERE sessions.state='COMMITTED' AND sessions.replacement_of_assignment_id IS NULL) AS bags_tagged,
  count(*) FILTER(WHERE sessions.state='COMMITTED' AND sessions.replacement_of_assignment_id IS NOT NULL) AS replacement_tags,
  count(*) FILTER(WHERE sessions.state='CANCELLED') AS sessions_cancelled,
  count(*) FILTER(WHERE sessions.photo_status='MISSING_OVERRIDE') AS supervisor_overrides,
  count(*) FILTER(WHERE sessions.state='FAILED') AS failed_sessions,
  COALESCE(avg(extract(epoch FROM (sessions.committed_at-sessions.created_at)))
    FILTER(WHERE sessions.committed_at IS NOT NULL),0) AS average_tagging_seconds,
  COALESCE(sum(jobs.failure_count),0)::BIGINT AS encode_failures,
  COALESCE(sum(attempts.failure_count),0)::BIGINT AS verification_failures,
  COALESCE(sum(photos.failure_count),0)::BIGINT AS photo_failures,
  count(*) FILTER(WHERE sessions.is_simulated) AS simulated_sessions
FROM public.tagging_sessions sessions
LEFT JOIN LATERAL (
  SELECT count(*) AS failure_count FROM public.tag_provisioning_jobs
  WHERE session_id=sessions.id AND status IN ('FAILED','TIMED_OUT','AMBIGUOUS')
) jobs ON TRUE
LEFT JOIN LATERAL (
  SELECT count(*) AS failure_count FROM public.tag_verification_attempts
  WHERE session_id=sessions.id AND result<>'VERIFIED'
) attempts ON TRUE
LEFT JOIN LATERAL (
  SELECT count(*) AS failure_count FROM public.bag_photos
  WHERE tagging_session_id=sessions.id AND status='FAILED'
) photos ON TRUE
GROUP BY sessions.site_id,sessions.station_id,(sessions.created_at AT TIME ZONE 'UTC')::DATE;
REVOKE ALL ON public.tagging_metrics_v1 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.tagging_metrics_v1 TO service_role;

REVOKE ALL ON FUNCTION public.configure_tagging_station_v1(TEXT,TEXT,TEXT[],TEXT,TEXT,BOOLEAN,INTEGER,INTEGER[],BOOLEAN,BOOLEAN,BOOLEAN,BOOLEAN,INTEGER,INTEGER,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.sync_tagging_station_queue_item_v1(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,INTEGER,TIMESTAMPTZ,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_tagging_session_v1(UUID,TEXT,TEXT,TEXT,TEXT,BOOLEAN) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_tagging_session_v1(UUID,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.capture_tagging_identity_v1(UUID,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reserve_tagging_epc_v1(UUID,TEXT,INTEGER,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.start_tagging_encode_v1(UUID,TEXT,TEXT,INTEGER,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_tagging_encode_v1(UUID,TEXT,TEXT,JSONB,INTEGER,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_tagging_verification_v1(UUID,TEXT,JSONB,INTEGER,TEXT,TEXT,INTEGER,TEXT,TEXT,TEXT,BOOLEAN) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_tagging_lpc_v1(UUID,TEXT,INTEGER,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.stage_tagging_bag_photo_v1(UUID,TEXT,TEXT,TEXT,INTEGER,INTEGER,INTEGER,TEXT,TIMESTAMPTZ,INTEGER,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.override_tagging_photo_v1(UUID,TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.retry_failed_tagging_session_v1(UUID,TEXT,INTEGER,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_tagging_session_v1(UUID,TEXT,INTEGER,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.request_tag_replacement_v1(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.commit_tagging_session_v1(UUID,INTEGER,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finalize_tagging_photo_v1(UUID,UUID,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_tagging_photo_promotion_failure_v1(UUID,UUID,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.import_tag_inventory_v1(TEXT,TEXT,TEXT,TEXT,JSONB,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.configure_tagging_station_v1(TEXT,TEXT,TEXT[],TEXT,TEXT,BOOLEAN,INTEGER,INTEGER[],BOOLEAN,BOOLEAN,BOOLEAN,BOOLEAN,INTEGER,INTEGER,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_tagging_station_queue_item_v1(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,INTEGER,TIMESTAMPTZ,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_tagging_session_v1(UUID,TEXT,TEXT,TEXT,TEXT,BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_tagging_session_v1(UUID,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_tagging_identity_v1(UUID,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_tagging_epc_v1(UUID,TEXT,INTEGER,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_tagging_encode_v1(UUID,TEXT,TEXT,INTEGER,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_tagging_encode_v1(UUID,TEXT,TEXT,JSONB,INTEGER,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_tagging_verification_v1(UUID,TEXT,JSONB,INTEGER,TEXT,TEXT,INTEGER,TEXT,TEXT,TEXT,BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_tagging_lpc_v1(UUID,TEXT,INTEGER,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.stage_tagging_bag_photo_v1(UUID,TEXT,TEXT,TEXT,INTEGER,INTEGER,INTEGER,TEXT,TIMESTAMPTZ,INTEGER,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.override_tagging_photo_v1(UUID,TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_failed_tagging_session_v1(UUID,TEXT,INTEGER,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_tagging_session_v1(UUID,TEXT,INTEGER,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_tag_replacement_v1(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_tagging_session_v1(UUID,INTEGER,TEXT,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_tagging_photo_v1(UUID,UUID,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_tagging_photo_promotion_failure_v1(UUID,UUID,TEXT,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.import_tag_inventory_v1(TEXT,TEXT,TEXT,TEXT,JSONB,TEXT,TEXT,TEXT) TO service_role;
