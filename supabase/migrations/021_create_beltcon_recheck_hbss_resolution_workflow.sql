-- BELTCON SBTS Recheck Workflow V1. This adds durable server-side recall and
-- final-resolution records; it does not contact physical HBSS or RS-232 hardware.

CREATE TABLE IF NOT EXISTS public.hbss_recall_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bag_id TEXT NOT NULL REFERENCES public.bags(id) ON DELETE CASCADE,
  alarm_id TEXT NOT NULL REFERENCES public.alarms(id) ON DELETE CASCADE,
  bhs_uid TEXT NOT NULL,
  station_id TEXT NULL,
  adapter_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  requested_by UUID NOT NULL REFERENCES public.profiles(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NULL,
  error_code TEXT NULL,
  error_message TEXT NULL,
  request_id TEXT NULL,
  idempotency_key TEXT NULL,
  response_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT hbss_recall_bhs_uid_not_blank CHECK (BTRIM(bhs_uid) <> ''),
  CONSTRAINT hbss_recall_adapter_type_check CHECK (adapter_type IN ('SIMULATED','RS232','API','SDK')),
  CONSTRAINT hbss_recall_status_check CHECK (status IN ('PENDING','SENT','ACKNOWLEDGED','FAILED','UNAVAILABLE','SIMULATED')),
  CONSTRAINT hbss_recall_completed_after_requested_check CHECK (completed_at IS NULL OR completed_at >= requested_at),
  CONSTRAINT hbss_recall_error_for_failure_check CHECK (
    status NOT IN ('FAILED','UNAVAILABLE') OR error_code IS NOT NULL OR error_message IS NOT NULL
  ),
  CONSTRAINT hbss_recall_response_metadata_object_check CHECK (JSONB_TYPEOF(response_metadata) = 'object')
);
ALTER TABLE public.hbss_recall_requests ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_hbss_recall_requests_bag_requested ON public.hbss_recall_requests(bag_id, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hbss_recall_actor_bag_idempotency
ON public.hbss_recall_requests(bag_id, requested_by, idempotency_key)
WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.resolutions
  ADD COLUMN IF NOT EXISTS alarm_id TEXT REFERENCES public.alarms(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS notes TEXT NULL,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS evidence JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT NULL,
  ADD COLUMN IF NOT EXISTS request_id TEXT NULL;
ALTER TABLE public.resolutions
  ADD CONSTRAINT resolutions_version_positive_check CHECK (version >= 1),
  ADD CONSTRAINT resolutions_evidence_object_check CHECK (JSONB_TYPEOF(evidence) = 'object');
CREATE UNIQUE INDEX IF NOT EXISTS idx_resolutions_one_final_per_alarm
ON public.resolutions(alarm_id) WHERE alarm_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_resolutions_actor_bag_idempotency
ON public.resolutions(officer_id, bag_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
DROP POLICY IF EXISTS "auth_write_resolutions" ON public.resolutions;

CREATE OR REPLACE FUNCTION public.begin_beltcon_hbss_recall_v1(
  p_bag_id TEXT,p_alarm_id TEXT,p_expected_bag_version INTEGER,p_expected_alarm_version INTEGER,
  p_actor_id UUID,p_station_id TEXT,p_adapter_type TEXT,p_idempotency_key TEXT,p_request_id TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_bag public.bags%ROWTYPE; v_alarm public.alarms%ROWTYPE; v_recall public.hbss_recall_requests%ROWTYPE; v_key TEXT := NULLIF(BTRIM(p_idempotency_key),'');
BEGIN
  IF v_key IS NOT NULL THEN SELECT * INTO v_recall FROM public.hbss_recall_requests WHERE bag_id=p_bag_id AND requested_by=p_actor_id AND idempotency_key=v_key FOR UPDATE; IF FOUND THEN RETURN JSONB_BUILD_OBJECT('status','DUPLICATE','recall',TO_JSONB(v_recall)); END IF; END IF;
  SELECT * INTO v_bag FROM public.bags WHERE id=p_bag_id FOR UPDATE; IF NOT FOUND THEN RETURN JSONB_BUILD_OBJECT('status','BAG_NOT_FOUND'); END IF;
  SELECT * INTO v_alarm FROM public.alarms WHERE id=p_alarm_id FOR UPDATE; IF NOT FOUND THEN RETURN JSONB_BUILD_OBJECT('status','ALARM_NOT_FOUND'); END IF;
  IF v_alarm.bag_id <> v_bag.id THEN RETURN JSONB_BUILD_OBJECT('status','ALARM_MISMATCH'); END IF;
  IF v_bag.version <> p_expected_bag_version OR v_alarm.version <> p_expected_alarm_version THEN RETURN JSONB_BUILD_OBJECT('status','VERSION_CONFLICT','bagVersion',v_bag.version,'alarmVersion',v_alarm.version); END IF;
  IF v_bag.status <> 'UNDER_RECHECK' THEN RETURN JSONB_BUILD_OBJECT('status','INVALID_BAG_STATE'); END IF;
  IF v_alarm.outcome NOT IN ('OPEN','ACKNOWLEDGED','ESCALATED','SENT_TO_RECHECK') THEN RETURN JSONB_BUILD_OBJECT('status','INVALID_ALARM_STATE'); END IF;
  IF NULLIF(BTRIM(v_bag.bhs_uid),'') IS NULL OR char_length(v_bag.bhs_uid) <> 10 THEN RETURN JSONB_BUILD_OBJECT('status','BHS_UID_REQUIRED'); END IF;
  INSERT INTO public.hbss_recall_requests(bag_id,alarm_id,bhs_uid,station_id,adapter_type,status,requested_by,request_id,idempotency_key)
  VALUES(v_bag.id,v_alarm.id,v_bag.bhs_uid,NULLIF(BTRIM(p_station_id),''),p_adapter_type,'PENDING',p_actor_id,NULLIF(BTRIM(p_request_id),''),v_key) RETURNING * INTO v_recall;
  INSERT INTO public.audit_events(action,actor_type,actor_id,canonical_role,bag_id,outcome,request_id,metadata) VALUES('HBSS_RECALL_REQUESTED','USER',p_actor_id::TEXT,NULL,v_bag.id,'PENDING',p_request_id,JSONB_BUILD_OBJECT('alarmId',v_alarm.id,'recallRequestId',v_recall.id,'adapterType',p_adapter_type,'bhsUid',v_bag.bhs_uid));
  RETURN JSONB_BUILD_OBJECT('status','CREATED','recall',TO_JSONB(v_recall),'bhsUid',v_bag.bhs_uid);
END; $$;

CREATE OR REPLACE FUNCTION public.complete_beltcon_hbss_recall_v1(
  p_recall_id UUID,p_status TEXT,p_error_code TEXT,p_error_message TEXT,p_response_metadata JSONB,p_request_id TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_recall public.hbss_recall_requests%ROWTYPE; v_action TEXT;
BEGIN
  SELECT * INTO v_recall FROM public.hbss_recall_requests WHERE id=p_recall_id FOR UPDATE; IF NOT FOUND THEN RETURN JSONB_BUILD_OBJECT('status','NOT_FOUND'); END IF;
  IF v_recall.status <> 'PENDING' THEN RETURN JSONB_BUILD_OBJECT('status','DUPLICATE','recall',TO_JSONB(v_recall)); END IF;
  IF p_status NOT IN ('SENT','ACKNOWLEDGED','FAILED','UNAVAILABLE','SIMULATED') THEN RETURN JSONB_BUILD_OBJECT('status','INVALID_STATUS'); END IF;
  UPDATE public.hbss_recall_requests SET status=p_status,completed_at=NOW(),error_code=NULLIF(BTRIM(p_error_code),''),error_message=NULLIF(BTRIM(p_error_message),''),response_metadata=COALESCE(p_response_metadata,'{}'::JSONB) WHERE id=p_recall_id RETURNING * INTO v_recall;
  v_action := CASE p_status WHEN 'SIMULATED' THEN 'HBSS_RECALL_SIMULATED' WHEN 'SENT' THEN 'HBSS_RECALL_SENT' WHEN 'ACKNOWLEDGED' THEN 'HBSS_RECALL_SENT' WHEN 'UNAVAILABLE' THEN 'HBSS_RECALL_UNAVAILABLE' ELSE 'HBSS_RECALL_FAILED' END;
  INSERT INTO public.audit_events(action,actor_type,actor_id,bag_id,outcome,request_id,metadata) VALUES(v_action,'INTEGRATION',v_recall.adapter_type,v_recall.bag_id,p_status,p_request_id,JSONB_BUILD_OBJECT('alarmId',v_recall.alarm_id,'recallRequestId',v_recall.id,'adapterType',v_recall.adapter_type));
  RETURN JSONB_BUILD_OBJECT('status','COMPLETED','recall',TO_JSONB(v_recall));
END; $$;

CREATE OR REPLACE FUNCTION public.resolve_beltcon_recheck_case_v1(
  p_bag_id TEXT,p_alarm_id TEXT,p_expected_bag_version INTEGER,p_expected_alarm_version INTEGER,p_disposition TEXT,p_notes TEXT,p_actor_id UUID,p_canonical_role TEXT,p_idempotency_key TEXT,p_request_id TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_bag public.bags%ROWTYPE; v_alarm public.alarms%ROWTYPE; v_resolution public.resolutions%ROWTYPE; v_key TEXT := NULLIF(BTRIM(p_idempotency_key),''); v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT * INTO v_bag FROM public.bags WHERE id=p_bag_id FOR UPDATE; IF NOT FOUND THEN RETURN JSONB_BUILD_OBJECT('status','BAG_NOT_FOUND'); END IF;
  SELECT * INTO v_alarm FROM public.alarms WHERE id=p_alarm_id FOR UPDATE; IF NOT FOUND THEN RETURN JSONB_BUILD_OBJECT('status','ALARM_NOT_FOUND'); END IF;
  IF v_alarm.bag_id <> v_bag.id THEN RETURN JSONB_BUILD_OBJECT('status','ALARM_MISMATCH'); END IF;
  SELECT * INTO v_resolution FROM public.resolutions WHERE alarm_id=v_alarm.id FOR UPDATE; IF FOUND THEN
    IF v_key IS NOT NULL AND v_resolution.idempotency_key=v_key THEN RETURN JSONB_BUILD_OBJECT('status','DUPLICATE','bag',TO_JSONB(v_bag),'alarm',TO_JSONB(v_alarm),'resolution',TO_JSONB(v_resolution)); END IF;
    RETURN JSONB_BUILD_OBJECT('status','RESOLUTION_CONFLICT');
  END IF;
  IF v_bag.version <> p_expected_bag_version OR v_alarm.version <> p_expected_alarm_version THEN RETURN JSONB_BUILD_OBJECT('status','VERSION_CONFLICT','bagVersion',v_bag.version,'alarmVersion',v_alarm.version); END IF;
  IF v_bag.status <> 'UNDER_RECHECK' THEN RETURN JSONB_BUILD_OBJECT('status','INVALID_BAG_STATE'); END IF;
  IF v_alarm.outcome NOT IN ('OPEN','ACKNOWLEDGED','ESCALATED','SENT_TO_RECHECK') THEN RETURN JSONB_BUILD_OBJECT('status','INVALID_ALARM_STATE'); END IF;
  IF p_disposition NOT IN ('CLEARED','NOT_CLEARED') THEN RETURN JSONB_BUILD_OBJECT('status','INVALID_DISPOSITION'); END IF;
  INSERT INTO public.resolutions(id,bag_id,alarm_id,officer_id,action,resolved_at,notes,version,evidence,idempotency_key,request_id) VALUES('RES-' || UPPER(SUBSTRING(MD5(v_alarm.id || ':' || COALESCE(v_key,p_request_id)) FROM 1 FOR 16)),v_bag.id,v_alarm.id,p_actor_id::TEXT,p_disposition,v_now,NULLIF(BTRIM(p_notes),''),1,'{}'::JSONB,v_key,NULLIF(BTRIM(p_request_id),'')) RETURNING * INTO v_resolution;
  UPDATE public.bags SET status='RESOLVED',version=version+1,updated_at=v_now WHERE id=v_bag.id RETURNING * INTO v_bag;
  UPDATE public.alarms SET outcome='CLOSED',disposition=p_disposition,closed_at=v_now,version=version+1 WHERE id=v_alarm.id RETURNING * INTO v_alarm;
  INSERT INTO public.alarm_actions(alarm_id,actor_id,action,from_status,to_status,reason,notes,request_id) VALUES(v_alarm.id,p_actor_id,'CLOSED','SENT_TO_RECHECK','CLOSED',p_disposition,NULLIF(BTRIM(p_notes),''),p_request_id);
  INSERT INTO public.audit_events(action,actor_type,actor_id,canonical_role,bag_id,outcome,request_id,metadata) VALUES('RECHECK_INSPECTION_RESOLVED','USER',p_actor_id::TEXT,p_canonical_role,v_bag.id,'SUCCESS',p_request_id,JSONB_BUILD_OBJECT('alarmId',v_alarm.id,'disposition',p_disposition,'previousBagStatus','UNDER_RECHECK','newBagStatus','RESOLVED','previousAlarmStatus','SENT_TO_RECHECK','newAlarmStatus','CLOSED','bagVersion',v_bag.version,'alarmVersion',v_alarm.version));
  INSERT INTO public.audit_events(action,actor_type,actor_id,canonical_role,bag_id,outcome,request_id,metadata) VALUES('BAG_RESOLVED','USER',p_actor_id::TEXT,p_canonical_role,v_bag.id,p_disposition,p_request_id,JSONB_BUILD_OBJECT('alarmId',v_alarm.id));
  INSERT INTO public.audit_events(action,actor_type,actor_id,canonical_role,bag_id,outcome,request_id,metadata) VALUES('ALARM_CLOSED','USER',p_actor_id::TEXT,p_canonical_role,v_bag.id,p_disposition,p_request_id,JSONB_BUILD_OBJECT('alarmId',v_alarm.id));
  RETURN JSONB_BUILD_OBJECT('status','RESOLVED','bag',TO_JSONB(v_bag),'alarm',TO_JSONB(v_alarm),'resolution',TO_JSONB(v_resolution));
END; $$;

REVOKE ALL ON FUNCTION public.begin_beltcon_hbss_recall_v1(TEXT,TEXT,INTEGER,INTEGER,UUID,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_beltcon_hbss_recall_v1(UUID,TEXT,TEXT,TEXT,JSONB,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_beltcon_recheck_case_v1(TEXT,TEXT,INTEGER,INTEGER,TEXT,TEXT,UUID,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_beltcon_hbss_recall_v1(TEXT,TEXT,INTEGER,INTEGER,UUID,TEXT,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_beltcon_hbss_recall_v1(UUID,TEXT,TEXT,TEXT,JSONB,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_beltcon_recheck_case_v1(TEXT,TEXT,INTEGER,INTEGER,TEXT,TEXT,UUID,TEXT,TEXT,TEXT) TO service_role;
