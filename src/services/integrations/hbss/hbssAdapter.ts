import type { HbssScanResult } from "@/types/xray";

export interface HbssAdapter {
  readonly name: string;

  getScanByBhsUid(bhsUid: string): Promise<HbssScanResult | null>;

  healthCheck(): Promise<{
    healthy: boolean;
    message?: string;
  }>;
}
