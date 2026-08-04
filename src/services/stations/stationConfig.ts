import { z } from "zod";

import { BhsLineIdSchema } from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.schemas";

const stationIdentifier = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._:-]+$/);
const localPath = z.string().trim().min(1).max(1024);

export const bhsTransportTypeSchema = z.enum(["SIMULATED", "LOOPBACK", "PROFINET"]);
export const bhsPhysicalMappingStatusSchema = z.enum([
  "UNCONFIRMED",
  "SIMULATED",
  "VENDOR_APPROVED",
]);
export const bhsAcknowledgementMappingStatusSchema = z.enum([
  "PENDING_VENDOR_CONFIRMATION",
  "VENDOR_APPROVED",
]);

export const taggingStationConfigSchema = z
  .object({
    stationId: stationIdentifier,
    siteId: stationIdentifier,
    allowedLineIds: z.array(BhsLineIdSchema).min(1),
    centralServerUrl: z
      .string()
      .url()
      .refine((value) => /^https?:\/\//.test(value)),
    centralSourceSystem: stationIdentifier,
    transportType: bhsTransportTypeSchema,
    acknowledgementEnabled: z.boolean(),
    acknowledgementReceivedValue: z.number().int().min(0).max(255).nullable(),
    acknowledgementMappingStatus: bhsAcknowledgementMappingStatusSchema,
    acknowledgeQueueCapacityReached: z.boolean().default(false),
    // Local RFID assignment stays disabled until canonical tag reconciliation exists.
    offlineTaggingPolicy: z.literal("DISABLED").default("DISABLED"),
    physicalMappingStatus: bhsPhysicalMappingStatusSchema,
    localPersistencePath: localPath,
    retentionDays: z.number().int().min(1).max(3650).default(90),
    provisioningMode: z.enum(["PRE_ENCODED_TAG", "PRINT_AND_ENCODE"]).default("PRE_ENCODED_TAG"),
    bagPhotoPolicy: z.enum(["REQUIRED", "OPTIONAL", "DISABLED"]).default("REQUIRED"),
    verificationRequiredPreencoded: z.boolean().default(true),
    verificationStableReadCount: z.number().int().min(1).max(100).default(3),
    epcAllowedBitLengths: z
      .array(
        z
          .number()
          .int()
          .min(32)
          .max(512)
          .refine((value) => value % 8 === 0),
      )
      .min(1)
      .default([96]),
    epcCanonicalCase: z.literal("UPPER").default("UPPER"),
    manualBarcodeEntry: z.boolean().default(false),
    manualEpcEntry: z.boolean().default(false),
    inventoryEnabled: z.boolean().default(false),
    taggingSimulationEnabled: z.boolean().default(false),
    rfidTagInputAdapter: z
      .enum(["KEYBOARD_WEDGE", "SIMULATED", "PHYSICAL_UNAVAILABLE"])
      .default("KEYBOARD_WEDGE"),
    rfidEncoderAdapter: z
      .enum(["SIMULATED", "PHYSICAL_UNAVAILABLE"])
      .default("PHYSICAL_UNAVAILABLE"),
    rfidVerificationAdapter: z
      .enum(["SIMULATED", "PHYSICAL_UNAVAILABLE"])
      .default("PHYSICAL_UNAVAILABLE"),
    bagCameraAdapter: z
      .enum(["SIMULATED", "DEVELOPMENT_FILE_UPLOAD", "PHYSICAL_UNAVAILABLE"])
      .default("PHYSICAL_UNAVAILABLE"),
    bagPhotoStorageAdapter: z
      .enum(["SIMULATED", "PHYSICAL_UNAVAILABLE"])
      .default("PHYSICAL_UNAVAILABLE"),
    rfidEncoderLogicalDeviceId: stationIdentifier.default("RFID-ENCODER-UNCONFIGURED"),
    rfidVerifierLogicalDeviceId: stationIdentifier.default("RFID-VERIFIER-UNCONFIGURED"),
    bagCameraLogicalDeviceId: stationIdentifier.default("BAG-CAMERA-UNCONFIGURED"),
    verificationTimeoutMs: z.number().int().min(100).max(60_000).default(5_000),
    encodeTimeoutMs: z.number().int().min(100).max(120_000).default(15_000),
    taggingSessionTtlSeconds: z.number().int().min(60).max(28_800).default(1_800),
    bagPhotoMaxBytes: z.number().int().min(1_024).max(52_428_800).default(10_485_760),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.allowedLineIds).size !== value.allowedLineIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allowedLineIds"],
        message: "Station LineID mappings must be unique",
      });
    }
    if (value.acknowledgementEnabled && value.acknowledgementReceivedValue === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["acknowledgementReceivedValue"],
        message: "An acknowledgement byte is required when acknowledgements are enabled",
      });
    }
    if (value.transportType !== "PROFINET" && value.physicalMappingStatus === "VENDOR_APPROVED") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["physicalMappingStatus"],
        message: "A software transport cannot claim a vendor-approved physical mapping",
      });
    }
    const simulatedAdapterSelected = [
      value.rfidTagInputAdapter,
      value.rfidEncoderAdapter,
      value.rfidVerificationAdapter,
      value.bagCameraAdapter,
      value.bagPhotoStorageAdapter,
    ].includes("SIMULATED");
    if (simulatedAdapterSelected && !value.taggingSimulationEnabled) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["taggingSimulationEnabled"],
        message: "Simulated tagging adapters require trusted simulation enablement",
      });
    }
    if (new Set(value.epcAllowedBitLengths).size !== value.epcAllowedBitLengths.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["epcAllowedBitLengths"],
        message: "Configured EPC bit lengths must be unique",
      });
    }
  });

export type TaggingStationConfig = z.infer<typeof taggingStationConfigSchema>;

export const HBSS_SERIAL_SETTINGS = Object.freeze({
  encoding: "ASCII" as const,
  baudRate: 9600 as const,
  parity: "EVEN" as const,
  dataBits: 8 as const,
  stopBits: 1 as const,
  flowControl: "NONE" as const,
});

export const hbssFramingProfileSchema = z.enum([
  "STX_BAGID_CRLF",
  "ASCII_BAGID_ONLY",
  "VENDOR_CONFIRMED",
]);
export const hbssSerialAdapterTypeSchema = z.enum(["VIRTUAL", "LOOPBACK", "RS232"]);

export const recheckStationConfigSchema = z
  .object({
    stationId: stationIdentifier,
    siteId: stationIdentifier,
    serialBinding: stationIdentifier,
    serialAdapterType: hbssSerialAdapterTypeSchema,
    framingProfile: hbssFramingProfileSchema,
    framingMappingStatus: bhsAcknowledgementMappingStatusSchema,
    localPersistencePath: localPath,
    errorDialogTimeoutMs: z.number().int().min(1).max(60_000).default(5000),
    duplicateScanDebounceMs: z.number().int().min(0).max(60_000).default(1000),
    serialSettings: z
      .object({
        encoding: z.literal("ASCII"),
        baudRate: z.literal(9600),
        parity: z.literal("EVEN"),
        dataBits: z.literal(8),
        stopBits: z.literal(1),
        flowControl: z.literal("NONE"),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.framingProfile === "VENDOR_CONFIRMED" &&
      value.framingMappingStatus !== "VENDOR_APPROVED"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["framingProfile"],
        message: "VENDOR_CONFIRMED is reserved for a vendor-approved framing mapping",
      });
    }
  });

export type RecheckStationConfig = z.infer<typeof recheckStationConfigSchema>;

function booleanValue(value: string | undefined, defaultValue = false) {
  if (value === undefined || value.trim() === "") return defaultValue;
  return value.trim().toLowerCase() === "true";
}

function integerValue(value: string | undefined, defaultValue: number | null) {
  if (value === undefined || value.trim() === "") return defaultValue;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function integerList(value: string | undefined, defaultValue: number[]) {
  if (!value?.trim()) return defaultValue;
  return value.split(",").map((item) => {
    const parsed = Number(item.trim());
    return Number.isInteger(parsed) ? parsed : Number.NaN;
  });
}

/** Reads trusted process configuration. Request/browser input is never accepted here. */
export function readTaggingStationConfig(
  environment: Record<string, string | undefined> = process.env,
): TaggingStationConfig {
  const configuration = taggingStationConfigSchema.parse({
    stationId: environment.BHS_STATION_ID,
    siteId: environment.BHS_STATION_SITE_ID ?? environment.SBTS_SITE_ID,
    allowedLineIds: (environment.BHS_STATION_ALLOWED_LINE_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    centralServerUrl: environment.BHS_STATION_CENTRAL_URL,
    centralSourceSystem: environment.BHS_STATION_SOURCE_SYSTEM,
    transportType: environment.BHS_STATION_TRANSPORT?.trim().toUpperCase(),
    acknowledgementEnabled: booleanValue(environment.BHS_ACK_ENABLED),
    acknowledgementReceivedValue: integerValue(environment.BHS_ACK_RECEIVED_VALUE, null),
    acknowledgementMappingStatus:
      environment.BHS_ACK_MAPPING_STATUS ?? "PENDING_VENDOR_CONFIRMATION",
    acknowledgeQueueCapacityReached: booleanValue(environment.BHS_ACK_QUEUE_CAPACITY_REACHED),
    offlineTaggingPolicy: environment.BHS_OFFLINE_TAGGING_POLICY ?? "DISABLED",
    physicalMappingStatus: environment.BHS_PHYSICAL_MAPPING_STATUS ?? "UNCONFIRMED",
    localPersistencePath: environment.BHS_STATION_LOCAL_DB_PATH,
    retentionDays: integerValue(environment.BHS_STATION_RETENTION_DAYS, 90),
    provisioningMode: environment.TAGGING_PROVISIONING_MODE ?? "PRE_ENCODED_TAG",
    bagPhotoPolicy: environment.BAG_PHOTO_POLICY ?? "REQUIRED",
    verificationRequiredPreencoded: booleanValue(
      environment.RFID_VERIFICATION_REQUIRED_PREENCODED,
      true,
    ),
    verificationStableReadCount: integerValue(environment.RFID_VERIFICATION_STABLE_READ_COUNT, 3),
    epcAllowedBitLengths: integerList(environment.RFID_EPC_ALLOWED_BIT_LENGTHS, [96]),
    epcCanonicalCase: environment.RFID_EPC_CANONICAL_CASE ?? "UPPER",
    manualBarcodeEntry: booleanValue(environment.TAGGING_MANUAL_BARCODE_ENTRY_ENABLED),
    manualEpcEntry: booleanValue(environment.TAGGING_MANUAL_EPC_ENTRY_ENABLED),
    inventoryEnabled: booleanValue(environment.TAGGING_TAG_INVENTORY_ENABLED),
    taggingSimulationEnabled: booleanValue(environment.TAGGING_SIMULATION_ENABLED),
    rfidTagInputAdapter: environment.RFID_TAG_INPUT_ADAPTER ?? "KEYBOARD_WEDGE",
    rfidEncoderAdapter: environment.RFID_ENCODER_ADAPTER ?? "PHYSICAL_UNAVAILABLE",
    rfidVerificationAdapter: environment.RFID_VERIFICATION_ADAPTER ?? "PHYSICAL_UNAVAILABLE",
    bagCameraAdapter: environment.BAG_CAMERA_ADAPTER ?? "PHYSICAL_UNAVAILABLE",
    bagPhotoStorageAdapter: environment.BAG_PHOTO_STORAGE_ADAPTER ?? "PHYSICAL_UNAVAILABLE",
    rfidEncoderLogicalDeviceId:
      environment.RFID_ENCODER_LOGICAL_DEVICE_ID ?? "RFID-ENCODER-UNCONFIGURED",
    rfidVerifierLogicalDeviceId:
      environment.RFID_VERIFIER_LOGICAL_DEVICE_ID ?? "RFID-VERIFIER-UNCONFIGURED",
    bagCameraLogicalDeviceId: environment.BAG_CAMERA_LOGICAL_DEVICE_ID ?? "BAG-CAMERA-UNCONFIGURED",
    verificationTimeoutMs: integerValue(environment.RFID_VERIFICATION_TIMEOUT_MS, 5_000),
    encodeTimeoutMs: integerValue(environment.RFID_ENCODE_TIMEOUT_MS, 15_000),
    taggingSessionTtlSeconds: integerValue(environment.TAGGING_SESSION_TTL_SECONDS, 1_800),
    bagPhotoMaxBytes: integerValue(environment.BAG_PHOTO_MAX_BYTES, 10_485_760),
  });
  if (
    environment.NODE_ENV?.trim().toLowerCase() === "production" &&
    configuration.taggingSimulationEnabled
  ) {
    throw new Error("TAGGING_SIMULATOR_PRODUCTION_DISABLED");
  }
  return configuration;
}

export function readRecheckStationConfig(
  environment: Record<string, string | undefined> = process.env,
): RecheckStationConfig {
  return recheckStationConfigSchema.parse({
    stationId: environment.HBSS_RECHECK_STATION_ID,
    siteId: environment.HBSS_RECHECK_SITE_ID ?? environment.SBTS_SITE_ID,
    serialBinding: environment.HBSS_SERIAL_BINDING,
    serialAdapterType: environment.HBSS_SERIAL_ADAPTER?.trim().toUpperCase(),
    framingProfile: environment.HBSS_BID_FRAMING_PROFILE ?? "STX_BAGID_CRLF",
    framingMappingStatus: environment.HBSS_BID_MAPPING_STATUS ?? "PENDING_VENDOR_CONFIRMATION",
    localPersistencePath: environment.HBSS_RECHECK_LOCAL_DB_PATH,
    errorDialogTimeoutMs: integerValue(environment.HBSS_SERIAL_ERROR_DIALOG_TIMEOUT_MS, 5000),
    duplicateScanDebounceMs: integerValue(environment.HBSS_SCAN_DEBOUNCE_MS, 1000),
    serialSettings: HBSS_SERIAL_SETTINGS,
  });
}

export function validateUniqueStationRouting(configurations: TaggingStationConfig[]) {
  const owners = new Map<string, string>();
  for (const configuration of configurations) {
    for (const lineId of configuration.allowedLineIds) {
      const key = `${configuration.siteId}:${lineId}`;
      const owner = owners.get(key);
      if (owner && owner !== configuration.stationId) {
        throw new Error(`DUPLICATE_STATION_LINE_MAPPING:${key}`);
      }
      owners.set(key, configuration.stationId);
    }
  }
  return owners;
}
