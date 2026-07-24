import { createContext, useContext, type ReactNode } from "react";
import type { AppRole } from "@/auth/appRoles";
import type { AuthSessionResponse, SessionUser } from "@/services/authService";

export type SessionContextValue = {
  user: SessionUser;
  role: AppRole;
  tokenExpiry: string;
  logout: () => void | Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({
  session,
  onLogout,
  children,
}: {
  session: AuthSessionResponse;
  onLogout: () => void | Promise<void>;
  children: ReactNode;
}) {
  return (
    <SessionContext.Provider
      value={{
        user: session.user,
        role: session.role,
        tokenExpiry: session.expiresAt,
        logout: onLogout,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionUser {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx.user;
}

export function useAuthSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useAuthSession must be used inside SessionProvider");
  return ctx;
}

export function useSessionMaybe(): SessionUser | null {
  return useContext(SessionContext)?.user ?? null;
}
