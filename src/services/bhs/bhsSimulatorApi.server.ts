import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  BhsBagMessageV1Schema,
  BhsLineIdSchema,
} from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.schemas";
import { isBeltconSbtsBaselineFeatureEnabled } from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.featureFlags";
import { getSessionFromRequest } from "@/services/authRepository.server";
import {
  PermissionAuthorizationError,
  requirePermission,
} from "@/services/authorization/permissionAuthorization.server";
import { readLimitedBhsJson } from "./bhsMessageApi.server";
import { BhsMessageError } from "./bhsMessageErrors";
import { bhsMessageService, type BhsMessageService } from "./bhsMessageService.server";
import {
  bhsPendingConfirmationRepository,
  type BhsPendingConfirmationRepository,
} from "./bhsPendingConfirmationRepository.server";

export const BHS_SIMULATOR_SOURCE_SYSTEM = "BELTCON_BHS_SIMULATOR";
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
  pendingRepository?: BhsPendingConfirmationRepository;
}

const confirmationBodySchema = z
  .object({
    lineId: BhsLineIdSchema,
    trigger: z.literal(1),
  })
  .strict();

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
  if (environment === "production") return false;
  if (options.featureEnabled !== undefined) return options.featureEnabled;
  return isBeltconSbtsBaselineFeatureEnabled("FEATURE_BHS_SIMULATOR", environment);
}

async function authorizeSimulator(
  request: Request,
  options: BhsSimulatorApiOptions,
): Promise<
  | { session: Awaited<ReturnType<SessionLookup>>; response: null }
  | { session: null; response: Response }
> {
  let session: Awaited<ReturnType<SessionLookup>>;
  try {
    session = await (options.getSession ?? getSessionFromRequest)(request);
  } catch {
    return {
      session: null,
      response: respond(
        {
          error: "Unable to verify the authenticated session",
          code: "BHS_SIMULATOR_SESSION_ERROR",
        },
        500,
      ),
    };
  }
  if (!session) {
    return {
      session: null,
      response: respond(
        { error: "An authenticated session is required", code: "BHS_SIMULATOR_UNAUTHORIZED" },
        401,
      ),
    };
  }
  try {
    await (options.requirePermission ?? requirePermission)(session, "simulator.use");
  } catch (error) {
    const status = error instanceof PermissionAuthorizationError ? error.status : 500;
    return {
      session: null,
      response: respond(
        {
          error:
            status === 403
              ? "BELTCON BHS Simulator permission is required"
              : "Permission check failed",
          code: status === 403 ? "BHS_SIMULATOR_FORBIDDEN" : "BHS_SIMULATOR_SESSION_ERROR",
        },
        status,
      ),
    };
  }
  return { session, response: null };
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
  const authorization = await authorizeSimulator(request, options);
  if (authorization.response) return authorization.response;
  let payload: unknown;
  try {
    payload = await readLimitedBhsJson(request);
  } catch (error) {
    if (error instanceof BhsMessageError) {
      return respond({ error: error.message, code: error.code }, error.status);
    }
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
      sourceSystem: BHS_SIMULATOR_SOURCE_SYSTEM,
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

export async function handleBhsPendingConfirmationsRequest(
  request: Request,
  options: BhsSimulatorApiOptions = {},
) {
  if (request.method !== "GET") {
    return respond({ error: "Method not allowed", code: "BHS_SIMULATOR_METHOD_NOT_ALLOWED" }, 405);
  }
  if (!simulatorEnabled(options)) {
    return respond(
      { error: "BELTCON BHS Simulator is unavailable", code: "BHS_SIMULATOR_DISABLED" },
      403,
    );
  }
  const authorization = await authorizeSimulator(request, options);
  if (authorization.response) return authorization.response;
  try {
    const items = await (
      options.pendingRepository ?? bhsPendingConfirmationRepository
    ).listPending();
    return respond({ items });
  } catch {
    return respond(
      {
        error: "Unable to load pending BHS diversion confirmations",
        code: "BHS_PENDING_CONFIRMATIONS_FAILED",
      },
      500,
    );
  }
}

export async function handleBhsPendingConfirmationRequest(
  request: Request,
  bagId: string,
  options: BhsSimulatorApiOptions = {},
) {
  if (request.method !== "POST") {
    return respond({ error: "Method not allowed", code: "BHS_SIMULATOR_METHOD_NOT_ALLOWED" }, 405);
  }
  if (!simulatorEnabled(options)) {
    return respond(
      { error: "BELTCON BHS Simulator is unavailable", code: "BHS_SIMULATOR_DISABLED" },
      403,
    );
  }
  const authorization = await authorizeSimulator(request, options);
  if (authorization.response) return authorization.response;
  let input: z.infer<typeof confirmationBodySchema>;
  try {
    input = confirmationBodySchema.parse(await request.json());
  } catch {
    return respond(
      { error: "Invalid BHS confirmation request", code: "BHS_INVALID_CONFIRMATION" },
      400,
    );
  }
  try {
    const pending = await (
      options.pendingRepository ?? bhsPendingConfirmationRepository
    ).getPending(bagId);
    if (!pending) {
      return respond(
        {
          error: "This bag is not awaiting BHS diversion confirmation",
          code: "BHS_PENDING_CONFIRMATION_NOT_FOUND",
        },
        409,
      );
    }
    const result = await (options.service ?? bhsMessageService).ingestMessage(
      {
        messageType: 2001,
        trigger: input.trigger,
        lineId: input.lineId,
        bhsUid: pending.bhsUid,
        evaluation: pending.screeningEvaluationRaw,
      },
      { sourceSystem: BHS_SIMULATOR_SOURCE_SYSTEM, requestId: requestIdFor(request) },
    );
    const status = result.outcome === "REJECTED" ? 409 : result.outcome === "FAILED" ? 500 : 200;
    return respond({ result, acknowledgement: result.acknowledgement }, status);
  } catch (error) {
    if (error instanceof BhsMessageError) {
      return respond({ error: error.message, code: error.code }, error.status);
    }
    return respond(
      { error: "BHS diversion confirmation failed", code: "BHS_CONFIRMATION_FAILED" },
      500,
    );
  }
}
