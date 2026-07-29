-- BELTCON SBTS Customs Exit Workflow V1. This is a durable software alarm
-- workflow only: no physical light, buzzer, HBSS recall, or resolution occurs.

ALTER TABLE public.alarms
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_to_recheck_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalated_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS source_rfid_event_id TEXT REFERENCES public.rfid_events(id),
  ADD COLUMN IF NOT EXISTS zone_code TEXT,
  ADD COLUMN IF NOT EXISTS alarm_type TEXT NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'HIGH' CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  ADD COLUMN IF NOT EXISTS disposition TEXT;

UPDATE public.alarms SET opened_at = COALESCE(opened_at, triggered_at) WHERE opened_at IS NULL;
ALTER TABLE public.alarms
  ADD CONSTRAINT alarms_version_positive_check CHECK (version >= 1),
  ADD CONSTRAINT alarms_ack_after_open_check CHECK (acknowledged_at IS NULL OR acknowledged_at >= opened_at) NOT VALID,
  ADD CONSTRAINT alarms_escalated_after_open_check CHECK (escalated_at IS NULL OR escalated_at >= opened_at) NOT VALID,
  ADD CONSTRAINT alarms_recheck_after_open_check CHECK (sent_to_recheck_at IS NULL OR sent_to_recheck_at >= opened_at) NOT VALID,
  ADD CONSTRAINT alarms_closed_after_open_check CHECK (closed_at IS NULL OR closed_at >= opened_at) NOT VALID,
  ADD CONSTRAINT alarms_closed_requires_timestamp_check CHECK (
    (outcome = 'CLOSED' AND closed_at IS NOT NULL) OR (outcome <> 'CLOSED' AND closed_at IS NULL)
  ) NOT VALID;

ALTER TABLE public.alarms DROP CONSTRAINT IF EXISTS alarms_outcome_check;
ALTER TABLE public.alarms ADD CONSTRAINT alarms_outcome_check CHECK (outcome IN (
  'OPEN','ACKNOWLEDGED','UNDER_INVESTIGATION','ESCALATED','SENT_TO_RECHECK','CLOSED',
  'CLEARED','NOT_CLEARED','DUTY_COLLECTED','PROHIBITED_ITEM_SEIZED','SUPPRESSED'
));

-- Migration 003 permitted any signed-in browser client to write alarms. The
-- BELTCON Alarm Service is now the only mutation boundary; service_role RPCs
-- bypass RLS after server-side authorization has succeeded.
DROP POLICY IF EXISTS "auth_write_alarms" ON public.alarms;
DROP POLICY IF EXISTS "auth_update_alarms" ON public.alarms;
DROP POLICY IF EXISTS "auth_delete_alarms" ON public.alarms;

CREATE TABLE IF NOT EXISTS public.alarm_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alarm_id TEXT NOT NULL REFERENCES public.alarms(id) ON DELETE CASCADE,
  actor_id UUID NULL REFERENCES public.profiles(id),
  action TEXT NOT NULL CHECK (action IN ('OPENED','ACKNOWLEDGED','ESCALATED','SENT_TO_RECHECK','ASSIGNED','REASSIGNED','CLOSED')),
  from_status TEXT NULL,
  to_status TEXT NULL,
  reason TEXT NULL,
  notes TEXT NULL,
  request_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_alarm_actions_alarm_created ON public.alarm_actions(alarm_id, created_at ASC);
ALTER TABLE public.alarm_actions ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS idx_alarms_active_customs_exit_unique
ON public.alarms(bag_id, zone_code, alarm_type)
WHERE outcome IN ('OPEN','ACKNOWLEDGED','UNDER_INVESTIGATION','ESCALATED','SENT_TO_RECHECK')
  AND alarm_type = 'CUSTOMS_EXIT';

CREATE OR REPLACE FUNCTION public.process_beltcon_rfid_read_v2(
  p_event_id TEXT, p_source_system TEXT, p_source_event_id TEXT, p_reader_id TEXT,
  p_antenna_port SMALLINT, p_epc TEXT, p_device_occurred_at TIMESTAMPTZ,
  p_rssi_dbm NUMERIC DEFAULT NULL, p_tid TEXT DEFAULT NULL, p_device_sequence BIGINT DEFAULT NULL,
  p_boot_id TEXT DEFAULT NULL, p_event_fingerprint TEXT DEFAULT NULL, p_request_id TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_result JSONB; v_event_id TEXT; v_bag public.bags%ROWTYPE; v_alarm public.alarms%ROWTYPE; v_now TIMESTAMPTZ := NOW(); v_alarm_id TEXT;
BEGIN
  v_result := public.process_beltcon_rfid_read_v1(p_event_id,p_source_system,p_source_event_id,p_reader_id,p_antenna_port,p_epc,p_device_occurred_at,p_rssi_dbm,p_tid,p_device_sequence,p_boot_id,p_event_fingerprint,p_request_id);
  IF v_result ->> 'outcome' = 'DUPLICATE' THEN
    SELECT * INTO v_alarm
    FROM public.alarms
    WHERE source_rfid_event_id = v_result ->> 'eventId'
    ORDER BY opened_at DESC NULLS LAST
    LIMIT 1;
    IF FOUND THEN
      RETURN v_result || JSONB_BUILD_OBJECT(
        'alarm', JSONB_BUILD_OBJECT(
          'id', v_alarm.id,
          'status', v_alarm.outcome,
          'severity', v_alarm.severity,
          'created', FALSE
        )
      );
    END IF;
    RETURN v_result;
  END IF;
  IF v_result ->> 'outcome' <> 'EXIT_DETECTED' THEN RETURN v_result; END IF;
  v_event_id := v_result ->> 'eventId';
  SELECT * INTO v_bag FROM public.bags WHERE id = v_result ->> 'bagId' FOR UPDATE;
  IF NOT FOUND THEN RETURN v_result; END IF;
  IF v_bag.status = 'RESOLVED' THEN RETURN v_result || JSONB_BUILD_OBJECT('outcome','BAG_ALREADY_RESOLVED','alarm',NULL); END IF;
  IF v_bag.status = 'UNDER_RECHECK' THEN RETURN v_result || JSONB_BUILD_OBJECT('outcome','BAG_ALREADY_AT_RECHECK','alarm',NULL); END IF;
  SELECT * INTO v_alarm FROM public.alarms WHERE bag_id = v_bag.id AND zone_code = 'CUSTOMS_EXIT' AND alarm_type = 'CUSTOMS_EXIT' AND outcome IN ('OPEN','ACKNOWLEDGED','UNDER_INVESTIGATION','ESCALATED','SENT_TO_RECHECK') FOR UPDATE;
  IF FOUND THEN
    INSERT INTO public.audit_events(action,actor_type,actor_id,bag_id,source_system,outcome,request_id,metadata) VALUES ('CUSTOMS_EXIT_ALARM_ALREADY_ACTIVE','INTEGRATION',p_source_system,v_bag.id,p_source_system,'EXISTING',p_request_id,JSONB_BUILD_OBJECT('alarmId',v_alarm.id,'eventId',v_event_id));
    RETURN v_result || JSONB_BUILD_OBJECT('outcome','ALARM_ALREADY_ACTIVE','alarm',JSONB_BUILD_OBJECT('id',v_alarm.id,'status',v_alarm.outcome,'severity',v_alarm.severity,'created',FALSE));
  END IF;
  IF v_bag.status NOT IN ('TAGGED','IN_ARRIVAL_HALL') THEN RETURN v_result || JSONB_BUILD_OBJECT('outcome','BAG_STATE_CONFLICT','alarm',NULL); END IF;
  v_alarm_id := 'ALARM-' || UPPER(SUBSTRING(MD5(v_bag.id || ':' || v_event_id) FROM 1 FOR 16));
  UPDATE public.bags SET status = 'ALARMED', current_zone = 'CUSTOMS_EXIT', version = version + 1, updated_at = v_now WHERE id = v_bag.id RETURNING * INTO v_bag;
  INSERT INTO public.alarms(id,bag_id,zone,triggered_at,outcome,severity,version,opened_at,source_rfid_event_id,zone_code,alarm_type) VALUES (v_alarm_id,v_bag.id,'CUSTOMS_EXIT',v_now,'OPEN','HIGH',1,v_now,v_event_id,'CUSTOMS_EXIT','CUSTOMS_EXIT') RETURNING * INTO v_alarm;
  INSERT INTO public.alarm_actions(alarm_id,action,from_status,to_status,request_id) VALUES(v_alarm.id,'OPENED',NULL,'OPEN',p_request_id);
  INSERT INTO public.audit_events(action,actor_type,actor_id,bag_id,source_system,outcome,request_id,metadata) VALUES ('CUSTOMS_EXIT_ALARM_OPENED','INTEGRATION',p_source_system,v_bag.id,p_source_system,'SUCCESS',p_request_id,JSONB_BUILD_OBJECT('alarmId',v_alarm.id,'eventId',v_event_id,'zone','CUSTOMS_EXIT','severity','HIGH'));
  RETURN v_result || JSONB_BUILD_OBJECT('outcome','ALARM_CREATED','currentStatus','ALARMED','alarm',JSONB_BUILD_OBJECT('id',v_alarm.id,'status','OPEN','severity','HIGH','created',TRUE));
END; $$;

CREATE OR REPLACE FUNCTION public.acknowledge_beltcon_alarm_v1(p_alarm_id TEXT,p_expected_version INTEGER,p_actor_id UUID,p_canonical_role TEXT,p_notes TEXT DEFAULT NULL,p_request_id TEXT DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_alarm public.alarms%ROWTYPE; v_now TIMESTAMPTZ := NOW();
BEGIN SELECT * INTO v_alarm FROM public.alarms WHERE id=p_alarm_id FOR UPDATE; IF NOT FOUND THEN RETURN JSONB_BUILD_OBJECT('status','NOT_FOUND'); END IF; IF v_alarm.version <> p_expected_version THEN RETURN JSONB_BUILD_OBJECT('status','VERSION_CONFLICT','version',v_alarm.version); END IF; IF v_alarm.outcome <> 'OPEN' THEN RETURN JSONB_BUILD_OBJECT('status','INVALID_STATE','outcome',v_alarm.outcome); END IF; UPDATE public.alarms SET outcome='ACKNOWLEDGED',acknowledged_at=v_now,acknowledged_by=p_actor_id::TEXT,version=version+1 WHERE id=v_alarm.id RETURNING * INTO v_alarm; INSERT INTO public.alarm_actions(alarm_id,actor_id,action,from_status,to_status,notes,request_id) VALUES(v_alarm.id,p_actor_id,'ACKNOWLEDGED','OPEN','ACKNOWLEDGED',NULLIF(BTRIM(p_notes),''),p_request_id); INSERT INTO public.audit_events(action,actor_type,actor_id,canonical_role,bag_id,outcome,request_id,metadata) VALUES('ALARM_ACKNOWLEDGED','USER',p_actor_id::TEXT,p_canonical_role,v_alarm.bag_id,'SUCCESS',p_request_id,JSONB_BUILD_OBJECT('alarmId',v_alarm.id,'version',v_alarm.version)); RETURN JSONB_BUILD_OBJECT('status','ACKNOWLEDGED','alarm',TO_JSONB(v_alarm)); END; $$;

CREATE OR REPLACE FUNCTION public.escalate_beltcon_alarm_v1(p_alarm_id TEXT,p_expected_version INTEGER,p_actor_id UUID,p_canonical_role TEXT,p_reason TEXT,p_notes TEXT DEFAULT NULL,p_request_id TEXT DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_alarm public.alarms%ROWTYPE; v_now TIMESTAMPTZ := NOW();
BEGIN IF NULLIF(BTRIM(p_reason),'') IS NULL THEN RETURN JSONB_BUILD_OBJECT('status','REASON_REQUIRED'); END IF; SELECT * INTO v_alarm FROM public.alarms WHERE id=p_alarm_id FOR UPDATE; IF NOT FOUND THEN RETURN JSONB_BUILD_OBJECT('status','NOT_FOUND'); END IF; IF v_alarm.version <> p_expected_version THEN RETURN JSONB_BUILD_OBJECT('status','VERSION_CONFLICT','version',v_alarm.version); END IF; IF v_alarm.outcome NOT IN ('OPEN','ACKNOWLEDGED') THEN RETURN JSONB_BUILD_OBJECT('status','INVALID_STATE','outcome',v_alarm.outcome); END IF; UPDATE public.alarms SET outcome='ESCALATED',escalated_at=v_now,escalated_by=p_actor_id,version=version+1 WHERE id=v_alarm.id RETURNING * INTO v_alarm; INSERT INTO public.alarm_actions(alarm_id,actor_id,action,from_status,to_status,reason,notes,request_id) VALUES(v_alarm.id,p_actor_id,'ESCALATED',NULL,'ESCALATED',BTRIM(p_reason),NULLIF(BTRIM(p_notes),''),p_request_id); INSERT INTO public.audit_events(action,actor_type,actor_id,canonical_role,bag_id,outcome,request_id,metadata) VALUES('ALARM_ESCALATED','USER',p_actor_id::TEXT,p_canonical_role,v_alarm.bag_id,'SUCCESS',p_request_id,JSONB_BUILD_OBJECT('alarmId',v_alarm.id,'reason',BTRIM(p_reason),'version',v_alarm.version)); RETURN JSONB_BUILD_OBJECT('status','ESCALATED','alarm',TO_JSONB(v_alarm)); END; $$;

CREATE OR REPLACE FUNCTION public.send_beltcon_alarm_to_recheck_v1(p_alarm_id TEXT,p_expected_version INTEGER,p_actor_id UUID,p_canonical_role TEXT,p_reason TEXT,p_recheck_station_id TEXT DEFAULT NULL,p_request_id TEXT DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_alarm public.alarms%ROWTYPE; v_bag public.bags%ROWTYPE; v_now TIMESTAMPTZ := NOW();
BEGIN IF NULLIF(BTRIM(p_reason),'') IS NULL THEN RETURN JSONB_BUILD_OBJECT('status','REASON_REQUIRED'); END IF; SELECT * INTO v_alarm FROM public.alarms WHERE id=p_alarm_id FOR UPDATE; IF NOT FOUND THEN RETURN JSONB_BUILD_OBJECT('status','NOT_FOUND'); END IF; IF v_alarm.version <> p_expected_version THEN RETURN JSONB_BUILD_OBJECT('status','VERSION_CONFLICT','version',v_alarm.version); END IF; IF v_alarm.outcome NOT IN ('OPEN','ACKNOWLEDGED','ESCALATED') THEN RETURN JSONB_BUILD_OBJECT('status','INVALID_STATE','outcome',v_alarm.outcome); END IF; SELECT * INTO v_bag FROM public.bags WHERE id=v_alarm.bag_id FOR UPDATE; IF NOT FOUND THEN RETURN JSONB_BUILD_OBJECT('status','BAG_NOT_FOUND'); END IF; IF v_bag.status='RESOLVED' THEN RETURN JSONB_BUILD_OBJECT('status','BAG_STATE_CONFLICT'); END IF; IF v_bag.status NOT IN ('ALARMED','IN_ARRIVAL_HALL') THEN RETURN JSONB_BUILD_OBJECT('status','BAG_STATE_CONFLICT'); END IF; UPDATE public.bags SET status='UNDER_RECHECK',current_zone=COALESCE(NULLIF(BTRIM(p_recheck_station_id),''),'RECHECK'),version=version+1,updated_at=v_now WHERE id=v_bag.id RETURNING * INTO v_bag; UPDATE public.alarms SET outcome='SENT_TO_RECHECK',sent_to_recheck_at=v_now,version=version+1 WHERE id=v_alarm.id RETURNING * INTO v_alarm; INSERT INTO public.alarm_actions(alarm_id,actor_id,action,from_status,to_status,reason,request_id) VALUES(v_alarm.id,p_actor_id,'SENT_TO_RECHECK','ALARMED','SENT_TO_RECHECK',BTRIM(p_reason),p_request_id); INSERT INTO public.audit_events(action,actor_type,actor_id,canonical_role,bag_id,outcome,request_id,metadata) VALUES('BAG_SENT_TO_RECHECK','USER',p_actor_id::TEXT,p_canonical_role,v_bag.id,'SUCCESS',p_request_id,JSONB_BUILD_OBJECT('alarmId',v_alarm.id,'reason',BTRIM(p_reason),'alarmVersion',v_alarm.version,'bagVersion',v_bag.version)); RETURN JSONB_BUILD_OBJECT('status','SENT_TO_RECHECK','alarm',TO_JSONB(v_alarm),'bag',TO_JSONB(v_bag)); END; $$;

REVOKE ALL ON FUNCTION public.process_beltcon_rfid_read_v2(TEXT,TEXT,TEXT,TEXT,SMALLINT,TEXT,TIMESTAMPTZ,NUMERIC,TEXT,BIGINT,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.acknowledge_beltcon_alarm_v1(TEXT,INTEGER,UUID,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.escalate_beltcon_alarm_v1(TEXT,INTEGER,UUID,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.send_beltcon_alarm_to_recheck_v1(TEXT,INTEGER,UUID,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_beltcon_rfid_read_v2(TEXT,TEXT,TEXT,TEXT,SMALLINT,TEXT,TIMESTAMPTZ,NUMERIC,TEXT,BIGINT,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.acknowledge_beltcon_alarm_v1(TEXT,INTEGER,UUID,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.escalate_beltcon_alarm_v1(TEXT,INTEGER,UUID,TEXT,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.send_beltcon_alarm_to_recheck_v1(TEXT,INTEGER,UUID,TEXT,TEXT,TEXT,TEXT) TO service_role;
