import "@tanstack/react-start/server-only";

import { z } from "zod";

import { XrayConflictError, XrayPersistenceError } from "./xrayErrors";
import { getXrayAdminClient } from "./xraySupabase.server";

const xrayBagRowSchema = z.object({
  id: z.string().min(1),
  bhs_uid: z.string().nullable(),
});

export interface XrayBagReference {
  id: string;
  bhsUid: string | null;
}

export interface XrayBagRepository {
  findById(bagId: string): Promise<XrayBagReference | null>;
  findByBhsUid(bhsUid: string): Promise<XrayBagReference | null>;
}

function mapBagRow(row: unknown): XrayBagReference {
  const parsed = xrayBagRowSchema.safeParse(row);
  if (!parsed.success) {
    throw new XrayPersistenceError("Stored bag data is invalid", {
      cause: parsed.error,
    });
  }

  return {
    id: parsed.data.id,
    bhsUid: parsed.data.bhs_uid,
  };
}

export const xrayBagRepository: XrayBagRepository = {
  async findById(bagId) {
    const { data, error } = await getXrayAdminClient()
      .from("bags")
      .select("id,bhs_uid")
      .eq("id", bagId)
      .maybeSingle();

    if (error) {
      throw new XrayPersistenceError("Unable to load bag data", { cause: error });
    }

    return data ? mapBagRow(data) : null;
  },

  async findByBhsUid(bhsUid) {
    const { data, error } = await getXrayAdminClient()
      .from("bags")
      .select("id,bhs_uid")
      .eq("bhs_uid", bhsUid)
      .limit(2);

    if (error) {
      throw new XrayPersistenceError("Unable to load bag data", { cause: error });
    }

    if (!data || data.length === 0) {
      return null;
    }

    if (data.length > 1) {
      throw new XrayConflictError("Multiple bags match this BHS UID");
    }

    return mapBagRow(data[0]);
  },
};
