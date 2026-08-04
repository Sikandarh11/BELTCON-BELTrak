/**
 * BELTCON SBTS Baseline V1 semantic contract constants.
 *
 * These values intentionally describe the application contract, not a PLC or
 * serial wire format. Transport-specific padding and byte values belong to
 * future adapters.
 */

export const BELTCON_SBTS_BASELINE_VERSION = 1 as const;

export const BHS_BAG_MESSAGE_TYPE_V1 = 2001 as const;
export const BHS_ACKNOWLEDGEMENT_MESSAGE_TYPE_V1 = 2002 as const;

export const BHS_LINE_ID_LENGTH = 2 as const;
export const BHS_UID_LENGTH = 10 as const;
export const IATA_LPC_LENGTH = 10 as const;

/** Semantic new-message trigger used by the BHS integration API, not PLC framing. */
export const BHS_NEW_MESSAGE_TRIGGER = 1 as const;
export const ACKNOWLEDGEMENT_TIMING = "AFTER_DURABLE_COMMIT" as const;

export const RAW_SCREENING_EVALUATIONS = ["A", "R", "T", "N", "?"] as const;

export const SCREENING_EVALUATIONS = [
  "ACCEPT",
  "REJECT",
  "TIMEOUT",
  "NO_DECISION",
  "MISTRACK",
] as const;

export const TAGGING_ELIGIBLE_EVALUATIONS = [
  "REJECT",
  "TIMEOUT",
  "NO_DECISION",
  "MISTRACK",
] as const;

export const BHS_MESSAGE_PROCESSING_OUTCOMES = [
  "ACCEPTED",
  "DUPLICATE",
  "REJECTED",
  "FAILED",
] as const;

export const HBSS_RECALL_STATUSES = [
  "PENDING",
  "REQUEST_SENT",
  "FAILED",
  "UNAVAILABLE",
  "SIMULATED",
  "TIMED_OUT",
  "CANCELLED",
] as const;

export const BELTCON_SBTS_BASELINE_FEATURES = [
  "FEATURE_BELTCON_SBTS_BASELINE_V1",
  "FEATURE_LEGACY_SCREENING_COMPATIBILITY",
  "FEATURE_INTERNAL_XRAY_VIEWER",
  "FEATURE_ADVANCED_RFID_ZONES",
  "FEATURE_THREAT_CLASSIFICATION",
  "FEATURE_FLIGHT_INTEGRATION",
  "FEATURE_BHS_SIMULATOR",
  "FEATURE_RFID_SIMULATOR",
  "FEATURE_HBSS_SIMULATOR",
  "FEATURE_BHS_PROFINET_ADAPTER",
  "FEATURE_HBSS_RS232_ADAPTER",
] as const;
