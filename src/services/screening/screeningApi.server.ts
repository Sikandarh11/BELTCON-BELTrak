import "@tanstack/react-start/server-only";

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import type { ScreeningAdapter } from "@/services/integrations/screening/screeningAdapter";
import { createMockScreeningAdapter } from "@/services/integrations/screening/mockScreeningAdapter.server";
import type { ScreeningSuspectEvent } from "@/types/screening";
import { ScreeningConflictError, ScreeningServiceError } from "./screeningErrors";
import type { ScreeningIngestionService } from "./screeningIngestionService.server";
import { screeningIngestionService } from "./screeningIngestionService.server";

const MAX_SCREENING_BODY_BYTES = 256 * 1024;
const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

interface ScreeningApiOptions {
  service?: ScreeningIngestionService;
  adapter?: ScreeningAdapter;
  integrationKey?: string | null;
  sourceSystem?: string | null;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function credentialsMatch(provided: string, configured: string) {
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const configuredDigest = createHash("sha256").update(configured, "utf8").digest();
  return timingSafeEqual(providedDigest, configuredDigest);
}

async function readLimitedJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new ScreeningServiceError(
      "Content-Type must be application/json",
      "SCREENING_CONTENT_TYPE_UNSUPPORTED",
      415,
    );
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const parsedLength = Number.parseInt(declaredLength, 10);
    if (Number.isFinite(parsedLength) && parsedLength > MAX_SCREENING_BODY_BYTES) {
      throw new ScreeningServiceError(
        "Request body is too large",
        "SCREENING_PAYLOAD_TOO_LARGE",
        413,
      );
    }
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_SCREENING_BODY_BYTES) {
    throw new ScreeningServiceError(
      "Request body is too large",
      "SCREENING_PAYLOAD_TOO_LARGE",
      413,
    );
  }

  if (!body.trim()) {
    throw new SyntaxError("Empty JSON body");
  }

  return JSON.parse(body) as unknown;
}

function requestIdFor(request: Request) {
  const supplied = request.headers.get("x-request-id")?.trim() ?? "";
  if (supplied.length > 0 && supplied.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(supplied)) {
    return supplied;
  }
  return randomUUID();
}

function safeServiceError(error: unknown) {
  if (error instanceof ScreeningConflictError) {
    return jsonResponse(
      {
        error: error.message,
        code: error.code,
        conflictCode: error.conflictCode,
      },
      error.status,
    );
  }

  if (error instanceof ScreeningServiceError) {
    return jsonResponse(
      {
        error: error.message,
        code: error.code,
      },
      error.status,
    );
  }

  return jsonResponse(
    {
      error: "Screening ingestion failed",
      code: "SCREENING_INTERNAL_ERROR",
    },
    500,
  );
}

export async function handleScreeningSuspectEventRequest(
  request: Request,
  options: ScreeningApiOptions = {},
) {
  const configuredKey =
    options.integrationKey === undefined
      ? (process.env.SCREENING_INTEGRATION_KEY?.trim() ?? null)
      : options.integrationKey?.trim() || null;
  const configuredSource =
    options.sourceSystem === undefined
      ? (process.env.SCREENING_SOURCE_SYSTEM?.trim() ?? null)
      : options.sourceSystem?.trim() || null;

  if (!configuredKey || !configuredSource) {
    return jsonResponse(
      {
        error: "Screening ingestion is not configured",
        code: "SCREENING_NOT_CONFIGURED",
      },
      503,
    );
  }

  const suppliedKey = request.headers.get("x-screening-integration-key");
  if (!suppliedKey || !credentialsMatch(suppliedKey, configuredKey)) {
    return jsonResponse(
      {
        error: "Missing or invalid integration key",
        code: "SCREENING_UNAUTHORIZED",
      },
      401,
    );
  }

  let untrustedPayload: unknown;
  try {
    untrustedPayload = await readLimitedJson(request);
  } catch (error) {
    if (error instanceof ScreeningServiceError) {
      return safeServiceError(error);
    }
    return jsonResponse(
      {
        error: "Request body must contain valid JSON",
        code: "SCREENING_VALIDATION_ERROR",
      },
      400,
    );
  }

  let event: ScreeningSuspectEvent;
  try {
    const adapter = options.adapter ?? createMockScreeningAdapter(configuredSource);
    if (adapter.sourceSystem !== configuredSource) {
      return jsonResponse(
        {
          error: "Screening integration source is misconfigured",
          code: "SCREENING_NOT_CONFIGURED",
        },
        503,
      );
    }
    event = adapter.normalizeSuspectEvent(untrustedPayload);
  } catch {
    return jsonResponse(
      {
        error: "Invalid screening suspect event",
        code: "SCREENING_VALIDATION_ERROR",
      },
      400,
    );
  }

  try {
    const result = await (options.service ?? screeningIngestionService).ingestSuspectEvent(event, {
      requestId: requestIdFor(request),
    });
    return jsonResponse(result, result.status === "ACCEPTED" ? 201 : 200);
  } catch (error) {
    return safeServiceError(error);
  }
}
