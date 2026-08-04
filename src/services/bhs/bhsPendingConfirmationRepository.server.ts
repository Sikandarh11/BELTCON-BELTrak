import "@tanstack/react-start/server-only";

import { z } from "zod";

import { BhsUidSchema } from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.schemas";
import { getXrayAdminClient } from "@/services/xray/xraySupabase.server";
import { BhsMessagePersistenceError } from "./bhsMessageErrors";

const pendingBagRowSchema = z.object({
  id: z.string().min(1),
  bhs_uid: BhsUidSchema,
  screening_evaluation_raw: z.enum(["R", "T", "N", "?"]),
  screening_evaluation: z.enum(["REJECT", "TIMEOUT", "NO_DECISION", "MISTRACK"]),
  screening_station: z.string().nullable(),
  screened_at: z.string().nullable(),
  threat_type: z.string().nullable(),
  threat_level: z.number().int().nullable(),
  bhs_confirmation_status: z.literal("AWAITING_BHS_CONFIRMATION"),
  status: z.string().min(1),
  epc: z.string().nullable(),
  rfid_tag_barcode: z.string().nullable(),
});

const xrayStatusSchema = z.object({
  bag_id: z.string().min(1),
  status: z.enum(["AVAILABLE", "PENDING", "FAILED", "NOT_FOUND", "ARCHIVED"]),
  received_at: z.string(),
});

export interface PendingBhsConfirmation {
  bagId: string;
  bhsUid: string;
  screeningEvaluationRaw: "R" | "T" | "N" | "?";
  screeningEvaluation: "REJECT" | "TIMEOUT" | "NO_DECISION" | "MISTRACK";
  screeningStation: string | null;
  screenedAt: string | null;
  threatSummary: string | null;
  xrayAvailable: boolean;
  confirmationStatus: "AWAITING_BHS_CONFIRMATION";
}

export interface BhsPendingConfirmationRepository {
  listPending(): Promise<PendingBhsConfirmation[]>;
  getPending(bagId: string): Promise<PendingBhsConfirmation | null>;
}

const PENDING_SELECT = [
  "id",
  "bhs_uid",
  "screening_evaluation_raw",
  "screening_evaluation",
  "screening_station",
  "screened_at",
  "threat_type",
  "threat_level",
  "bhs_confirmation_status",
  "status",
  "epc",
  "rfid_tag_barcode",
].join(",");

export function parsePendingBhsConfirmationRow(
  rowInput: unknown,
  xrayAvailable: boolean,
): PendingBhsConfirmation | null {
  const parsed = pendingBagRowSchema.safeParse(rowInput);
  if (!parsed.success) return null;
  const row = parsed.data;
  return {
    bagId: row.id,
    bhsUid: row.bhs_uid,
    screeningEvaluationRaw: row.screening_evaluation_raw,
    screeningEvaluation: row.screening_evaluation,
    screeningStation: row.screening_station,
    screenedAt: row.screened_at,
    threatSummary:
      row.threat_type && row.threat_level
        ? `${row.threat_type} · Level ${row.threat_level}`
        : row.threat_type,
    xrayAvailable,
    confirmationStatus: row.bhs_confirmation_status,
  };
}

async function loadXrayAvailability(bagIds: string[]) {
  const available = new Set<string>();
  if (bagIds.length === 0) return available;
  const { data, error } = await getXrayAdminClient()
    .from("xray_scans")
    .select("bag_id,status,received_at")
    .in("bag_id", bagIds)
    .order("received_at", { ascending: false });
  if (error)
    throw new BhsMessagePersistenceError("Unable to load BHS confirmation X-ray summaries", {
      cause: error,
    });
  for (const rowInput of data ?? []) {
    const parsed = xrayStatusSchema.safeParse(rowInput);
    if (!parsed.success)
      throw new BhsMessagePersistenceError("Stored X-ray summary data is invalid", {
        cause: parsed.error,
      });
    if (parsed.data.status === "AVAILABLE") available.add(parsed.data.bag_id);
  }
  return available;
}

async function loadRows(bagId?: string) {
  let query = getXrayAdminClient()
    .from("bags")
    .select(PENDING_SELECT)
    .eq("status", "IDENTIFIED")
    .eq("bhs_confirmation_status", "AWAITING_BHS_CONFIRMATION")
    .not("screening_received_at", "is", null)
    .is("epc", null)
    .is("rfid_tag_barcode", null)
    .order("screening_received_at", { ascending: true })
    .order("id", { ascending: true });
  if (bagId) query = query.eq("id", bagId);
  const { data, error } = await query;
  if (error)
    throw new BhsMessagePersistenceError("Unable to load pending BHS confirmations", {
      cause: error,
    });
  return (data ?? []) as unknown[];
}

export const bhsPendingConfirmationRepository: BhsPendingConfirmationRepository = {
  async listPending() {
    const rows = await loadRows();
    const validRows = rows.flatMap((row) => {
      const parsed = pendingBagRowSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    });
    const availability = await loadXrayAvailability(validRows.map((row) => row.id));
    return validRows.flatMap((row) => {
      const mapped = parsePendingBhsConfirmationRow(row, availability.has(row.id));
      return mapped ? [mapped] : [];
    });
  },
  async getPending(bagId) {
    const rows = await loadRows(bagId);
    if (rows.length === 0) return null;
    const parsed = pendingBagRowSchema.safeParse(rows[0]);
    if (!parsed.success) return null;
    const availability = await loadXrayAvailability([parsed.data.id]);
    return parsePendingBhsConfirmationRow(parsed.data, availability.has(parsed.data.id));
  },
};
