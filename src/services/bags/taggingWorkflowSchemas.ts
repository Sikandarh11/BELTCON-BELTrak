import { createHash } from "node:crypto";
import { z } from "zod";

import type { TagInputKind } from "@/types/taggingWorkflow";
import { TaggingValidationError } from "./taggingErrors";

const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;
const HEX_EPC = /^[0-9A-Fa-f]+$/;

export interface EpcValidationConfiguration {
  allowedBitLengths: readonly number[];
  canonicalCase: "UPPER";
}

export interface BarcodeValidationConfiguration {
  maximumLength?: number;
  caseSensitive?: boolean;
}

export function canonicalRequestHash(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (!input || typeof input !== "object") return input;
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]),
    );
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

export function stripScannerTerminator(raw: string): string {
  if (raw.endsWith("\r\n")) return raw.slice(0, -2);
  if (raw.endsWith("\r") || raw.endsWith("\n") || raw.endsWith("\t")) return raw.slice(0, -1);
  return raw;
}

export function containsControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

export function normalizeTagBarcode(
  raw: string,
  kind: TagInputKind,
  configuration: BarcodeValidationConfiguration = {},
): string {
  const barcode = kind === "SCANNER" || kind === "SIMULATED" ? stripScannerTerminator(raw) : raw;
  const maximumLength = configuration.maximumLength ?? 128;
  if (!barcode || barcode.trim().length === 0) {
    throw new TaggingValidationError("RFID tag barcode is required");
  }
  if (barcode.length > maximumLength) {
    throw new TaggingValidationError(
      `RFID tag barcode must not exceed ${maximumLength} characters`,
    );
  }
  if (barcode !== barcode.trim()) {
    throw new TaggingValidationError("RFID tag barcode cannot have leading or trailing whitespace");
  }
  if (!PRINTABLE_ASCII.test(barcode) || containsControlCharacters(barcode)) {
    throw new TaggingValidationError("RFID tag barcode contains unsupported control characters");
  }
  return configuration.caseSensitive === false ? barcode.toUpperCase() : barcode;
}

export function normalizeHexEpc(raw: string, configuration: EpcValidationConfiguration): string {
  if (!raw || raw !== raw.trim() || !HEX_EPC.test(raw) || raw.length % 2 !== 0) {
    throw new TaggingValidationError(
      "EPC must be an even-length hexadecimal value without separators",
    );
  }
  const bitLength = raw.length * 4;
  if (!configuration.allowedBitLengths.includes(bitLength)) {
    throw new TaggingValidationError(`EPC bit length ${bitLength} is not enabled for this station`);
  }
  return raw.toUpperCase();
}

export function normalizeOptionalIataLpc(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = stripScannerTerminator(raw);
  if (!/^\d{10}$/.test(value)) {
    throw new TaggingValidationError("IATA Licence Plate Code must be 10 numeric digits");
  }
  return value;
}

export const taggingIdentityInputSchema = z
  .object({
    sessionId: z.string().uuid(),
    barcode: z.string().max(256),
    expectedEpc: z.string().max(256).nullable().optional(),
    inputKind: z.enum(["SCANNER", "MANUAL", "SIMULATED"]),
    reason: z.string().trim().min(3).max(512).nullable().optional(),
    expectedVersion: z.number().int().min(1),
    requestId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/),
  })
  .strict();

export const photoMetadataInputSchema = z
  .object({
    originalMimeType: z.enum(["image/jpeg", "image/png"]),
    storedMimeType: z.enum(["image/jpeg", "image/png"]),
    width: z.number().int().min(1).max(20_000),
    height: z.number().int().min(1).max(20_000),
    fileSize: z.number().int().min(1),
    checksumSha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export function validatePhotoSignature(bytes: Uint8Array, mimeType: "image/jpeg" | "image/png") {
  if (bytes.length === 0) throw new TaggingValidationError("Bag photo is empty");
  const jpeg =
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes.at(-2) === 0xff &&
    bytes.at(-1) === 0xd9;
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const png = bytes.length >= 24 && pngSignature.every((value, index) => bytes[index] === value);
  if ((mimeType === "image/jpeg" && !jpeg) || (mimeType === "image/png" && !png)) {
    throw new TaggingValidationError("Bag photo MIME type does not match its content signature");
  }
}

export function sha256Bytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
