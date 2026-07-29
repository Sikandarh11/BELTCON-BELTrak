import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";

import { BhsBagMessageV1Schema } from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.schemas";
import { isBeltconSbtsBaselineFeatureEnabled } from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.featureFlags";
import { getSessionFromRequest } from "@/services/authRepository.server";
import {
  PermissionAuthorizationError,
  requirePermission,
} from "@/services/authorization/permissionAuthorization.server";
import { BhsMessageError } from "./bhsMessageErrors";
import { bhsMessageService, type BhsMessageService } from "./bhsMessageService.server";

const SOURCE_SYSTEM = "BELTCON_BHS_SIMULATOR";
const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};
type SessionLookup = typeof getSessionFromRequest;

export interface BhsSimulatorApiOptions {
  getSession?: SessionLookup;
  requirePermission?: typeof requirePermission;
  service?: BhsMessageService;
  environment?: "development" | "test" | "production";
  featureEnabled?: boolean;
}

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
function requestIdFor(request: Request) {
  const supplied = request.headers.get("x-request-id")?.trim();
  return supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : randomUUID();
}

function simulatorEnabled(options: BhsSimulatorApiOptions) {
  const environment =
    options.environment ??
    (process.env.NODE_ENV === "production"
      ? "production"
      : process.env.NODE_ENV === "test"
        ? "test"
        : "development");
  if (options.featureEnabled !== undefined) return options.featureEnabled;
  if (environment === "production") return process.env.FEATURE_BHS_SIMULATOR === "true";
  return isBeltconSbtsBaselineFeatureEnabled("FEATURE_BHS_SIMULATOR", environment);
}

export async function handleBhsSimulatorRequest(
  request: Request,
  options: BhsSimulatorApiOptions = {},
) {
  if (request.method !== "POST")
    return respond({ error: "Method not allowed", code: "BHS_SIMULATOR_METHOD_NOT_ALLOWED" }, 405);
  if (!simulatorEnabled(options))
    return respond(
      { error: "BELTCON BHS Simulator is unavailable", code: "BHS_SIMULATOR_DISABLED" },
      403,
    );
  let session: Awaited<ReturnType<SessionLookup>>;
  try {
    session = await (options.getSession ?? getSessionFromRequest)(request);
  } catch {
    return respond(
      { error: "Unable to verify the authenticated session", code: "BHS_SIMULATOR_SESSION_ERROR" },
      500,
    );
  }
  if (!session)
    return respond(
      { error: "An authenticated session is required", code: "BHS_SIMULATOR_UNAUTHORIZED" },
      401,
    );
  try {
    // The feature flag and this persisted permission are both required.
    // Workspace mode and canonical-role rank are not endpoint authority.
    const enforce = options.requirePermission ?? requirePermission;
    await enforce(session, "simulator.use");
    // Existing developer-console deployments retain this additional persisted
    // compatibility grant; it never substitutes for simulator.use.
    await (options.requirePermission ?? requirePermission)(session, "developer.access");
  } catch (error) {
    const status = error instanceof PermissionAuthorizationError ? error.status : 500;
    return respond(
      {
        error:
          status === 403
            ? "BELTCON BHS Simulator permission is required"
            : "Permission check failed",
        code: status === 403 ? "BHS_SIMULATOR_FORBIDDEN" : "BHS_SIMULATOR_SESSION_ERROR",
      },
      status,
    );
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return respond(
      { error: "Request body must contain valid JSON", code: "BHS_INVALID_MESSAGE" },
      400,
    );
  }
  const parsed = BhsBagMessageV1Schema.safeParse(payload);
  if (!parsed.success)
    return respond({ error: "Invalid BHS message", code: "BHS_INVALID_MESSAGE" }, 400);
  const requestId = requestIdFor(request);
  try {
    const result = await (options.service ?? bhsMessageService).ingestMessage(parsed.data, {
      sourceSystem: SOURCE_SYSTEM,
      requestId,
    });
    const status = result.outcome === "REJECTED" ? 409 : result.outcome === "FAILED" ? 500 : 200;
    return respond({ requestId, result, acknowledgement: result.acknowledgement }, status);
  } catch (error) {
    if (error instanceof BhsMessageError)
      return respond({ error: error.message, code: error.code }, error.status);
    return respond({ error: "BHS simulator processing failed", code: "BHS_SIMULATOR_FAILED" }, 500);
  }
}
