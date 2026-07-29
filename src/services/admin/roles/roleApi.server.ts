import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";

import type { CanonicalRole } from "@/auth/canonicalRoles";
import type { PermissionCode } from "./roleSchemas";
import { getSessionFromRequest } from "@/services/authRepository.server";
import {
  PermissionAuthorizationError,
  requirePermission,
} from "@/services/authorization/permissionAuthorization.server";
import { recordAccessDenied, type AccessDeniedAuditInput } from "@/services/securityAudit.server";
import { RolePermissionError } from "./roleErrors";
import { rolePermissionIdSchema, updateRolePermissionsSchema } from "./roleSchemas";
import { roleService, type RoleService } from "./roleService.server";

const MAX_ROLE_PERMISSION_BODY_BYTES = 16 * 1024;
const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

type SessionLookup = typeof getSessionFromRequest;

export interface RoleApiOptions {
  getSession?: SessionLookup;
  service?: RoleService;
  recordAccessDenied?: (input: AccessDeniedAuditInput) => Promise<void>;
  requirePermission?: typeof requirePermission;
}

// Dependency-injected sessions are test seams. Production calls the central
// persisted authorization service below; these checks never run in production.
function legacyTestPermissionEnforcer(
  requiredRole: "Airport Administrator" | "System Administrator",
) {
  return async (session: { user: { id: string } } | null, _permissionCode: string) => {
    const actorRole =
      session && "role" in session.user && typeof session.user.role === "string"
        ? session.user.role
        : null;
    const allowed =
      requiredRole === "System Administrator"
        ? actorRole === "System Administrator"
        : actorRole === "Airport Administrator" || actorRole === "System Administrator";
    if (!allowed || !session) {
      throw new PermissionAuthorizationError("Permission denied", "PERMISSION_DENIED", 403);
    }
    return {
      userId: session.user.id,
      profileId: session.user.id,
      canonicalRole: actorRole as CanonicalRole,
      permissions: [],
      accountStatus: "ACTIVE" as const,
      authorizationVersion: 0,
    };
  };
}

function permissionEnforcerFor(
  options: RoleApiOptions,
  requiredRole: "Airport Administrator" | "System Administrator",
) {
  return (
    options.requirePermission ??
    (options.getSession ? legacyTestPermissionEnforcer(requiredRole) : requirePermission)
  );
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function requestIdFor(request: Request) {
  const supplied = request.headers.get("x-request-id")?.trim() ?? "";
  if (supplied.length > 0 && supplied.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(supplied)) {
    return supplied;
  }
  return randomUUID();
}

async function authorize(
  request: Request,
  getSession: SessionLookup,
  permission: PermissionCode,
  enforcePermission: typeof requirePermission,
  deniedAudit?: (input: AccessDeniedAuditInput) => Promise<void>,
) {
  let session: Awaited<ReturnType<SessionLookup>>;
  try {
    session = await getSession(request);
  } catch {
    return {
      response: jsonResponse(
        {
          error: "Unable to verify the authenticated session",
          code: "ROLE_PERMISSION_PERSISTENCE_ERROR",
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
          code: "ROLE_PERMISSION_UNAUTHORIZED",
        },
        401,
      ),
      session: null,
    };
  }

  try {
    await enforcePermission(session, permission);
  } catch (error) {
    if (deniedAudit) {
      try {
        await deniedAudit({
          actorId: session.user.id,
          canonicalRole: session.user.role,
          resource: new URL(request.url).pathname,
          method: request.method,
          requestId: requestIdFor(request),
        });
      } catch (error) {
        console.error("[BELTrak authorization audit] ACCESS_DENIED persistence failed", {
          resource: new URL(request.url).pathname,
          requiredPermission: permission,
          cause: error instanceof Error ? error.message : "unknown",
        });
      }
    }
    const status = error instanceof PermissionAuthorizationError ? error.status : 500;
    return {
      response: jsonResponse(
        {
          error:
            status === 403
              ? `Permission ${permission} is required`
              : "Unable to verify role permissions",
          code: status === 403 ? "ROLE_PERMISSION_FORBIDDEN" : "ROLE_PERMISSION_PERSISTENCE_ERROR",
        },
        status,
      ),
      session: null,
    };
  }

  return { response: null, session };
}

function deniedAuditFor(options: RoleApiOptions) {
  return options.recordAccessDenied ?? (options.getSession ? undefined : recordAccessDenied);
}

async function readLimitedJson(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new RolePermissionError(
      "Content-Type must be application/json",
      "ROLE_PERMISSION_VALIDATION_ERROR",
      415,
    );
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const length = Number.parseInt(declaredLength, 10);
    if (Number.isFinite(length) && length > MAX_ROLE_PERMISSION_BODY_BYTES) {
      throw new RolePermissionError(
        "Request body is too large",
        "ROLE_PERMISSION_VALIDATION_ERROR",
        413,
      );
    }
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_ROLE_PERMISSION_BODY_BYTES) {
    throw new RolePermissionError(
      "Request body is too large",
      "ROLE_PERMISSION_VALIDATION_ERROR",
      413,
    );
  }
  if (!text.trim()) throw new SyntaxError("Empty JSON body");
  return JSON.parse(text) as unknown;
}

function safeErrorResponse(error: unknown) {
  if (error instanceof RolePermissionError) {
    return jsonResponse({ error: error.message, code: error.code }, error.status);
  }
  return jsonResponse(
    {
      error: "Role permission request failed",
      code: "ROLE_PERMISSION_PERSISTENCE_ERROR",
    },
    500,
  );
}

export async function handleGetRolePermissionsRequest(
  request: Request,
  options: RoleApiOptions = {},
) {
  const authorization = await authorize(
    request,
    options.getSession ?? getSessionFromRequest,
    "role.view",
    permissionEnforcerFor(options, "Airport Administrator"),
    deniedAuditFor(options),
  );
  if (authorization.response || !authorization.session) return authorization.response;

  try {
    return jsonResponse(
      await (options.service ?? roleService).getRolesWithPermissions(
        authorization.session.user.role,
      ),
    );
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function handleUpdateRolePermissionsRequest(
  request: Request,
  roleId: string,
  options: RoleApiOptions = {},
) {
  const authorization = await authorize(
    request,
    options.getSession ?? getSessionFromRequest,
    "role.manage",
    permissionEnforcerFor(options, "System Administrator"),
    deniedAuditFor(options),
  );
  if (authorization.response || !authorization.session) return authorization.response;

  const parsedRoleId = rolePermissionIdSchema.safeParse(roleId);
  if (!parsedRoleId.success) {
    return jsonResponse(
      {
        error: parsedRoleId.error.issues[0]?.message ?? "A valid role ID is required",
        code: "ROLE_PERMISSION_VALIDATION_ERROR",
      },
      400,
    );
  }

  let body: unknown;
  try {
    body = await readLimitedJson(request);
  } catch (error) {
    return safeErrorResponse(
      error instanceof SyntaxError
        ? new RolePermissionError(
            "Request body must be valid JSON",
            "ROLE_PERMISSION_VALIDATION_ERROR",
            400,
          )
        : error,
    );
  }

  const parsed = updateRolePermissionsSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid role permission values",
        code: "ROLE_PERMISSION_VALIDATION_ERROR",
      },
      400,
    );
  }

  try {
    const update = await (options.service ?? roleService).updateRolePermissions({
      roleId: parsedRoleId.data,
      permissionCodes: parsed.data.permissionCodes,
      expectedVersion: parsed.data.expectedVersion,
      reason: parsed.data.reason,
      actorId: authorization.session.user.id,
      canonicalRole: authorization.session.user.role,
      requestId: requestIdFor(request),
      timestamp: new Date().toISOString(),
    });
    return jsonResponse({ update });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
