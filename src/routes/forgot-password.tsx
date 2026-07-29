import { createFileRoute, Link } from "@tanstack/react-router";
import { Mail } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";

import { forgotPassword, forgotPasswordSchema } from "@/services/authService";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Forgot Password · BELTrak" }] }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [message, setMessage] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof forgotPasswordSchema>>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  async function submit(input: z.infer<typeof forgotPasswordSchema>) {
    setMessage(null);
    try {
      await forgotPassword(input);
      setMessage("If an account exists for this email, a password reset link has been sent.");
    } catch {
      setMessage("If an account exists for this email, a password reset link has been sent.");
    } finally {
      reset();
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4 text-slate-900">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
        <div className="mb-4 flex size-11 items-center justify-center rounded-2xl bg-cyan-100">
          <Mail className="size-5 text-cyan-700" aria-hidden="true" />
        </div>
        <h1 className="mb-2 text-xl font-semibold text-slate-900">Reset your password</h1>
        <p className="mb-4 text-sm text-slate-600">
          Enter your account email and we&apos;ll send a short-lived Supabase recovery link.
        </p>

        {message ? <div className="mb-4 text-sm text-slate-700">{message}</div> : null}

        <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
          <label className="block">
            <span className="text-sm text-slate-700">Email</span>
            <input
              type="email"
              autoComplete="email"
              {...register("email")}
              aria-invalid={Boolean(errors.email)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400"
            />
            {errors.email ? (
              <span className="mt-1 block text-xs text-red-700">{errors.email.message}</span>
            ) : null}
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-60"
          >
            {isSubmitting ? "Sending..." : "Send reset link"}
          </button>
        </form>

        <div className="mt-4 text-sm text-slate-600">
          <Link to="/login" className="font-medium text-cyan-700 hover:text-cyan-800">
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
