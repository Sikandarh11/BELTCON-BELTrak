import "@tanstack/react-start/server-only";

import { roleIsAtLeast } from "@/auth/canonicalRoles";
import { getSessionFromRequest } from "@/services/authRepository.server";
import {
  PermissionAuthorizationError,
  requirePermission,
} from "@/services/authorization/permissionAuthorization.server";
import { TaggingServiceError } from "./taggingErrors";
import type { TaggingService } from "./taggingService.server";
import { taggingService } from "./taggingService.server";

const MINIMUM_TAGGING_ROLE = "Operations Officer";
const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

type SessionLookup = typeof getSessionFromRequest;

export interface TaggingApiOptions {
  getSession?: SessionLookup;
  service?: TaggingService;
  requirePermission?: typeof requirePermission;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

async function authorize(request: Request, options: TaggingApiOptions) {
  let session: Awaited<ReturnType<SessionLookup>>;
  try {
    session = await (options.getSession ?? getSessionFromRequest)(request);
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

  try {
    if (options.requirePermission) {
      await options.requirePermission(session, "bag.tag");
    } else if (options.getSession) {
      if (!roleIsAtLeast(session.user.role, MINIMUM_TAGGING_ROLE)) {
        throw new PermissionAuthorizationError("Permission denied", "PERMISSION_DENIED", 403);
      }
    } else {
      await requirePermission(session, "bag.tag");
    }
  } catch (error) {
    const status = error instanceof PermissionAuthorizationError ? error.status : 500;
    return {
      response: jsonResponse(
        {
          error: status === 403 ? "Permission bag.tag is required" : "Permission check failed",
          code: status === 403 ? "TAGGING_FORBIDDEN" : "TAGGING_INTERNAL_ERROR",
        },
        status,
      ),
      session: null,
    };
  }

  return { response: null, session };
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
  const authorization = await authorize(request, options);
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
  const authorization = await authorize(request, options);
  if (authorization.response || !authorization.session) {
    return authorization.response;
  }
  void request;
  void bagId;
  return jsonResponse(
    {
      error: "Direct tag encoding is disabled; use the server-controlled station session",
      code: "TAGGING_SESSION_REQUIRED",
    },
    409,
  );
}

/** Baseline V1 naming. The legacy encode endpoint remains a compatibility wrapper. */
export async function handleAssignRfidTagRequest(
  request: Request,
  bagId: string,
  options: TaggingApiOptions = {},
) {
  const authorization = await authorize(request, options);
  if (authorization.response || !authorization.session) return authorization.response;
  void request;
  void bagId;
  return jsonResponse(
    {
      error: "Direct RFID assignment is disabled; use the verified station workflow",
      code: "TAGGING_SESSION_REQUIRED",
    },
    409,
  );
}
