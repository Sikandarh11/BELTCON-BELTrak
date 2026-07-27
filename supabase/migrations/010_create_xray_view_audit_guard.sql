-- One durable view audit per authenticated user, scan, and Recheck view
-- session. A page reload receives a new request ID and therefore creates a
-- new audit event; viewer controls never call this path.
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_events_xray_view_session
ON public.audit_events (
  action,
  actor_id,
  bag_id,
  xray_scan_id,
  request_id
)
WHERE action = 'XRAY_VIEWED'
  AND actor_id IS NOT NULL
  AND bag_id IS NOT NULL
  AND xray_scan_id IS NOT NULL
  AND request_id IS NOT NULL;
