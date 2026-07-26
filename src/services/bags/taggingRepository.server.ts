import "@tanstack/react-start/server-only";

import { z } from "zod";

import { rowStatusToBag } from "@/services/bagPersistenceMappings";
import { getXrayAdminClient } from "@/services/xray/xraySupabase.server";
import type { TaggingBag, TaggingXrayStatus } from "@/types/tagging";
import { TaggingPersistenceError } from "./taggingErrors";

const bagRowSchema = z.object({
  id: z.string().min(1),
  source_system: z.string().min(1),
  bhs_uid: z.string().min(1),
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
  flagged_at: z.string().nullable(),
  tagged_at: z.string().nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});

const xraySummaryRowSchema = z.object({
  bag_id: z.string().min(1),
  status: z.enum(["PENDING", "AVAILABLE", "FAILED", "NOT_FOUND", "ARCHIVED"]),
  images: z.array(z.unknown()),
  received_at: z.string(),
  created_at: z.string(),
});

const atomicResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ENCODED"),
    bag: bagRowSchema,
  }),
  z.object({
    status: z.enum([
      "INVALID_BAG_ID",
      "INVALID_EPC",
      "BAG_NOT_FOUND",
      "ALREADY_TAGGED",
      "DUPLICATE_EPC",
    ]),
    errorMessage: z.string().optional(),
  }),
]);

type BagRow = z.infer<typeof bagRowSchema>;

export type EncodeTagAtomicResult =
  | { status: "ENCODED"; bag: TaggingBag }
  | {
      status:
        | "INVALID_BAG_ID"
        | "INVALID_EPC"
        | "BAG_NOT_FOUND"
        | "ALREADY_TAGGED"
        | "DUPLICATE_EPC";
      errorMessage?: string;
    };

export interface EncodeTagCommand {
  bagId: string;
  epc: string;
  actorId: string;
  canonicalRole: string;
  requestId: string | null;
}

export interface TaggingRepository {
  listPendingTagging(): Promise<TaggingBag[]>;
  encodeTagAtomic(command: EncodeTagCommand): Promise<EncodeTagAtomicResult>;
}

interface XraySummary {
  status: TaggingXrayStatus;
  viewCount: number;
}

const BAG_SELECT = [
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
  "flagged_at",
  "tagged_at",
  "created_at",
  "updated_at",
].join(",");

const NO_XRAY: XraySummary = {
  status: "NOT_REQUESTED",
  viewCount: 0,
};

function parseBagRow(rowInput: unknown): BagRow {
  const parsed = bagRowSchema.safeParse(rowInput);
  if (!parsed.success) {
    throw new TaggingPersistenceError("Stored pending-tagging bag data is invalid", {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export function mapTaggingBag(rowInput: unknown, xray: XraySummary = NO_XRAY): TaggingBag {
  const row = parseBagRow(rowInput);
  const flaggedAt = row.flagged_at ?? row.created_at;
  if (!flaggedAt) {
    throw new TaggingPersistenceError(`Stored bag ${row.id} has no flagged timestamp`);
  }
  const status = rowStatusToBag(row.status);

  return {
    id: row.id,
    sourceSystem: row.source_system,
    bhsUid: row.bhs_uid,
    iataCode: row.iata_code,
    iataOrigin: row.iata_origin,
    flightNo: row.flight,
    passengerName: row.passenger_name,
    threatType: row.threat_type,
    threatLevel: row.threat_level,
    screeningStation: row.screening_station,
    screenedAt: row.screened_at,
    status,
    flaggedAt,
    taggedAt: row.tagged_at,
    epc: row.epc,
    xrayStatus: xray.status,
    xrayViewCount: xray.viewCount,
    rfidState: row.epc ? "ENCODED" : "NOT_ENCODED",
    updatedAt: row.updated_at,
  };
}

async function loadLatestXraySummaries(bagIds: string[]) {
  const summaries = new Map<string, XraySummary>();
  if (bagIds.length === 0) return summaries;

  const { data, error } = await getXrayAdminClient()
    .from("xray_scans")
    .select("bag_id,status,images,received_at,created_at")
    .in("bag_id", bagIds)
    .order("received_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new TaggingPersistenceError("Unable to load pending-tagging X-ray summaries", {
      cause: error,
    });
  }

  for (const rowInput of data ?? []) {
    const parsed = xraySummaryRowSchema.safeParse(rowInput);
    if (!parsed.success) {
      throw new TaggingPersistenceError("Stored X-ray summary data is invalid", {
        cause: parsed.error,
      });
    }
    if (!summaries.has(parsed.data.bag_id)) {
      summaries.set(parsed.data.bag_id, {
        status: parsed.data.status,
        viewCount: parsed.data.images.length,
      });
    }
  }

  return summaries;
}

export const taggingRepository: TaggingRepository = {
  async listPendingTagging() {
    const { data, error } = await getXrayAdminClient()
      .from("bags")
      .select(BAG_SELECT)
      .eq("status", "IDENTIFIED")
      .order("flagged_at", { ascending: true })
      .order("id", { ascending: true });

    if (error) {
      throw new TaggingPersistenceError("Unable to load the pending-tagging queue", {
        cause: error,
      });
    }

    const rows = ((data ?? []) as unknown[]).map(parseBagRow);
    const summaries = await loadLatestXraySummaries(rows.map((row) => String(row.id)));
    return rows.map((row) => mapTaggingBag(row, summaries.get(String(row.id)) ?? NO_XRAY));
  },

  async encodeTagAtomic(command) {
    const { data, error } = await getXrayAdminClient().rpc("encode_bag_tag_v1", {
      p_bag_id: command.bagId,
      p_epc: command.epc,
      p_actor_id: command.actorId,
      p_canonical_role: command.canonicalRole,
      p_request_id: command.requestId,
    });

    if (error) {
      throw new TaggingPersistenceError("RFID encoding transaction failed", {
        cause: error,
      });
    }

    const parsed = atomicResultSchema.safeParse(data);
    if (!parsed.success) {
      throw new TaggingPersistenceError("RFID encoding transaction returned invalid data", {
        cause: parsed.error,
      });
    }

    if (parsed.data.status === "ENCODED") {
      const bag = mapTaggingBag(parsed.data.bag);
      if (bag.status !== "TAGGED" || !bag.epc || !bag.taggedAt) {
        throw new TaggingPersistenceError(
          "RFID encoding transaction did not return a durably tagged bag",
        );
      }
      return {
        status: "ENCODED",
        bag,
      };
    }

    return parsed.data;
  },
};
