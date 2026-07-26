import type { ScreeningSuspectEvent } from "@/types/screening";

/**
 * Vendor adapters normalize their input before handing it to the core
 * ingestion service. The core service never accepts a vendor payload.
 */
export interface ScreeningAdapter {
  readonly sourceSystem: string;
  normalizeSuspectEvent(payload: unknown): ScreeningSuspectEvent;
}
