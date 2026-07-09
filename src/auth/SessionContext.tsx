import { createContext, useContext, type ReactNode } from "react";
import type { SessionUser } from "@/services/authService";

const SessionContext = createContext<SessionUser | null>(null);

export function SessionProvider({ user, children }: { user: SessionUser; children: ReactNode }) {
  return <SessionContext.Provider value={user}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionUser {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}

export function useSessionMaybe(): SessionUser | null {
  return useContext(SessionContext);
}
