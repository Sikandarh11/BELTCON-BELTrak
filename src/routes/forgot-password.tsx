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
      setMessage("If this email exists, a password reset link has been sent.");
    } catch {
      setMessage("Unable to send reset email. Try again later.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-md rounded-2xl border bg-white/6 p-8">
        <h2 className="text-xl font-semibold text-white mb-2">Reset your password</h2>
        <p className="text-sm text-slate-300 mb-4">Enter your account email and we'll send a reset link.</p>

        {message ? <div className="mb-4 text-sm text-slate-200">{message}</div> : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="text-sm text-slate-200">Email</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-2xl border bg-slate-950/60 px-4 py-3 text-sm text-white" />
          </label>

          <button disabled={loading} className="w-full rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950">
            {loading ? "Sending..." : "Send reset link"}
          </button>
        </form>

        <div className="mt-4 text-sm text-slate-300">
          <Link to="/login" className="text-cyan-300">Back to sign in</Link>
        </div>
      </div>
    </div>
  );
}
