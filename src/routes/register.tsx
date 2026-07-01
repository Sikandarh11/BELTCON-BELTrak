import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, BadgeCheck, ShieldCheck, LockKeyhole, PlaneTakeoff, ShieldAlert } from "lucide-react";
import { useState, type FormEvent } from "react";

import { register, type RegisterInput, AuthApiError, PASSWORD_REQUIREMENTS } from "@/services/authService";

export const Route = createFileRoute("/register")({
  head: () => ({ meta: [{ title: "Register · BELTrak" }] }),
  component: RegisterPage,
});

type RegisterFormState = Omit<RegisterInput, "registrationKey"> & { registrationKey: string };

function RegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<RegisterFormState>({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
    registrationKey: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await register(form);
      navigate({ to: "/", replace: true });
    } catch (submissionError) {
      if (submissionError instanceof AuthApiError) {
        setError(submissionError.message);
      } else {
        setError("Unable to create the account. Please review the form and try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,197,94,0.12),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(34,211,238,0.12),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(244,247,250,1))]" />
      <div className="relative grid min-h-screen lg:grid-cols-[0.9fr_1.1fr]">
        <section className="flex items-center justify-center px-6 py-8 lg:px-10 xl:px-16 xl:py-10">
          <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-[0_28px_80px_rgba(15,23,42,0.10)] backdrop-blur-xl sm:p-8">
            <div className="mb-6">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Create account</h2>
              <p className="mt-2 text-sm text-slate-600">Registration is restricted to users with a valid airport registration key.</p>
            </div>

            {error ? (
              <div className="mb-4 flex items-start gap-2 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-2">
                  <span className="text-sm text-slate-700">First Name</span>
                  <input required value={form.firstName} onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20" placeholder="First name" autoComplete="given-name" />
                </label>

                <label className="block space-y-2">
                  <span className="text-sm text-slate-700">Last Name</span>
                  <input required value={form.lastName} onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20" placeholder="Last name" autoComplete="family-name" />
                </label>
              </div>

              <label className="block space-y-2">
                <span className="text-sm text-slate-700">Email Address</span>
                <input type="email" required value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20" placeholder="name@airport.local" autoComplete="email" />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-2">
                  <span className="text-sm text-slate-700">Password</span>
                  <input type="password" required minLength={12} value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20" placeholder="Create password" autoComplete="new-password" />
                </label>

                <label className="block space-y-2">
                  <span className="text-sm text-slate-700">Confirm Password</span>
                  <input type="password" required value={form.confirmPassword} onChange={(event) => setForm((current) => ({ ...current, confirmPassword: event.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20" placeholder="Confirm password" autoComplete="new-password" />
                </label>
              </div>

              <label className="block space-y-2">
                <span className="text-sm text-slate-700">Registration Key</span>
                <input required value={form.registrationKey} onChange={(event) => setForm((current) => ({ ...current, registrationKey: event.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20" placeholder="Enter registration key" autoComplete="off" />
                <p className="text-xs text-slate-500">Use the registration key issued by airport administration.</p>
              </label>

              <div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/8 p-4 text-xs leading-5 text-slate-600">
                <div className="flex items-center gap-2 text-sm font-medium text-cyan-700">
                  <ShieldCheck className="size-4" />
                  Security controls applied
                </div>
                <p className="mt-2">{PASSWORD_REQUIREMENTS}</p>
              </div>

              <button type="submit" disabled={loading} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-70">
                {loading ? "Creating account..." : "Create secure account"}
                <ArrowRight className="size-4" />
              </button>
            </form>

            <div className="mt-6 flex items-center justify-between text-sm text-slate-600">
              <span>Already registered?</span>
              <Link to="/login" className="font-medium text-cyan-600 hover:text-cyan-700">Sign in</Link>
            </div>
          </div>
        </section>

        <section className="flex flex-col justify-between px-6 py-8 lg:px-10 xl:px-16 xl:py-10">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-2xl border border-cyan-400/30 bg-cyan-400/10 shadow-[0_0_40px_rgba(34,211,238,0.15)]">
              <PlaneTakeoff className="size-6 -rotate-12 text-cyan-600" />
            </div>
            <div>
              <div className="text-lg font-semibold tracking-tight text-slate-900">BELTrak</div>
              <div className="text-xs uppercase tracking-[0.28em] text-cyan-700/70">Airport Suspect Baggage Tracking System</div>
            </div>
          </div>

          <div className="max-w-2xl py-14 lg:py-0">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs uppercase tracking-[0.22em] text-cyan-800/80">
              <BadgeCheck className="size-3.5" />
              Controlled registration for the airport intranet
            </p>
            <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl xl:text-6xl">Every account is validated before it touches the operations network.</h1>
            <p className="mt-5 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              The registration key prevents unauthorized sign-ups, and every password is stored as a bcrypt hash inside the local JSON user database.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {[
                { title: "Unique identity", text: "Email and passport values must not duplicate an existing account.", icon: ShieldCheck },
                { title: "Default role", text: "New users start as Operations Officer until administrators adjust access.", icon: BadgeCheck },
                { title: "Session protection", text: "Sessions are long-lived (client-visible duration ~10 years); tokens are stored in HttpOnly cookies.", icon: LockKeyhole },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 backdrop-blur">
                    <Icon className="size-4 text-cyan-600" />
                    <div className="mt-3 text-sm font-medium text-slate-900">{item.title}</div>
                    <div className="mt-1 text-xs leading-5 text-slate-600">{item.text}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Registration key required for all new accounts</div>
        </section>
      </div>
    </div>
  );
}
