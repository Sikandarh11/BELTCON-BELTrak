import "@tanstack/react-start/server-only";

import { z } from "zod";

import { getXrayAdminClient } from "@/services/xray/xraySupabase.server";

import {
  RfidActiveBagResolutionSchema,
  type RfidActiveBagResolution,
} from "./rfidActiveBagResolutionSchemas";

const rowSchema = z
  .object({
    outcome: z.string(),
    detectionId: z.string(),
    epc: z.string(),
    tagAssignmentId: z.string().nullable(),
    bagId: z.string().nullable(),
    assignmentStatus: z.string().nullable(),
    bagStatus: z.string().nullable(),
    alarmEligible: z.boolean(),
  })
  .strict();

export interface RfidActiveBagResolutionRepository {
  resolveByDetectionId(detectionId: string): Promise<RfidActiveBagResolution>;
}

export const rfidActiveBagResolutionRepository: RfidActiveBagResolutionRepository = {
  async resolveByDetectionId(detectionId) {
    const { data, error } = await getXrayAdminClient().rpc(
      "resolve_beltcon_active_bag_for_detection_v1",
      {
        p_detection_id: detectionId,
      },
    );

    if (error) {
      throw error;
    }

    const parsed = rowSchema.safeParse(data);
    if (!parsed.success) {
      throw parsed.error;
    }

    return RfidActiveBagResolutionSchema.parse(parsed.data);
  },
};
