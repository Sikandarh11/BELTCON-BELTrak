/* eslint-disable react-refresh/only-export-components -- session context intentionally co-locates its provider and hooks */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { setLastMode, type WorkspaceMode } from "@/auth/appRoles";
import type { AuthSessionResponse, SessionUser } from "@/services/authService";

export type SessionContextValue = {
  user: SessionUser;
  canonicalRole: SessionUser["role"] | null;
  workspaceMode: WorkspaceMode;
  tokenExpiry: string;
  logout: () => void | Promise<void>;
};

type WorkspaceModeContextValue = {
  workspaceMode: WorkspaceMode;
  setWorkspaceMode: (workspaceMode: WorkspaceMode) => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);
const WorkspaceModeContext = createContext<WorkspaceModeContextValue | null>(null);

export function SessionProvider({
  session,
  onLogout,
  children,
}: {
  session: AuthSessionResponse;
  onLogout: () => void | Promise<void>;
  children: ReactNode;
}) {
  const [workspaceMode, setWorkspaceModeState] = useState(session.workspaceMode);

  useEffect(() => {
    setWorkspaceModeState(session.workspaceMode);
  }, [session.workspaceMode]);

  const setWorkspaceMode = useCallback((nextMode: WorkspaceMode) => {
    setLastMode(nextMode);
    setWorkspaceModeState(nextMode);
  }, []);

  const sessionValue = useMemo<SessionContextValue>(
    () => ({
      user: session.user,
      canonicalRole: session.user?.role ?? null,
      workspaceMode,
      tokenExpiry: session.expiresAt,
      logout: onLogout,
    }),
    [onLogout, session.expiresAt, session.user, workspaceMode],
  );

  const workspaceModeValue = useMemo<WorkspaceModeContextValue>(
    () => ({ workspaceMode, setWorkspaceMode }),
    [setWorkspaceMode, workspaceMode],
  );

  return (
    <SessionContext.Provider value={sessionValue}>
      <WorkspaceModeContext.Provider value={workspaceModeValue}>
        {children}
      </WorkspaceModeContext.Provider>
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

export function useWorkspaceMode(): WorkspaceModeContextValue {
  const ctx = useContext(WorkspaceModeContext);
  if (!ctx) {
    throw new Error("useWorkspaceMode must be used inside SessionProvider");
  }
  return ctx;
}

export function useSessionMaybe(): SessionUser | null {
  return useContext(SessionContext)?.user ?? null;
}
