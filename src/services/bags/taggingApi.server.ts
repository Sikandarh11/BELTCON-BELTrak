import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import { roleIsAtLeast } from "@/auth/canonicalRoles";
import { getSessionFromRequest } from "@/services/authRepository.server";
import { TaggingServiceError } from "./taggingErrors";
import type { TaggingService } from "./taggingService.server";
import { taggingService } from "./taggingService.server";

const MINIMUM_TAGGING_ROLE = "Operations Officer";
const MAX_ENCODE_BODY_BYTES = 4 * 1024;
const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};
const encodeTagBodySchema = z
  .object({
    epc: z.string(),
  })
  .strict();

type SessionLookup = typeof getSessionFromRequest;

export interface TaggingApiOptions {
  getSession?: SessionLookup;
  service?: TaggingService;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

async function authorize(request: Request, getSession: SessionLookup) {
  let session: Awaited<ReturnType<SessionLookup>>;
  try {
    session = await getSession(request);
  } catch {
    return {
      response: jsonResponse(
        {
          error: "Unable to verify the authenticated session",
          code: "TAGGING_INTERNAL_ERROR",
        },
        500,
      ),
      session: null,
    };
  }

  if (!session) {
    return {
      response: jsonResponse(
        {
          error: "An authenticated session is required",
          code: "TAGGING_UNAUTHORIZED",
        },
        401,
      ),
      session: null,
    };
  }

  if (!roleIsAtLeast(session.user.role, MINIMUM_TAGGING_ROLE)) {
    return {
      response: jsonResponse(
        {
          error: "Canonical Operations Officer role or higher is required",
          code: "TAGGING_FORBIDDEN",
        },
        403,
      ),
      session: null,
    };
  }

  return { response: null, session };
}

async function readLimitedJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new TaggingServiceError(
      "Content-Type must be application/json",
      "TAGGING_VALIDATION_ERROR",
      415,
    );
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const parsedLength = Number.parseInt(declaredLength, 10);
    if (Number.isFinite(parsedLength) && parsedLength > MAX_ENCODE_BODY_BYTES) {
      throw new TaggingServiceError("Request body is too large", "TAGGING_VALIDATION_ERROR", 413);
    }
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_ENCODE_BODY_BYTES) {
    throw new TaggingServiceError("Request body is too large", "TAGGING_VALIDATION_ERROR", 413);
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

function safeErrorResponse(error: unknown) {
  if (error instanceof TaggingServiceError) {
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
      error: "Tagging request failed",
      code: "TAGGING_INTERNAL_ERROR",
    },
    500,
  );
}

export async function handlePendingTaggingRequest(
  request: Request,
  options: TaggingApiOptions = {},
) {
  const authorization = await authorize(request, options.getSession ?? getSessionFromRequest);
  if (authorization.response) return authorization.response;

  try {
    const bags = await (options.service ?? taggingService).listPendingTagging();
    return jsonResponse({ bags });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function handleEncodeTagRequest(
  request: Request,
  bagId: string,
  options: TaggingApiOptions = {},
) {
  const authorization = await authorize(request, options.getSession ?? getSessionFromRequest);
  if (authorization.response || !authorization.session) {
    return authorization.response;
  }

  let input;
  try {
    input = encodeTagBodySchema.parse(await readLimitedJson(request));
  } catch (error) {
    if (error instanceof TaggingServiceError) {
      return safeErrorResponse(error);
    }
    return jsonResponse(
      {
        error: "Request body must contain a valid EPC",
        code: "TAGGING_VALIDATION_ERROR",
      },
      400,
    );
  }

  try {
    const bag = await (options.service ?? taggingService).encodeTag({
      bagId,
      epc: input.epc,
      actorId: authorization.session.user.id,
      canonicalRole: authorization.session.user.role,
      requestId: requestIdFor(request),
    });
    return jsonResponse({ bag });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
