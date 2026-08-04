import { z } from "zod";

export const READER_ZONES = [
  "TAGGING",
  "RECLAIM",
  "CUSTOMS_EXIT",
  "RECHECK",
  "WASHROOM",
  "EMPLOYEE_EXIT",
  "EMERGENCY_EXIT",
  "LOST_AND_FOUND",
  "CORRIDOR",
  "OTHER",
] as const;

export const readerHealthSchema = z.enum([
  "UNKNOWN",
  "STARTING",
  "ONLINE",
  "DEGRADED",
  "OFFLINE",
  "MISCONFIGURED",
  "DISABLED",
  "SIMULATED",
]);
export type ReaderHealth = z.infer<typeof readerHealthSchema>;

export const readerAdapterTypeSchema = z.enum([
  "SIMULATED",
  "UNAVAILABLE_PHYSICAL",
  "THINGMAGIC_IZAR",
  "ZEBRA_FX9600",
]);
export type ReaderAdapterType = z.infer<typeof readerAdapterTypeSchema>;

function hasControlCharacters(value: string) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !hasControlCharacters(value), "Control characters are not allowed")
    .optional()
    .transform((value) => value || undefined);

const hostText = optionalText(255);

export const readerConfigurationInputSchema = z
  .object({
    readerCode: z
      .string()
      .trim()
      .min(1, "Reader code is required")
      .max(80)
      .refine((value) => !hasControlCharacters(value), "Control characters are not allowed"),
    name: z
      .string()
      .trim()
      .min(1, "Reader name is required")
      .max(160)
      .refine((value) => !hasControlCharacters(value), "Control characters are not allowed"),
    zone: z.enum(READER_ZONES),
    vendor: optionalText(120),
    model: optionalText(120),
    adapterType: readerAdapterTypeSchema,
    host: hostText,
    enabled: z.boolean(),
  })
  .strict();

export const createReaderConfigurationSchema = readerConfigurationInputSchema;

export const updateReaderConfigurationSchema = readerConfigurationInputSchema.extend({
  expectedVersion: z.number().int().min(1),
});

export const setReaderEnabledSchema = z
  .object({
    enabled: z.boolean(),
    expectedVersion: z.number().int().min(1),
  })
  .strict();

export type CreateReaderConfigurationInput = z.infer<typeof createReaderConfigurationSchema>;
export type UpdateReaderConfigurationInput = z.infer<typeof updateReaderConfigurationSchema>;
export type SetReaderEnabledInput = z.infer<typeof setReaderEnabledSchema>;

export const readerListFiltersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((value) => [10, 25, 50, 100].includes(value))
    .default(25),
  search: optionalText(120),
  status: readerHealthSchema.optional(),
  enabled: z.coerce.boolean().optional(),
  zone: z.enum(READER_ZONES).optional(),
  sort: z.enum(["readerCode", "name", "healthStatus", "lastHeartbeatAt"]).default("readerCode"),
  direction: z.enum(["asc", "desc"]).default("asc"),
});
export type ReaderListFilters = z.infer<typeof readerListFiltersSchema>;

export const updateReaderSchema = updateReaderConfigurationSchema;
export type UpdateReaderInput = UpdateReaderConfigurationInput;

export const createReaderSchema = createReaderConfigurationSchema;
export type CreateReaderInput = CreateReaderConfigurationInput;

export const updateAntennaSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Antenna name is required")
    .max(160)
    .refine((value) => !hasControlCharacters(value), "Control characters are not allowed"),
  zoneCode: z.enum(READER_ZONES),
  direction: z.enum(["INBOUND", "OUTBOUND", "BIDIRECTIONAL", "UNKNOWN"]).optional(),
  enabled: z.boolean(),
  transmitPowerDbm: z.number().min(0).max(40).nullable(),
  expectedVersion: z.number().int().min(1),
  reason: z.string().trim().min(3).max(500),
});
export type UpdateAntennaInput = z.infer<typeof updateAntennaSchema>;

export interface ReaderSummary {
  id: string;
  readerCode: string;
  siteId: string;
  name: string;
  zone: (typeof READER_ZONES)[number];
  model: string | null;
  vendor: string | null;
  adapterType: ReaderAdapterType;
  host: string | null;
  enabled: boolean;
  healthStatus: ReaderHealth;
  calculatedHealth: ReaderHealth;
  lastHeartbeatAt: string | null;
  lastEventAt: string | null;
  configurationVersion: number;
  createdAt: string | null;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  firmwareVersion: string | null;
  configuredStatus: string | null;
  lastSeenAt: string | null;
  lastReadAt: string | null;
  antennaCount: number;
  activeAntennaCount: number;
  mappedZones: string[];
  version: number;
}

export interface ReaderAntennaDetail {
  id: string;
  port: number;
  name: string;
  zoneCode: (typeof READER_ZONES)[number];
  direction: string | null;
  enabled: boolean;
  transmitPowerDbm: number | null;
  lastReadAt: string | null;
  version: number;
}

export interface ReaderDetail extends ReaderSummary {
  antennas: ReaderAntennaDetail[];
  activity: {
    readsLastHour: number;
    readsLast24Hours: number;
    uniqueEpcsLast24Hours: number;
    unassignedEpcsLast24Hours: number;
    processingFailuresLast24Hours: number;
  };
  healthBasis: "RFID_ACTIVITY" | "NO_AUTHORITATIVE_HEALTH_DATA";
}

export interface ReaderListResponse {
  items: ReaderSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  dataLimitations: string[];
}
