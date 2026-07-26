import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";

import { getSessionFromRequest } from "@/services/authRepository.server";
import {
  createMockScreeningAdapter,
  type MockScreeningAdapter,
} from "@/services/integrations/screening/mockScreeningAdapter.server";
import { SIMULATOR_SUBMIT_CANONICAL_ROLE, type ScreeningSuspectEvent } from "@/types/screening";
import { ScreeningConflictError, ScreeningServiceError } from "./screeningErrors";
import type { ScreeningIngestionService } from "./screeningIngestionService.server";
import { screeningIngestionService } from "./screeningIngestionService.server";

const MAX_SIMULATOR_BODY_BYTES = 256 * 1024;
const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

type SessionLookup = typeof getSessionFromRequest;

export interface ScreeningSimulatorApiOptions {
  getSession?: SessionLookup;
  service?: ScreeningIngestionService;
  adapter?: MockScreeningAdapter;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
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
    if (Number.isFinite(parsedLength) && parsedLength > MAX_SIMULATOR_BODY_BYTES) {
      throw new ScreeningServiceError(
        "Request body is too large",
        "SCREENING_PAYLOAD_TOO_LARGE",
        413,
      );
    }
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_SIMULATOR_BODY_BYTES) {
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

export async function handleScreeningSimulatorRequest(
  request: Request,
  options: ScreeningSimulatorApiOptions = {},
) {
  let session: Awaited<ReturnType<SessionLookup>>;
  try {
    session = await (options.getSession ?? getSessionFromRequest)(request);
  } catch {
    return jsonResponse(
      {
        error: "Unable to verify the authenticated session",
        code: "SCREENING_SESSION_ERROR",
      },
      500,
    );
  }

  if (!session) {
    return jsonResponse(
      {
        error: "An authenticated session is required",
        code: "SCREENING_UNAUTHORIZED",
      },
      401,
    );
  }

  if (session.user.role !== SIMULATOR_SUBMIT_CANONICAL_ROLE) {
    return jsonResponse(
      {
        error: "Canonical System Administrator role is required",
        code: "SCREENING_FORBIDDEN",
      },
      403,
    );
  }

  let payload: unknown;
  try {
    payload = await readLimitedJson(request);
  } catch (error) {
    if (error instanceof ScreeningServiceError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status);
    }
    return jsonResponse(
      {
        error: "Request body must contain valid JSON",
        code: "SCREENING_VALIDATION_ERROR",
      },
      400,
    );
  }

  const adapter = options.adapter ?? createMockScreeningAdapter();
  let event: ScreeningSuspectEvent;
  try {
    event = adapter.normalizeSimulatorEvent(payload);
  } catch {
    return jsonResponse(
      {
        error: "Invalid screening simulator event",
        code: "SCREENING_VALIDATION_ERROR",
      },
      400,
    );
  }

  try {
    const result = await (options.service ?? screeningIngestionService).ingestSuspectEvent(event, {
      requestId: requestIdFor(request),
    });

    return jsonResponse(
      {
        ...result,
        bhsUid: event.bag.bhsUid,
      },
      result.status === "ACCEPTED" ? 201 : 200,
    );
  } catch (error) {
    if (error instanceof ScreeningConflictError) {
      return jsonResponse(
        {
          error: error.message,
          code: error.code,
          conflictCode: error.conflictCode,
          eventId: event.eventId,
          bhsUid: event.bag.bhsUid,
        },
        error.status,
      );
    }

    if (error instanceof ScreeningServiceError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status);
    }

    return jsonResponse(
      {
        error: "Screening simulator ingestion failed",
        code: "SCREENING_INTERNAL_ERROR",
      },
      500,
    );
  }
}
