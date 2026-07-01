import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";

import { AUTH_SESSION_KEY, fetchSession, logout, type AuthSessionResponse } from "@/services/authService";

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

export function ProtectedRoute({ children }: { children: (session: AuthSessionResponse) => ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isExpired, setIsExpired] = useState(false);

  const sessionQuery = useQuery({
    queryKey: AUTH_SESSION_KEY,
    queryFn: fetchSession,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });

  useEffect(() => {
    if (sessionQuery.isError) {
      void navigate({ to: "/login", replace: true });
    }
  }, [navigate, sessionQuery.isError]);

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

  if (sessionQuery.isLoading || !sessionQuery.data) {
    return <AuthLoadingScreen />;
  }

  return <>{children(sessionQuery.data)}</>;
}
