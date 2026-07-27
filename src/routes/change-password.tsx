import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { KeyRound, LoaderCircle, LogOut, ShieldCheck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { getWorkspaceLanding } from "@/auth/appRoles";
import {
  AUTH_SESSION_KEY,
  changePassword,
  changePasswordSchema,
  fetchSession,
  logout,
  PASSWORD_REQUIREMENTS,
} from "@/services/authService";
import {
  establishPasswordRecoverySession,
  hasPasswordRecoveryParameters,
} from "@/services/passwordRecoveryClient";

export const Route = createFileRoute("/change-password")({
  head: () => ({ meta: [{ title: "Change Password · BELTrak" }] }),
  component: ChangePasswordPage,
});

function ChangePasswordPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [form, setForm] = useState({ newPassword: "", confirmPassword: "" });
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        if (hasPasswordRecoveryParameters()) {
          await establishPasswordRecoverySession();
        }
        if (active) setRecoveryReady(true);
      } catch {
        if (active) {
          setRecoveryError("This password recovery link is invalid or has expired.");
          setRecoveryReady(true);
        }
      }
    }

    void initialize();
    return () => {
      active = false;
    };
  }, []);

  const sessionQuery = useQuery({
    queryKey: AUTH_SESSION_KEY,
    queryFn: fetchSession,
    enabled: recoveryReady && !recoveryError,
    retry: false,
    staleTime: 0,
  });

  useEffect(() => {
    if (recoveryReady && !recoveryError && sessionQuery.isError) {
      void navigate({ to: "/login", replace: true });
    }
  }, [navigate, recoveryError, recoveryReady, sessionQuery.isError]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = changePasswordSchema.safeParse(form);
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Check the new password");
      return;
    }

    setValidationError(null);
    setSubmitting(true);
    try {
      await changePassword(parsed.data);
      const session = await fetchSession();
      queryClient.setQueryData(AUTH_SESSION_KEY, session);
      await navigate({
        to: getWorkspaceLanding(session.workspaceMode),
        replace: true,
      });
    } catch {
      setValidationError("Unable to change password. Try again or contact your administrator.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    await logout().catch(() => undefined);
    queryClient.removeQueries({ queryKey: AUTH_SESSION_KEY });
    await navigate({ to: "/login", replace: true });
  }

  if (!recoveryReady || sessionQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <LoaderCircle className="size-5 animate-spin text-cyan-600" aria-hidden="true" />
          Verifying password-change session
        </div>
      </div>
    );
  }

  if (recoveryError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-xl">
          <KeyRound className="mx-auto size-8 text-red-600" aria-hidden="true" />
          <h1 className="mt-4 text-xl font-semibold">Recovery link unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">{recoveryError}</p>
          <button
            type="button"
            onClick={() => navigate({ to: "/forgot-password" })}
            className="mt-5 rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950"
          >
            Request another link
          </button>
        </div>
      </div>
    );
  }

  if (!sessionQuery.data) return null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8 text-slate-900">
      <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.12)] sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex size-11 items-center justify-center rounded-2xl bg-cyan-100">
              <ShieldCheck className="size-5 text-cyan-700" aria-hidden="true" />
            </div>
            <h1 className="mt-4 text-2xl font-semibold">Choose a new password</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {sessionQuery.data.user.mustChangePassword
                ? "Your temporary password must be replaced before you can access BELTrak."
                : "Set a new password for your BELTrak account."}
            </p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
          >
            <LogOut className="size-3.5" aria-hidden="true" />
            Sign out
          </button>
        </div>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <label className="block space-y-2">
            <span className="text-sm font-medium">New password</span>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={form.newPassword}
              onChange={(event) =>
                setForm((current) => ({ ...current, newPassword: event.target.value }))
              }
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium">Confirm new password</span>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={form.confirmPassword}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  confirmPassword: event.target.value,
                }))
              }
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
            />
          </label>

          <p className="text-xs leading-5 text-slate-500">{PASSWORD_REQUIREMENTS}</p>

          {validationError && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {validationError}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
          >
            {submitting ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <KeyRound className="size-4" aria-hidden="true" />
            )}
            {submitting ? "Changing password…" : "Change password"}
          </button>
        </form>
      </div>
    </div>
  );
}
