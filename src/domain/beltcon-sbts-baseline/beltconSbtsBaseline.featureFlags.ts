import { BELTCON_SBTS_BASELINE_FEATURES } from "./beltconSbtsBaseline.constants";

export type BeltconSbtsBaselineFeature = (typeof BELTCON_SBTS_BASELINE_FEATURES)[number];
export type BeltconSbtsFeatureEnvironment = "development" | "test" | "production";
export type BeltconSbtsBaselineFeatureFlags = Record<BeltconSbtsBaselineFeature, boolean>;

const DEVELOPMENT_DEFAULTS: BeltconSbtsBaselineFeatureFlags = {
  FEATURE_BELTCON_SBTS_BASELINE_V1: true,
  FEATURE_LEGACY_SCREENING_COMPATIBILITY: true,
  FEATURE_INTERNAL_XRAY_VIEWER: true,
  FEATURE_ADVANCED_RFID_ZONES: false,
  FEATURE_THREAT_CLASSIFICATION: false,
  FEATURE_FLIGHT_INTEGRATION: false,
  FEATURE_BHS_SIMULATOR: true,
  FEATURE_RFID_SIMULATOR: true,
  FEATURE_HBSS_SIMULATOR: true,
  FEATURE_BHS_PROFINET_ADAPTER: false,
  FEATURE_HBSS_RS232_ADAPTER: false,
};

const PRODUCTION_DEFAULTS: BeltconSbtsBaselineFeatureFlags = {
  ...DEVELOPMENT_DEFAULTS,
  FEATURE_LEGACY_SCREENING_COMPATIBILITY: true,
  FEATURE_BHS_SIMULATOR: false,
  FEATURE_RFID_SIMULATOR: false,
  FEATURE_HBSS_SIMULATOR: false,
  FEATURE_BHS_PROFINET_ADAPTER: false,
  FEATURE_HBSS_RS232_ADAPTER: false,
};

/**
 * Pure defaults only. Workspace mode, including Developer, is intentionally
 * not an input: flags never grant authority or enable hardware by role.
 */
export function getBeltconSbtsBaselineFeatureFlags(
  environment: BeltconSbtsFeatureEnvironment,
): BeltconSbtsBaselineFeatureFlags {
  return {
    ...(environment === "production" ? PRODUCTION_DEFAULTS : DEVELOPMENT_DEFAULTS),
  };
}

export function isBeltconSbtsBaselineFeatureEnabled(
  flag: BeltconSbtsBaselineFeature,
  environment: BeltconSbtsFeatureEnvironment,
): boolean {
  return getBeltconSbtsBaselineFeatureFlags(environment)[flag];
}
