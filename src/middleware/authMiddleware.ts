import { createMiddleware } from "@tanstack/react-start";

import { handleAuthRequest, getSessionFromRequest } from "@/services/authRepository.server";

// Allow the root landing page to be public so "Back to home" works
const PUBLIC_PATHS = new Set(["/", "/login", "/register"]);

function isAssetRequest(pathname: string) {
  return pathname.startsWith("/@") || pathname.startsWith("/assets") || pathname.startsWith("/api/") || pathname.includes(".");
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

  if (isAssetRequest(url.pathname)) {
    return next();
  }

  const session = await getSessionFromRequest(request);
  const isPublicAuthRoute = PUBLIC_PATHS.has(url.pathname);

  if (!session && !isPublicAuthRoute) {
    return redirect("/login");
  }

  return next();
});
