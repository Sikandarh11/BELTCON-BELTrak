import "@tanstack/react-start/server-only";

import { z } from "zod";

import { isBeltconSbtsBaselineFeatureEnabled } from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.featureFlags";
import { getSessionFromRequest } from "@/services/authRepository.server";
import {
  PermissionAuthorizationError,
  requirePermission,
} from "@/services/authorization/permissionAuthorization.server";
import type { ReaderService } from "@/services/readers/readerService.server";

import {
  rfidReaderAdapterRuntime,
  type RfidReaderAdapterRuntime,
} from "./adapters/rfidReaderAdapterRuntime.server";
import { RfidReadError } from "./events/rfidReadEventErrors";
import { RfidReadIngestionResultSchema } from "./events/rfidReadEventSchemas";
import { RfidDetectionResultSchema } from "./detections/rfidDetectionSchemas";
import { RfidActiveBagResolutionSchema } from "./resolution/rfidActiveBagResolutionSchemas";

const headers = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

type SessionLookup = typeof getSessionFromRequest;

export interface RfidSimulatorApiOptions {
  getSession?: SessionLookup;
  requirePermission?: typeof requirePermission;
  readerService?: ReaderService;
  runtime?: RfidReaderAdapterRuntime;
  environment?: "development" | "test" | "production";
  featureEnabled?: boolean;
}

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

const simulatorActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), readerId: z.string().trim().min(1).max(128) }).strict(),
  z.object({ action: z.literal("stop"), readerId: z.string().trim().min(1).max(128) }).strict(),
  z.object({ action: z.literal("disconnect"), readerId: z.string().trim().min(1).max(128) }).strict(),
  z.object({ action: z.literal("reconnect"), readerId: z.string().trim().min(1).max(128) }).strict(),
  z
    .object({
      action: z.literal("emit"),
      readerId: z.string().trim().min(1).max(128),
      epc: z.string(),
      antennaPort: z.coerce.number().int().positive(),
      rssiDbm: z.coerce.number().finite().optional(),
      burstCount: z.coerce.number().int().min(1).max(10_000).optional(),
    })
    .strict(),
]);

const processingResultSchema = z
  .object({
    ingestion: RfidReadIngestionResultSchema,
    detection: RfidDetectionResultSchema.optional(),
    resolution: RfidActiveBagResolutionSchema.optional(),
    detectionError: z
      .object({
        code: z.string(),
        message: z.string(),
      })
      .optional(),
  })
  .strict();

const simulatorResultSchema = z.object({
  readerId: z.string(),
  result: processingResultSchema.optional(),
  results: z.array(processingResultSchema).optional(),
});

function enabled(options: RfidSimulatorApiOptions) {
  if (options.environment === "production" || process.env.NODE_ENV === "production") {
    return false;
  }
  if (typeof options.featureEnabled === "boolean") return options.featureEnabled;
  const environment =
    options.environment ??
    (process.env.NODE_ENV === "test"
      ? "test"
      : process.env.NODE_ENV === "production"
        ? "production"
        : "development");
  return isBeltconSbtsBaselineFeatureEnabled("FEATURE_RFID_SIMULATOR", environment);
}

async function authorize(request: Request, options: RfidSimulatorApiOptions) {
  let session: Awaited<ReturnType<SessionLookup>>;
  try {
    session = await (options.getSession ?? getSessionFromRequest)(request);
  } catch {
    return {
      response: respond(
        { error: "Unable to verify the authenticated session", code: "RFID_SIMULATOR_SESSION_ERROR" },
        500,
      ),
      session: null,
    };
  }

  if (!session) {
    return {
      response: respond(
        { error: "An authenticated session is required", code: "RFID_SIMULATOR_UNAUTHORIZED" },
        401,
      ),
      session: null,
    };
  }

  try {
    await (options.requirePermission ?? requirePermission)(session, "simulator.use");
    return { response: null, session };
  } catch (error) {
    const status = error instanceof PermissionAuthorizationError ? error.status : 500;
    return {
      response: respond(
        {
          error: status === 403 ? "Permission simulator.use is required" : "Permission check failed",
          code: status === 403 ? "RFID_SIMULATOR_FORBIDDEN" : "RFID_SIMULATOR_SESSION_ERROR",
        },
        status,
      ),
      session: null,
    };
  }
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/not found/i.test(message)) {
    return respond({ error: "Reader was not found", code: "RFID_READER_NOT_FOUND" }, 404);
  }
  if (/disabled/i.test(message)) {
    return respond({ error: "Reader is disabled", code: "RFID_READER_DISABLED" }, 409);
  }
  if (/simulator_disabled/i.test(message)) {
    return respond({ error: "RFID simulator is unavailable", code: "RFID_SIMULATOR_DISABLED" }, 403);
  }
  if (/not_supported/i.test(message)) {
    return respond(
      {
        error: "This reader does not support simulator actions",
        code: "RFID_READER_NOT_SUPPORTED",
      },
      422,
    );
  }
  return respond({ error: "RFID simulator request failed", code: "RFID_QUERY_FAILED" }, 500);
}

function combineProcessingResult(
  runtime: RfidReaderAdapterRuntime,
  readerId: string,
  ingestion: z.infer<typeof RfidReadIngestionResultSchema>,
) {
  return {
    ingestion,
    ...(runtime.getProcessingOutcome(readerId, ingestion.sourceEventId) ?? {}),
  };
}

async function readJson(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new Error("RFID_INVALID_REQUEST");
  }
  return request.json() as Promise<unknown>;
}

export async function handleRfidSimulatorRead(
  request: Request,
  options: RfidSimulatorApiOptions = {},
) {
  if (request.method !== "GET" && request.method !== "POST") {
    return respond({ error: "Method not allowed", code: "RFID_INVALID_REQUEST" }, 405);
  }

  if (!enabled(options)) {
    return respond(
      { error: "BELTCON RFID Simulator is unavailable", code: "RFID_SIMULATOR_DISABLED" },
      403,
    );
  }

  const authorization = await authorize(request, options);
  if (authorization.response || !authorization.session) return authorization.response!;

  const runtime = options.runtime ?? rfidReaderAdapterRuntime;

  if (request.method === "GET") {
    try {
      return respond({ readers: await runtime.listConfiguredReaders() });
    } catch (error) {
      return safeError(error);
    }
  }

  let payload: unknown;
  try {
    payload = await readJson(request);
  } catch {
    return respond(
      { error: "Request body must contain valid JSON", code: "RFID_INVALID_REQUEST" },
      400,
    );
  }

  const parsed = simulatorActionSchema.safeParse(payload);
  if (!parsed.success) {
    return respond(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid simulator request",
        code: "RFID_INVALID_REQUEST",
      },
      400,
    );
  }

  try {
    if (parsed.data.action === "start") {
      return respond({
        readerId: parsed.data.readerId,
        health: await runtime.startReader(parsed.data.readerId),
      });
    }

    if (parsed.data.action === "stop") {
      return respond({
        readerId: parsed.data.readerId,
        health: await runtime.stopReader(parsed.data.readerId),
      });
    }

    if (parsed.data.action === "disconnect") {
      const adapter = await runtime.getOrCreateAdapter(parsed.data.readerId);
      const disconnect = (adapter as { disconnect?: (reason?: string) => void }).disconnect;
      if (typeof disconnect !== "function") {
        throw new Error("RFID_SIMULATOR_READER_NOT_SUPPORTED");
      }
      disconnect();
      return respond({
        readerId: parsed.data.readerId,
        health: await runtime.getReaderAdapterHealth(parsed.data.readerId),
      });
    }

    if (parsed.data.action === "reconnect") {
      const adapter = await runtime.getOrCreateAdapter(parsed.data.readerId);
      const reconnect = (adapter as { reconnect?: () => Promise<void> }).reconnect;
      if (typeof reconnect !== "function") {
        throw new Error("RFID_SIMULATOR_READER_NOT_SUPPORTED");
      }
      await reconnect();
      return respond({
        readerId: parsed.data.readerId,
        health: await runtime.getReaderAdapterHealth(parsed.data.readerId),
      });
    }

    const results = await runtime.emitSimulatedRead(parsed.data.readerId, {
      epc: parsed.data.epc,
      antennaPort: parsed.data.antennaPort,
      rssiDbm: parsed.data.rssiDbm,
      burstCount: parsed.data.burstCount,
    });

    const payloadResult =
      results.length === 1
        ? {
            readerId: parsed.data.readerId,
            result: combineProcessingResult(runtime, parsed.data.readerId, results[0]),
          }
        : {
            readerId: parsed.data.readerId,
            results: results.map((ingestion) =>
              combineProcessingResult(runtime, parsed.data.readerId, ingestion),
            ),
          };

    return respond(simulatorResultSchema.parse(payloadResult));
  } catch (error) {
    if (error instanceof RfidReadError) {
      return respond({ error: error.message, code: error.code }, error.httpStatus);
    }
    return safeError(error);
  }
}
