CREATE TABLE public.xray_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- public.bags.id is TEXT and stores ETB-* identifiers, so this FK must
  -- use the same type.
  bag_id TEXT REFERENCES public.bags(id) ON DELETE SET NULL,
  bhs_uid TEXT NOT NULL,

  external_scan_id TEXT,
  source_system TEXT NOT NULL DEFAULT 'MOCK_HBSS',

  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (
      status IN (
        'PENDING',
        'AVAILABLE',
        'FAILED',
        'NOT_FOUND',
        'ARCHIVED'
      )
    ),

  images JSONB NOT NULL DEFAULT '[]'::jsonb,

  threat_level SMALLINT
    CHECK (threat_level IS NULL OR threat_level BETWEEN 1 AND 5),

  threat_type TEXT,

  captured_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  error_code TEXT,
  error_message TEXT,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_xray_scans_bhs_uid
ON public.xray_scans(bhs_uid);

CREATE INDEX idx_xray_scans_bag_id
ON public.xray_scans(bag_id);

CREATE INDEX idx_xray_scans_status
ON public.xray_scans(status);

CREATE UNIQUE INDEX idx_xray_scans_source_external
ON public.xray_scans(source_system, external_scan_id)
WHERE external_scan_id IS NOT NULL;

ALTER TABLE public.xray_scans ENABLE ROW LEVEL SECURITY;

-- Browser clients may read scan records once authenticated. No browser
-- insert/update/delete policies are created; server-side service-role
-- ingestion bypasses RLS without exposing that credential to the client.
CREATE POLICY "auth_read_xray_scans"
ON public.xray_scans
FOR SELECT
TO authenticated
USING (true);
