import "@tanstack/react-start/server-only";

import { z } from "zod";

import { bagStatusToRow, rowToBag, type BagRow } from "@/services/bagPersistenceMappings";
import { getXrayAdminClient } from "@/services/xray/xraySupabase.server";
import { isRfidTrackableBag, RFID_MOVEMENT_STATUSES, type RfidTrackableBag } from "@/types/rfid";

const rfidTrackableBagRowSchema = z.object({
  id: z.string().min(1),
  source_system: z.string().nullable(),
  bhs_uid: z.string().nullable(),
  iata_code: z.string().nullable(),
  iata_origin: z.string().nullable(),
  epc: z.string().nullable(),
  flight: z.string().min(1),
  passenger_name: z.string().nullable(),
  threat_type: z.string().nullable(),
  threat_level: z.number().int().min(1).max(5).nullable(),
  screening_station: z.string().nullable(),
  screened_at: z.string().nullable(),
  status: z.string().min(1),
  current_zone: z.string().nullable(),
  flagged_at: z.string().nullable(),
  tagged_at: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});

const RFID_TRACKABLE_BAG_SELECT = [
  "id",
  "source_system",
  "bhs_uid",
  "iata_code",
  "iata_origin",
  "epc",
  "flight",
  "passenger_name",
  "threat_type",
  "threat_level",
  "screening_station",
  "screened_at",
  "status",
  "current_zone",
  "flagged_at",
  "tagged_at",
  "notes",
  "created_at",
  "updated_at",
].join(",");

export function mapRfidTrackableBag(rowInput: unknown): RfidTrackableBag {
  const parsed = rfidTrackableBagRowSchema.parse(rowInput);
  const bag = rowToBag(parsed as BagRow);

  if (!isRfidTrackableBag(bag)) {
    throw new Error(`Stored bag ${bag.id} is not eligible for RFID movement`);
  }

  return bag;
}

export async function listRfidTrackableBags(): Promise<RfidTrackableBag[]> {
  const trackableDatabaseStatuses = RFID_MOVEMENT_STATUSES.map(bagStatusToRow);
  const { data, error } = await getXrayAdminClient()
    .from("bags")
    .select(RFID_TRACKABLE_BAG_SELECT)
    .in("status", trackableDatabaseStatuses)
    .not("epc", "is", null)
    .neq("epc", "")
    .order("tagged_at", { ascending: false })
    .order("id", { ascending: true });

  if (error) {
    throw new Error("Unable to load RFID-trackable bags", { cause: error });
  }

  return ((data ?? []) as unknown[]).map(mapRfidTrackableBag).filter(isRfidTrackableBag);
}
