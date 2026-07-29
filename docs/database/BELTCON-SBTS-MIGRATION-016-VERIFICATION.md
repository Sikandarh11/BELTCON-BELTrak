# BELTCON SBTS Baseline V1 migration 016 verification

Migration 016 is additive and intentionally leaves legacy simulator records in place. Run these read-only checks in a non-production database first. The current BHS uniqueness scope remains `(source_system, bhs_uid)`.

## Pre-validation checks

```sql
-- 1–4. Invalid, non-printable, internal-ID, or ETB fallback BHS BagIDs.
SELECT id, source_system, bhs_uid
FROM public.bags
WHERE bhs_uid IS NULL
   OR octet_length(bhs_uid) <> 10
   OR char_length(bhs_uid) <> 10
   OR bhs_uid !~ '^[ -~]{10}$'
   OR btrim(bhs_uid) = ''
   OR bhs_uid = id
   OR bhs_uid ~* '^ETB-';

-- 5. Duplicate BagIDs under the deployed source-system scope.
SELECT source_system, bhs_uid, count(*) AS row_count, array_agg(id ORDER BY id) AS bag_ids
FROM public.bags
GROUP BY source_system, bhs_uid
HAVING count(*) > 1;

-- 6. Invalid IATA baggage Licence Plate Codes.
SELECT id, iata_code FROM public.bags
WHERE iata_code IS NOT NULL AND iata_code !~ '^[0-9]{10}$';

-- 7–9. Invalid line IDs, evaluation pairs, or RFID label barcodes.
SELECT id, bhs_line_id FROM public.bags
WHERE bhs_line_id IS NOT NULL
  AND (octet_length(bhs_line_id) <> 2 OR char_length(bhs_line_id) <> 2
       OR bhs_line_id !~ '^[ -~]{2}$' OR bhs_line_id <> btrim(bhs_line_id));

SELECT id, screening_evaluation_raw, screening_evaluation
FROM public.bags
WHERE NOT (
  (screening_evaluation_raw IS NULL AND screening_evaluation IS NULL)
  OR (screening_evaluation_raw = 'A' AND screening_evaluation = 'ACCEPT')
  OR (screening_evaluation_raw = 'R' AND screening_evaluation = 'REJECT')
  OR (screening_evaluation_raw = 'T' AND screening_evaluation = 'TIMEOUT')
  OR (screening_evaluation_raw = 'N' AND screening_evaluation = 'NO_DECISION')
  OR (screening_evaluation_raw = '?' AND screening_evaluation = 'MISTRACK')
);

SELECT id, rfid_tag_barcode FROM public.bags
WHERE rfid_tag_barcode IS NOT NULL
  AND (btrim(rfid_tag_barcode) = '' OR char_length(rfid_tag_barcode) > 128
       OR rfid_tag_barcode ~ '[[:cntrl:]]');

-- 10. Rows that prevent validating the strict baseline constraints.
SELECT id, source_system, bhs_uid, bhs_line_id, screening_evaluation_raw, screening_evaluation
FROM public.bags
WHERE screening_evaluation_raw IS NOT NULL
  AND (octet_length(bhs_uid) <> 10 OR char_length(bhs_uid) <> 10
       OR bhs_uid !~ '^[ -~]{10}$' OR btrim(bhs_uid) = ''
       OR bhs_uid = id OR bhs_uid ~* '^ETB-');

-- 11–12. Applied migration history, when managed by Supabase.
SELECT version, name FROM supabase_migrations.schema_migrations
WHERE version BETWEEN '001' AND '016'
ORDER BY version;
```

## Later constraint validation

Only validate after the corresponding checks return no rows:

```sql
ALTER TABLE public.bags VALIDATE CONSTRAINT bags_beltcon_sbts_bhs_uid_format;
ALTER TABLE public.bags VALIDATE CONSTRAINT bags_beltcon_sbts_bhs_line_id_format;
ALTER TABLE public.bags VALIDATE CONSTRAINT bags_beltcon_sbts_screening_evaluation_pair;
ALTER TABLE public.bags VALIDATE CONSTRAINT bags_beltcon_sbts_iata_lpc_format;
ALTER TABLE public.bags VALIDATE CONSTRAINT bags_beltcon_sbts_rfid_tag_barcode_format;
ALTER TABLE public.screening_integration_events VALIDATE CONSTRAINT screening_events_beltcon_sbts_message_type;
ALTER TABLE public.screening_integration_events VALIDATE CONSTRAINT screening_events_beltcon_sbts_message_direction;
ALTER TABLE public.screening_integration_events VALIDATE CONSTRAINT screening_events_beltcon_sbts_protocol_name;
ALTER TABLE public.screening_integration_events VALIDATE CONSTRAINT screening_events_beltcon_sbts_evaluation_pair;
ALTER TABLE public.screening_integration_events VALIDATE CONSTRAINT screening_events_beltcon_sbts_acknowledgement;
ALTER TABLE public.screening_integration_events VALIDATE CONSTRAINT screening_events_beltcon_sbts_acknowledged_at;
```

## Rollback guidance

This migration has no automatic rollback because dropping columns after Phase 3 would destroy operational data. Before Phase 3, a reviewed rollback may drop the `bags_beltcon_sbts_*` and `screening_events_beltcon_sbts_*` constraints, the `idx_bags_beltcon_sbts_tagging_queue`, `idx_bags_rfid_tag_barcode`, `idx_screening_events_bhs_message_fingerprint`, and `idx_screening_events_beltcon_sbts_lookup` indexes, and then the newly added columns. Do not drop `bhs_uid`, `iata_code`, `epc`, existing source/BHS or EPC indexes, or any pre-016 object.

Never fabricate replacement BHS BagIDs. Any repair must be based on the verified upstream BHS record and separately reviewed.
