import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";

import {
  isCanonicalRole,
  roleIsAtLeast,
  type CanonicalRole,
} from "@/auth/canonicalRoles";
import { getSessionFromRequest } from "@/services/authRepository.server";
import {
  PermissionAuthorizationError,
  requirePermission,
} from "@/services/authorization/permissionAuthorization.server";
import type { PermissionCode } from "@/services/admin/roles/roleSchemas";
import { recordAccessDenied, type AccessDeniedAuditInput } from "@/services/securityAudit.server";
import { AdminUserError } from "./adminUserErrors";
import {
  adminUserIdSchema,
  adminUserActionSchema,
  adminUserListQuerySchema,
  createAdminUserSchema,
  editAdminUserSchema,
  inviteAdminUserSchema,
  repairAdminProfileSchema,
} from "./adminUserSchemas";
import { adminUserService, type AdminUserService } from "./adminUserService.server";

const MAX_ADMIN_USER_BODY_BYTES = 16 * 1024;
const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

type SessionLookup = typeof getSessionFromRequest;

export interface AdminUserApiOptions {
  getSession?: SessionLookup;
  service?: AdminUserService;
  recordAccessDenied?: (input: AccessDeniedAuditInput) => Promise<void>;
  requirePermission?: typeof requirePermission;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

async function authorize(
  request: Request,
  getSession: SessionLookup,
  permission: PermissionCode,
  requiredRole: CanonicalRole,
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
          code: "ADMIN_USER_PERSISTENCE_ERROR",
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
          code: "ADMIN_USER_UNAUTHORIZED",
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
          requiredRole,
          resource: new URL(request.url).pathname,
          method: request.method,
          requestId: request.headers.get("x-request-id")?.trim() || randomUUID(),
        });
      } catch (error) {
        console.error("[BELTrak authorization audit] ACCESS_DENIED persistence failed", {
          resource: new URL(request.url).pathname,
          requiredRole,
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
              : "Unable to verify user-management permissions",
          code: status === 403 ? "ADMIN_USER_FORBIDDEN" : "ADMIN_USER_PERSISTENCE_ERROR",
        },
        status,
      ),
      session: null,
    };
  }

  return { response: null, session };
}

function legacyPermissionEnforcer(requiredRole: CanonicalRole): typeof requirePermission {
  return async (session) => {
    const actorRole = session && "role" in session.user ? session.user.role : null;
    if (!isCanonicalRole(actorRole) || !roleIsAtLeast(actorRole, requiredRole)) {
      throw new PermissionAuthorizationError(
        "Permission denied",
        "PERMISSION_DENIED",
        403,
      );
    }
    return {
      canonicalRole: actorRole,
      permissions: [],
      authorizationVersion: 0,
    };
  };
}

function permissionEnforcerFor(options: AdminUserApiOptions, requiredRole: CanonicalRole) {
  return (
    options.requirePermission ??
    (options.getSession ? legacyPermissionEnforcer(requiredRole) : requirePermission)
  );
}

function deniedAuditFor(options: AdminUserApiOptions) {
  return options.recordAccessDenied ?? (options.getSession ? undefined : recordAccessDenied);
}

function requestIdFor(request: Request) {
  const supplied = request.headers.get("x-request-id")?.trim() ?? "";
  if (supplied.length > 0 && supplied.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(supplied)) {
    return supplied;
  }
  return randomUUID();
}

async function readLimitedJson(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new AdminUserError(
      "Content-Type must be application/json",
      "ADMIN_USER_VALIDATION_ERROR",
      415,
    );
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const length = Number.parseInt(declaredLength, 10);
    if (Number.isFinite(length) && length > MAX_ADMIN_USER_BODY_BYTES) {
      throw new AdminUserError("Request body is too large", "ADMIN_USER_VALIDATION_ERROR", 413);
    }
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_ADMIN_USER_BODY_BYTES) {
    throw new AdminUserError("Request body is too large", "ADMIN_USER_VALIDATION_ERROR", 413);
  }
  if (!text.trim()) throw new SyntaxError("Empty JSON body");
  return JSON.parse(text) as unknown;
}

function safeErrorResponse(error: unknown) {
  if (error instanceof AdminUserError) {
    return jsonResponse({ error: error.message, code: error.code }, error.status);
  }

  return jsonResponse(
    {
      error: "User administration request failed",
      code: "ADMIN_USER_PERSISTENCE_ERROR",
    },
    500,
  );
}

export async function handleListAdminUsersRequest(
  request: Request,
  options: AdminUserApiOptions = {},
) {
  const authorization = await authorize(
    request,
    options.getSession ?? getSessionFromRequest,
    "user.view",
    "Airport Administrator",
    permissionEnforcerFor(options, "Airport Administrator"),
    deniedAuditFor(options),
  );
  if (authorization.response) return authorization.response;

  const url = new URL(request.url);
  const parsed = adminUserListQuerySchema.safeParse({
    search: url.searchParams.get("search") ?? undefined,
    role: url.searchParams.get("role") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    active: url.searchParams.get("active") ?? undefined,
    syncStatus: url.searchParams.get("syncStatus") ?? undefined,
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
  });
  if (!parsed.success) {
    return jsonResponse(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid user-list filters",
        code: "ADMIN_USER_VALIDATION_ERROR",
      },
      400,
    );
  }

  try {
    return jsonResponse(
      await (options.service ?? adminUserService).listUsers({
        search: parsed.data.search,
        role: parsed.data.role,
        status: parsed.data.status,
        isActive: parsed.data.active === undefined ? undefined : parsed.data.active === "true",
        syncStatus: parsed.data.syncStatus,
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
      }),
    );
  } catch (error) {
    return safeErrorResponse(error);
  }
}

function passwordSetupRedirect(request: Request) {
  return (
    process.env.USER_INVITATION_REDIRECT_URL?.trim() ||
    process.env.PASSWORD_RECOVERY_REDIRECT_URL?.trim() ||
    new URL("/change-password", request.url).toString()
  );
}

export async function handleInviteAdminUserRequest(
  request: Request,
  options: AdminUserApiOptions = {},
) {
  const authorization = await authorize(
    request,
    options.getSession ?? getSessionFromRequest,
    "user.manage",
    "System Administrator",
    permissionEnforcerFor(options, "System Administrator"),
    deniedAuditFor(options),
  );
  if (authorization.response || !authorization.session) return authorization.response;

  let body: unknown;
  try {
    body = await readLimitedJson(request);
  } catch (error) {
    return safeErrorResponse(
      error instanceof SyntaxError
        ? new AdminUserError("Request body must be valid JSON", "ADMIN_USER_VALIDATION_ERROR", 400)
        : error,
    );
  }

  const parsed = inviteAdminUserSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid invitation values",
        code: "ADMIN_USER_VALIDATION_ERROR",
      },
      400,
    );
  }

  try {
    const invitation = await (options.service ?? adminUserService).inviteUser({
      ...parsed.data,
      actorId: authorization.session.user.id,
      canonicalRole: authorization.session.user.role,
      requestId: requestIdFor(request),
      timestamp: new Date().toISOString(),
      redirectTo: passwordSetupRedirect(request),
    });
    return jsonResponse({ invitation }, 201);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function handleEditAdminUserRequest(
  request: Request,
  userId: string,
  options: AdminUserApiOptions = {},
) {
  const authorization = await authorize(
    request,
    options.getSession ?? getSessionFromRequest,
    "user.manage",
    "Airport Administrator",
    permissionEnforcerFor(options, "Airport Administrator"),
    deniedAuditFor(options),
  );
  if (authorization.response || !authorization.session) return authorization.response;

  const parsedUserId = adminUserIdSchema.safeParse(userId);
  if (!parsedUserId.success) {
    return jsonResponse(
      { error: "A valid user ID is required", code: "ADMIN_USER_VALIDATION_ERROR" },
      400,
    );
  }

  let body: unknown;
  try {
    body = await readLimitedJson(request);
  } catch (error) {
    return safeErrorResponse(
      error instanceof SyntaxError
        ? new AdminUserError("Request body must be valid JSON", "ADMIN_USER_VALIDATION_ERROR", 400)
        : error,
    );
  }
  const parsed = editAdminUserSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid user update values",
        code: "ADMIN_USER_VALIDATION_ERROR",
      },
      400,
    );
  }

  try {
    const user = await (options.service ?? adminUserService).editUser({
      userId: parsedUserId.data,
      ...parsed.data,
      actorId: authorization.session.user.id,
      canonicalRole: authorization.session.user.role,
      requestId: requestIdFor(request),
      timestamp: new Date().toISOString(),
    });
    return jsonResponse({ user });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function handleAdminUserActionRequest(
  request: Request,
  userId: string,
  options: AdminUserApiOptions = {},
) {
  const authorization = await authorize(
    request,
    options.getSession ?? getSessionFromRequest,
    "user.manage",
    "System Administrator",
    permissionEnforcerFor(options, "System Administrator"),
    deniedAuditFor(options),
  );
  if (authorization.response || !authorization.session) return authorization.response;

  const parsedUserId = adminUserIdSchema.safeParse(userId);
  if (!parsedUserId.success) {
    return jsonResponse(
      { error: "A valid user ID is required", code: "ADMIN_USER_VALIDATION_ERROR" },
      400,
    );
  }

  let body: unknown;
  try {
    body = await readLimitedJson(request);
  } catch (error) {
    return safeErrorResponse(
      error instanceof SyntaxError
        ? new AdminUserError("Request body must be valid JSON", "ADMIN_USER_VALIDATION_ERROR", 400)
        : error,
    );
  }
  const parsed = adminUserActionSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid user action",
        code: "ADMIN_USER_VALIDATION_ERROR",
      },
      400,
    );
  }

  try {
    const result = await (options.service ?? adminUserService).performAction({
      userId: parsedUserId.data,
      ...parsed.data,
      actorId: authorization.session.user.id,
      canonicalRole: authorization.session.user.role,
      requestId: requestIdFor(request),
      timestamp: new Date().toISOString(),
      redirectTo: passwordSetupRedirect(request),
    });
    return jsonResponse(result);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function handleCreateAdminUserRequest(
  request: Request,
  options: AdminUserApiOptions = {},
) {
  const authorization = await authorize(
    request,
    options.getSession ?? getSessionFromRequest,
    "user.manage",
    "System Administrator",
    permissionEnforcerFor(options, "System Administrator"),
    deniedAuditFor(options),
  );
  if (authorization.response || !authorization.session) return authorization.response;

  let body: unknown;
  try {
    body = await readLimitedJson(request);
  } catch (error) {
    return safeErrorResponse(
      error instanceof SyntaxError
        ? new AdminUserError("Request body must be valid JSON", "ADMIN_USER_VALIDATION_ERROR", 400)
        : error,
    );
  }

  const parsed = createAdminUserSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid user creation values",
        code: "ADMIN_USER_VALIDATION_ERROR",
      },
      400,
    );
  }

  try {
    const user = await (options.service ?? adminUserService).createUser({
      ...parsed.data,
      actorId: authorization.session.user.id,
      canonicalRole: authorization.session.user.role,
      requestId: requestIdFor(request),
      timestamp: new Date().toISOString(),
    });
    return jsonResponse({ user }, 201);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function handleRepairAdminProfileRequest(
  request: Request,
  userId: string,
  options: AdminUserApiOptions = {},
) {
  const authorization = await authorize(
    request,
    options.getSession ?? getSessionFromRequest,
    "user.manage",
    "System Administrator",
    permissionEnforcerFor(options, "System Administrator"),
    deniedAuditFor(options),
  );
  if (authorization.response || !authorization.session) return authorization.response;

  const parsedUserId = adminUserIdSchema.safeParse(userId);
  if (!parsedUserId.success) {
    return jsonResponse(
      {
        error: parsedUserId.error.issues[0]?.message ?? "A valid user ID is required",
        code: "ADMIN_USER_VALIDATION_ERROR",
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
        ? new AdminUserError("Request body must be valid JSON", "ADMIN_USER_VALIDATION_ERROR", 400)
        : error,
    );
  }

  const parsed = repairAdminProfileSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid profile repair values",
        code: "ADMIN_USER_VALIDATION_ERROR",
      },
      400,
    );
  }

  try {
    const user = await (options.service ?? adminUserService).repairProfile({
      userId: parsedUserId.data,
      ...parsed.data,
      actorId: authorization.session.user.id,
      canonicalRole: authorization.session.user.role,
      requestId: requestIdFor(request),
      timestamp: new Date().toISOString(),
    });
    return jsonResponse({ user });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
