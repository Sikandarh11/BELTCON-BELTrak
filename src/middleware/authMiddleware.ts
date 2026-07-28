import { createMiddleware } from "@tanstack/react-start";

import { permissionForPath } from "@/auth/permissions";
import { blocksOperationalApi, passwordChangeRedirect } from "@/auth/passwordChangePolicy";
import { requirePermission } from "@/services/authorization/permissionAuthorization.server";
import { handleAuthRequest, getSessionFromRequest } from "@/services/authRepository.server";
import { recordAccessDenied } from "@/services/securityAudit.server";

// Recovery entry pages must render before a browser has an authenticated cookie.
const PUBLIC_PATHS = new Set(["/", "/login", "/register", "/forgot-password", "/change-password"]);

function isAssetRequest(pathname: string) {
  return pathname.startsWith("/@") || pathname.startsWith("/assets") || pathname.includes(".");
}

function redirect(to: string) {
  return new Response(null, { status: 302, headers: { location: to } });
}

export const authMiddleware = createMiddleware().server(async ({ request, next }) => {
  const url = new URL(request.url);

  const apiResponse = await handleAuthRequest(request);
  if (apiResponse) {
    return apiResponse;
  }

  if (isAssetRequest(url.pathname) && !url.pathname.startsWith("/api/")) {
    return next();
  }

  const session = await getSessionFromRequest(request);

  if (url.pathname.startsWith("/api/")) {
    if (blocksOperationalApi(session?.user)) {
      return new Response(
        JSON.stringify({
          error: "Password change required",
          code: "PASSWORD_CHANGE_REQUIRED",
        }),
        {
          status: 403,
          headers: { "content-type": "application/json; charset=utf-8" },
        },
      );
    }
    return next();
  }

  const forcedPasswordRedirect = passwordChangeRedirect(url.pathname, session?.user);
  if (forcedPasswordRedirect) {
    return redirect(forcedPasswordRedirect);
  }

  const isPublicAuthRoute = PUBLIC_PATHS.has(url.pathname);

  if (!session && !isPublicAuthRoute) {
    return redirect("/login");
  }

  if (session && !isPublicAuthRoute && url.pathname !== "/access-denied") {
    const requiredPermission = permissionForPath(url.pathname);
    try {
      await requirePermission(session, requiredPermission);
    } catch (permissionError) {
      try {
        await recordAccessDenied({
          actorId: session.user.id,
          canonicalRole: session.user.role,
          requiredPermission,
          resource: url.pathname,
          method: request.method,
          requestId: request.headers.get("x-request-id")?.trim() || undefined,
        });
      } catch (auditError) {
        console.error("[BELTrak authorization audit] ACCESS_DENIED persistence failed", {
          resource: url.pathname,
          requiredPermission,
          cause: auditError instanceof Error ? auditError.message : "unknown",
        });
      }
      console.error("[BELTrak authorization] Permission denied", {
        resource: url.pathname,
        requiredPermission,
        cause: permissionError instanceof Error ? permissionError.message : "unknown",
      });
      return redirect(`/access-denied?from=${encodeURIComponent(url.pathname)}`);
    }
  }

  return next();
});
