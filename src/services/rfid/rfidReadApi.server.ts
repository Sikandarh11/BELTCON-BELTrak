import "@tanstack/react-start/server-only";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { rfidReadSchema } from "./rfidReadSchemas";
import { RfidReadError } from "./rfidReadErrors";
import { rfidReadService, type RfidReadService } from "./rfidReadService.server";

const MAX_BODY_BYTES = 64 * 1024;
const headers = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };
export interface RfidReadApiOptions {
  service?: RfidReadService;
  integrationKey?: string | null;
  sourceSystem?: string | null;
}
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
const requestIdFor = (request: Request) => {
  const value = request.headers.get("x-request-id")?.trim();
  return value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : randomUUID();
};
const matches = (given: string, expected: string) =>
  timingSafeEqual(
    createHash("sha256").update(given).digest(),
    createHash("sha256").update(expected).digest(),
  );
async function readJson(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json"))
    throw new RfidReadError("RFID_INVALID_EVENT", 400, "Content-Type must be application/json");
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES)
    throw new RfidReadError("RFID_EVENT_TOO_LARGE", 413, "RFID event is too large");
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES)
    throw new RfidReadError("RFID_EVENT_TOO_LARGE", 413, "RFID event is too large");
  return JSON.parse(body) as unknown;
}
function statusFor(outcome: string) {
  if (outcome === "READER_NOT_FOUND" || outcome === "ANTENNA_NOT_FOUND") return 404;
  if (outcome === "READER_DISABLED" || outcome === "ANTENNA_DISABLED") return 422;
  if (outcome === "CONFLICT") return 409;
  if (outcome === "FAILED") return 500;
  return 200;
}

export async function handleRfidIntegrationRead(
  request: Request,
  options: RfidReadApiOptions = {},
) {
  if (request.method !== "POST")
    return respond({ error: "Method not allowed", code: "RFID_INVALID_EVENT" }, 405);
  const key =
    options.integrationKey === undefined
      ? process.env.RFID_INTEGRATION_KEY?.trim()
      : options.integrationKey?.trim();
  const source =
    options.sourceSystem === undefined
      ? process.env.RFID_SOURCE_SYSTEM?.trim()
      : options.sourceSystem?.trim();
  if (!key || !source)
    return respond(
      { error: "RFID integration is not configured", code: "RFID_INTEGRATION_UNAVAILABLE" },
      503,
    );
  const supplied = request.headers.get("x-rfid-integration-key");
  if (!supplied)
    return respond(
      { error: "RFID integration credentials are required", code: "RFID_AUTHENTICATION_REQUIRED" },
      401,
    );
  if (!matches(supplied, key))
    return respond(
      { error: "RFID integration authentication failed", code: "RFID_AUTHENTICATION_FAILED" },
      401,
    );
  let payload: unknown;
  try {
    payload = await readJson(request);
  } catch (error) {
    return error instanceof RfidReadError
      ? respond({ error: error.message, code: error.code }, error.status)
      : respond({ error: "Request body must contain valid JSON", code: "RFID_INVALID_EVENT" }, 400);
  }
  const parsed = rfidReadSchema.safeParse(payload);
  if (!parsed.success)
    return respond({ error: "Invalid RFID event", code: "RFID_INVALID_EVENT" }, 400);
  const requestId = requestIdFor(request);
  try {
    const result = await (options.service ?? rfidReadService).processRead(parsed.data, {
      sourceSystem: source,
      requestId,
    });
    return respond({ requestId, result }, statusFor(result.outcome));
  } catch (error) {
    return error instanceof RfidReadError
      ? respond({ error: error.message, code: error.code }, error.status)
      : respond({ error: "RFID read processing failed", code: "RFID_PROCESSING_FAILED" }, 500);
  }
}
