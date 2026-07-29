import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, ShieldAlert } from "lucide-react";

import { passwordChangeRedirect } from "@/auth/passwordChangePolicy";
import { hasRoutePermission, permissionRuleForPath } from "@/auth/permissions";
import { BELTCON_QUERY_RETRY, BELTCON_QUERY_STALE_TIME } from "@/lib/queryPolicy";
import {
  AUTH_SESSION_KEY,
  fetchSession,
  logout,
  type AuthSessionResponse,
} from "@/services/authService";

const AUTH_REDIRECT_DELAY_MS = 250;

function AuthLoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white text-slate-900">
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
        <LoaderCircle className="size-5 animate-spin text-cyan-600" />
        <div>
          <div className="text-sm font-medium">Verifying secure session</div>
          <div className="text-xs text-slate-500">BELTrak protected access</div>
        </div>
      </div>
    </div>
  );
}

function AccessDeniedScreen({ pathname }: { pathname: string }) {
  const rule = permissionRuleForPath(pathname);
  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-6 text-slate-900">
      <div className="max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center shadow-sm">
        <ShieldAlert className="mx-auto size-9 text-amber-700" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold">Access Denied</h1>
        <p className="mt-2 text-sm leading-6 text-slate-700">
          You do not have permission to access this BELTCON SBTS page.
        </p>
        <p className="mt-2 font-mono text-xs text-slate-500">Required: {rule.anyOf.join(" or ")}</p>
      </div>
    </div>
  );
}

export function ProtectedRoute({
  children,
}: {
  children: (session: AuthSessionResponse) => ReactNode;
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const queryClient = useQueryClient();
  const [isExpired, setIsExpired] = useState(false);

  const sessionQuery = useQuery({
    queryKey: [...AUTH_SESSION_KEY, pathname],
    queryFn: fetchSession,
    retry: BELTCON_QUERY_RETRY.read,
    refetchOnWindowFocus: true,
    staleTime: BELTCON_QUERY_STALE_TIME.session,
    gcTime: 10 * 60 * 1000,
  });

  useEffect(() => {
    if (sessionQuery.isError && !sessionQuery.isLoading) {
      const timer = window.setTimeout(() => {
        void navigate({ to: "/login", replace: true });
      }, 500);

      return () => window.clearTimeout(timer);
    }
  }, [navigate, sessionQuery.isError, sessionQuery.isLoading]);

  useEffect(() => {
    const forcedPasswordRedirect = passwordChangeRedirect(pathname, sessionQuery.data?.user);
    if (forcedPasswordRedirect) {
      void navigate({ to: forcedPasswordRedirect, replace: true });
    }
  }, [navigate, pathname, sessionQuery.data?.user]);

  useEffect(() => {
    const expiresAt = sessionQuery.data?.expiresAt;

    if (!expiresAt) {
      return;
    }

    const expiresIn = new Date(expiresAt).getTime() - Date.now();
    if (expiresIn <= 0) {
      setIsExpired(true);
      return;
    }

    const timeout = window.setTimeout(() => {
      setIsExpired(true);
    }, expiresIn);

    return () => window.clearTimeout(timeout);
  }, [sessionQuery.data?.expiresAt]);

  useEffect(() => {
    if (!isExpired) {
      return;
    }

    const timer = window.setTimeout(() => {
      void logout().finally(() => {
        queryClient.removeQueries({ queryKey: AUTH_SESSION_KEY });
        void navigate({ to: "/login", replace: true });
      });
    }, AUTH_REDIRECT_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [isExpired, navigate, queryClient]);

  if (
    sessionQuery.isLoading ||
    !sessionQuery.data ||
    Boolean(passwordChangeRedirect(pathname, sessionQuery.data.user))
  ) {
    return <AuthLoadingScreen />;
  }

  // Do not mount page queries until the current session's effective persisted
  // permissions allow this route. The server middleware and APIs repeat this
  // check as the authorization boundary.
  if (
    pathname !== "/access-denied" &&
    !hasRoutePermission(sessionQuery.data.user.permissions, pathname)
  ) {
    return <AccessDeniedScreen pathname={pathname} />;
  }

  return <>{children(sessionQuery.data)}</>;
}
