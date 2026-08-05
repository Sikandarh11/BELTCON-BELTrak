import "@tanstack/react-start/server-only";

import { getSupabaseAdminClient } from "@/services/supabaseAdmin.server";

export interface CustomsExitAlarmResult {
  outcome:
    | "ALARM_CREATED"
    | "ALARM_ALREADY_ACTIVE"
    | "NOT_CUSTOMS_EXIT"
    | "UNASSIGNED_EPC"
    | "TAG_NOT_ACTIVE"
    | "BAG_NOT_ALARM_ELIGIBLE";
  detectionId: string;
  bagId: string | null;
  alarmId: string | null;
  severity: string | null;
  alarmEligible: boolean;
  resolution?: Record<string, unknown>;
}

export interface CustomsExitAlarmRepository {
  processByDetectionId(detectionId: string): Promise<CustomsExitAlarmResult>;
}

export const customsExitAlarmRepository: CustomsExitAlarmRepository = {
  async processByDetectionId(detectionId) {
    const { data, error } = await getSupabaseAdminClient().rpc("process_beltcon_customs_exit_alarm_v1", {
      p_detection_id: detectionId,
    });
    if (error) throw error;
    return data as CustomsExitAlarmResult;
  },
};
