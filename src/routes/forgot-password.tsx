import { createFileRoute, Link } from "@tanstack/react-router";
import { Mail } from "lucide-react";
import { useState, type FormEvent } from "react";
import { forgotPassword } from "@/services/authService";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Forgot Password · BELTrak" }] }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setLoading(true);
    try {
      await forgotPassword(email);
      setMessage("If an account exists for this email, a password reset link has been sent.");
    } catch {
      setMessage("If an account exists for this email, a password reset link has been sent.");
    } finally {
      setLoading(false);
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

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="text-sm text-slate-700">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400"
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-60"
          >
            {loading ? "Sending..." : "Send reset link"}
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
