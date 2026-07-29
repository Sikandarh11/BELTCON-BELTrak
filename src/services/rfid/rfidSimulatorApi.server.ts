import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import { getSessionFromRequest } from "@/services/authRepository.server";
import {
  PermissionAuthorizationError,
  requirePermission,
} from "@/services/authorization/permissionAuthorization.server";
import { isBeltconSbtsBaselineFeatureEnabled } from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.featureFlags";
import { rfidReadSchema } from "./rfidReadSchemas";
import { rfidReadService, type RfidReadService } from "./rfidReadService.server";

const headers = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };
const sourceSystem = "BELTCON_RFID_SIMULATOR";
type SessionLookup = typeof getSessionFromRequest;
export interface RfidSimulatorApiOptions {
  getSession?: SessionLookup;
  requirePermission?: typeof requirePermission;
  service?: RfidReadService;
  environment?: "development" | "test" | "production";
  featureEnabled?: boolean;
}
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
function enabled(options: RfidSimulatorApiOptions) {
  const environment =
    options.environment ??
    (process.env.NODE_ENV === "production"
      ? "production"
      : process.env.NODE_ENV === "test"
        ? "test"
        : "development");
  return (
    options.featureEnabled ??
    (environment === "production"
      ? process.env.FEATURE_RFID_SIMULATOR === "true"
      : isBeltconSbtsBaselineFeatureEnabled("FEATURE_RFID_SIMULATOR", environment))
  );
}
export async function handleRfidSimulatorRead(
  request: Request,
  options: RfidSimulatorApiOptions = {},
) {
  if (request.method !== "POST")
    return respond({ error: "Method not allowed", code: "RFID_INVALID_EVENT" }, 405);
  if (!enabled(options))
    return respond(
      { error: "BELTCON RFID Simulator is unavailable", code: "RFID_SIMULATOR_DISABLED" },
      403,
    );
  let session: Awaited<ReturnType<SessionLookup>>;
  try {
    session = await (options.getSession ?? getSessionFromRequest)(request);
  } catch {
    return respond(
      { error: "Unable to verify the authenticated session", code: "RFID_SIMULATOR_SESSION_ERROR" },
      500,
    );
  }
  if (!session)
    return respond(
      { error: "An authenticated session is required", code: "RFID_SIMULATOR_UNAUTHORIZED" },
      401,
    );
  try {
    const enforce = options.requirePermission ?? requirePermission;
    await enforce(session, "simulator.use");
    await enforce(session, "developer.access");
  } catch (error) {
    const status = error instanceof PermissionAuthorizationError ? error.status : 500;
    return respond(
      {
        error:
          status === 403
            ? "BELTCON RFID Simulator permission is required"
            : "Permission check failed",
        code: status === 403 ? "RFID_SIMULATOR_FORBIDDEN" : "RFID_SIMULATOR_SESSION_ERROR",
      },
      status,
    );
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return respond(
      { error: "Request body must contain valid JSON", code: "RFID_INVALID_EVENT" },
      400,
    );
  }
  const parsed = rfidReadSchema.safeParse(payload);
  if (!parsed.success)
    return respond({ error: "Invalid RFID event", code: "RFID_INVALID_EVENT" }, 400);
  const requestId = request.headers.get("x-request-id")?.trim() || randomUUID();
  try {
    const result = await (options.service ?? rfidReadService).processRead(parsed.data, {
      sourceSystem,
      requestId,
    });
    const status =
      result.outcome === "CONFLICT"
        ? 409
        : ["READER_NOT_FOUND", "ANTENNA_NOT_FOUND"].includes(result.outcome)
          ? 404
          : ["READER_DISABLED", "ANTENNA_DISABLED"].includes(result.outcome)
            ? 422
            : result.outcome === "FAILED"
              ? 500
              : 200;
    return respond({ requestId, result }, status);
  } catch {
    return respond({ error: "RFID read processing failed", code: "RFID_PROCESSING_FAILED" }, 500);
  }
}
