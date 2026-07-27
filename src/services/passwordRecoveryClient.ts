import { supabase } from "@/lib/supabaseClient";

function positiveInteger(value: string | null) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function hasPasswordRecoveryParameters() {
  if (typeof window === "undefined") return false;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  return hash.get("type") === "recovery" || query.has("code");
}

export async function establishPasswordRecoverySession() {
  if (!hasPasswordRecoveryParameters()) return false;

  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  let accessToken = hash.get("access_token");
  let refreshToken = hash.get("refresh_token");
  let expiresIn = positiveInteger(hash.get("expires_in"));

  if ((!accessToken || !refreshToken) && query.get("code")) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(query.get("code")!);
    if (error || !data.session) throw new Error("Invalid or expired password recovery link");
    accessToken = data.session.access_token;
    refreshToken = data.session.refresh_token;
    expiresIn = data.session.expires_in;
  }

  if (!accessToken || !refreshToken) {
    const { data } = await supabase.auth.getSession();
    accessToken = data.session?.access_token ?? null;
    refreshToken = data.session?.refresh_token ?? null;
    expiresIn = data.session?.expires_in;
  }

  if (!accessToken || !refreshToken) {
    throw new Error("Invalid or expired password recovery link");
  }

  const response = await fetch("/api/auth/recovery-session", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accessToken, refreshToken, expiresIn }),
  });
  if (!response.ok) throw new Error("Invalid or expired password recovery link");

  window.history.replaceState({}, document.title, "/change-password");
  return true;
}
