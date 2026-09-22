import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BadgeCheck,
  Shield,
  ShieldAlert,
  LockKeyhole,
  PlaneLanding,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";

import {
  FOCUS_MODE_KEY,
  getLastMode,
  getWorkspaceLanding,
  type WorkspaceMode,
} from "@/auth/appRoles";
import {
  WorkspaceModeSelector,
  type WorkspaceModeSelectorHandle,
} from "@/components/WorkspaceModeSelector";
import { AUTH_SESSION_KEY, login, loginSchema, AuthApiError } from "@/services/authService";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Login · BELTrak" }] }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workspaceModeSelectorRef = useRef<WorkspaceModeSelectorHandle>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError: setFieldError,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("Admin");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setWorkspaceMode(getLastMode("Admin"));

    if (window.sessionStorage.getItem(FOCUS_MODE_KEY) === "true") {
      window.sessionStorage.removeItem(FOCUS_MODE_KEY);
      window.requestAnimationFrame(() => workspaceModeSelectorRef.current?.focus());
    }
  }, []);

  async function submit(form: z.infer<typeof loginSchema>) {
    setError(null);

    try {
      const session = await login({ ...form, workspaceMode });
      queryClient.setQueryData(AUTH_SESSION_KEY, session);
      navigate({
        to: session.user.mustChangePassword
          ? "/change-password"
          : getWorkspaceLanding(workspaceMode),
        replace: true,
      });
    } catch (submissionError) {
      if (submissionError instanceof AuthApiError) {
        setError(submissionError.message);
        for (const [field, message] of Object.entries(submissionError.fieldErrors ?? {})) {
          if (field === "email" || field === "password") {
            setFieldError(field, { type: "server", message });
          }
        }
      } else {
        setError("Unable to authenticate. Please try again.");
      }
    } finally {
      // Passwords remain only inside react-hook-form state and are cleared
      // after every attempt; retain email solely to make retry practical.
      reset((current) => ({ ...current, password: "" }));
    }
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.14),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(15,118,110,0.08),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(244,247,250,1))]" />
      <div className="relative grid min-h-screen lg:grid-cols-[1.2fr_0.8fr]">
        <section className="flex flex-col justify-between px-6 py-8 lg:px-10 xl:px-16 xl:py-10">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-2xl border border-cyan-400/30 bg-cyan-400/10 shadow-[0_0_40px_rgba(34,211,238,0.15)]">
              <PlaneLanding className="size-6 -rotate-12 text-cyan-600" />
            </div>
            <div>
              <div className="text-lg font-semibold tracking-tight text-slate-900">BELTrak</div>
              <div className="text-xs uppercase tracking-[0.28em] text-cyan-700/70">
                Operations Suspect Baggage Tracking System
              </div>
            </div>
          </div>

          <div className="max-w-2xl py-14 lg:py-0">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs uppercase tracking-[0.22em] text-cyan-800/80">
              <Shield className="size-3.5" />
              Secure intranet access
            </p>
            <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl xl:text-6xl">
              Operational visibility for baggage security and customs control.
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              Sign in to the internal BELTrak portal to monitor suspect baggage, review alarms, and
              manage operations from a protected network.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {[
                {
                  title: "JWT session",
                  text: "8-hour secure token with automatic expiry.",
                  icon: BadgeCheck,
                },
                {
                  title: "Account lock",
                  text: "5 failed attempts trigger a 15-minute lockout.",
                  icon: ShieldAlert,
                },
                {
                  title: "File-backed MVP",
                  text: "Local JSON storage for controlled intranet deployment.",
                  icon: LockKeyhole,
                },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.title}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-4 backdrop-blur"
                  >
                    <Icon className="size-4 text-cyan-600" />
                    <div className="mt-3 text-sm font-medium text-slate-900">{item.title}</div>
                    <div className="mt-1 text-xs leading-5 text-slate-600">{item.text}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="text-xs uppercase tracking-[0.24em] text-slate-500">
            Operations secure access only
          </div>
        </section>

        <section className="flex items-center justify-center px-6 py-8 lg:px-10 xl:px-16 xl:py-10">
          <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-[0_28px_80px_rgba(15,23,42,0.10)] backdrop-blur-xl sm:p-8">
            <div className="mb-6">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in</h2>
              <p className="mt-2 text-sm text-slate-600">
                Use your credentials to access the operations console.
              </p>
            </div>

            {error ? (
              <div className="mb-4 flex items-start gap-2 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-700">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            <form className="space-y-4" onSubmit={handleSubmit(submit)} noValidate>
              <WorkspaceModeSelector
                ref={workspaceModeSelectorRef}
                workspaceLabel="Continue as"
                workspaceMode={workspaceMode}
                onWorkspaceModeChange={setWorkspaceMode}
              />

              <label className="block space-y-2">
                <span className="text-sm text-slate-700">Email</span>
                <input
                  type="email"
                  {...register("email")}
                  aria-invalid={Boolean(errors.email)}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20"
                  placeholder="name@ops.local"
                  autoComplete="email"
                />
                {errors.email ? (
                  <span className="text-xs text-red-700">{errors.email.message}</span>
                ) : null}
              </label>

              <label className="block space-y-2">
                <span className="flex items-center justify-between text-sm text-slate-700">
                  <span>Password</span>
                  <Link
                    to="/forgot-password"
                    className="text-xs font-medium text-cyan-700 hover:text-cyan-800"
                  >
                    Forgot password?
                  </Link>
                </span>
                <input
                  type="password"
                  {...register("password")}
                  aria-invalid={Boolean(errors.password)}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                />
                {errors.password ? (
                  <span className="text-xs text-red-700">{errors.password.message}</span>
                ) : null}
              </label>

              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSubmitting ? "Signing in..." : "Secure sign in"}
                <ArrowRight className="size-4" />
              </button>
            </form>

            <div className="mt-6 flex items-center justify-between text-sm text-slate-600">
              <span>New user?</span>
              <Link to="/register" className="font-medium text-cyan-600 hover:text-cyan-700">
                Register with a key
              </Link>
            </div>
            <a
              href="/"
              className="mt-4 inline-flex w-full items-center justify-center rounded-2xl border border-slate-200 bg-transparent px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Back to home
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
