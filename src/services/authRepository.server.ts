import { AUTH_COOKIE_NAME, AUTH_SESSION_DURATION_MS, loginSchema, registerSchema, type AuthSessionResponse, type SessionUser } from "./authService";
import { supabase } from "@/lib/supabaseClient";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const REGISTRATION_KEY = process.env.ETB_REGISTRATION_KEY ?? "";

const REFRESH_COOKIE_NAME = `${AUTH_COOKIE_NAME}_refresh`;
// Keep refresh tokens cookie long-lived (10 years) so users don't need to
// re-register frequently. Note: server-side refresh token validity is still
// controlled by Supabase; this only sets the cookie lifetime.
const LONG_REFRESH_AGE_SECONDS = 60 * 60 * 24 * 3650; // ~10 years

function getCookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function buildCookie(name: string, value: string, expiresInSeconds: number) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "HttpOnly", "Path=/", "SameSite=Strict", `Max-Age=${Math.max(0, Math.floor(expiresInSeconds))}`];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

function clearCookie(name: string) {
  const parts = [`${name}=`, "HttpOnly", "Path=/", "SameSite=Strict", "Max-Age=0"];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

async function supabaseAuthTokenExchange(email: string, password: string) {
  // Use official supabase client for sign-in to avoid raw fetch JSON/content-type issues.
  try {
    const res = await supabase.auth.signInWithPassword({ email, password });
    // res.data: { user, session }
    return {
      access_token: res.data?.session?.access_token,
      refresh_token: res.data?.session?.refresh_token,
      expires_in: res.data?.session?.expires_in,
      user: res.data?.user,
      error: res.error ? { message: res.error.message, status: res.error.status } : undefined,
    };
  } catch (err: any) {
    return { error: { message: err?.message ?? String(err) } };
  }
}

function getTokenErrorMessage(tokenRes: any) {
  return tokenRes?.error_description ?? tokenRes?.error?.message ?? tokenRes?.error ?? tokenRes?.message ?? "Invalid email or password";
}

async function supabaseRefreshTokenExchange(refreshToken: string) {
  const url = `${SUPABASE_URL}/auth/v1/token`;
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      apikey: SUPABASE_ANON_KEY,
    },
    body: body.toString(),
  });

  return res.json();
}

async function supabaseGetUser(accessToken: string) {
  const url = `${SUPABASE_URL}/auth/v1/user`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_ANON_KEY,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

async function supabaseCreateUserAdmin(email: string, password: string, firstName: string, lastName: string) {
  const url = `${SUPABASE_URL}/auth/v1/admin/users`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ email, password, user_metadata: { first_name: firstName, last_name: lastName }, email_confirm: true }),
  });

  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    body = null;
  }

  return { res, body };
}

async function supabaseInsertProfile(id: string, firstName: string, lastName: string, email: string, role = "Operations Officer") {
  const url = `${SUPABASE_URL}/rest/v1/profiles`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify({ id, first_name: firstName, last_name: lastName, email, role }),
  });

  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    body = null;
  }

  return { res, body };
}

async function supabaseUpdateLastLogin(id: string) {
  const url = `${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}`;
  await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify({ last_login: new Date().toISOString() }),
  });
}

function getRegistrationKey() {
  return REGISTRATION_KEY.trim();
}

export async function getSessionFromRequest(request: Request) {
  const token = getCookieValue(request, AUTH_COOKIE_NAME);
  const refresh = getCookieValue(request, REFRESH_COOKIE_NAME);

  // If no access token but refresh exists, try to refresh
  if (!token && refresh) {
    try {
      const refreshed = await supabaseRefreshTokenExchange(refresh);
      if (refreshed?.access_token) {
        const access = refreshed.access_token;
        const user = await supabaseGetUser(access);
        if (!user || !user.id) return null;

        const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=first_name,last_name,email,role,created_at,last_login,is_active`, {
          headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        });
        if (!profileRes.ok) return null;
        const profiles = await profileRes.json();
        const profile = profiles[0];
        if (!profile) return null;

        const sessionUser: SessionUser = {
          id: user.id,
          firstName: profile.first_name,
          lastName: profile.last_name,
          email: profile.email,
          role: profile.role,
          createdAt: profile.created_at,
          lastLogin: profile.last_login ?? null,
        };

        return { token: access, user: sessionUser, expiresAt: new Date(Date.now() + AUTH_SESSION_DURATION_MS).toISOString() };
      }
    } catch {
      return null;
    }
  }

  if (!token) return null;

  const user = await supabaseGetUser(token);
  if (!user || !user.id) return null;

  const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=first_name,last_name,email,role,created_at,last_login,is_active`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!profileRes.ok) return null;
  const profiles = await profileRes.json();
  const profile = profiles[0];
  if (!profile) return null;

  const sessionUser: SessionUser = {
    id: user.id,
    firstName: profile.first_name,
    lastName: profile.last_name,
    email: profile.email,
    role: profile.role,
    createdAt: profile.created_at,
    lastLogin: profile.last_login ?? null,
  };

  return { token, user: sessionUser, expiresAt: new Date(Date.now() + AUTH_SESSION_DURATION_MS).toISOString() };
}

export async function handleAuthRequest(request: Request) {
  try {
    const url = new URL(request.url);

    if (url.pathname === "/api/auth/session" && request.method === "GET") {
      const session = await getSessionFromRequest(request);
      if (!session) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "content-type": "application/json; charset=utf-8" } });

      return new Response(JSON.stringify({ user: session.user, expiresAt: session.expiresAt }), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
    }

    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json; charset=utf-8", "set-cookie": `${clearCookie(AUTH_COOKIE_NAME)}; ${clearCookie(REFRESH_COOKIE_NAME)}` } });
    }

    if (url.pathname === "/api/auth/refresh" && request.method === "POST") {
      const refresh = getCookieValue(request, REFRESH_COOKIE_NAME);
      if (!refresh) return new Response(JSON.stringify({ error: "No refresh token" }), { status: 401, headers: { "content-type": "application/json; charset=utf-8" } });
      const refreshed = await supabaseRefreshTokenExchange(refresh);
      if (!refreshed || !refreshed.access_token) return new Response(JSON.stringify({ error: "Refresh failed" }), { status: 401, headers: { "content-type": "application/json; charset=utf-8" } });

      const access = refreshed.access_token;
      const newRefresh = refreshed.refresh_token;
      const expiresIn = refreshed.expires_in ?? AUTH_SESSION_DURATION_MS / 1000;

      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json; charset=utf-8", "set-cookie": `${buildCookie(AUTH_COOKIE_NAME, access, expiresIn)}; ${buildCookie(REFRESH_COOKIE_NAME, newRefresh, LONG_REFRESH_AGE_SECONDS)}` } });
    }

    if (url.pathname !== "/api/auth/login" && url.pathname !== "/api/auth/register" && url.pathname !== "/api/auth/forgot-password") return null;

    if (request.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { "content-type": "application/json; charset=utf-8" } });

    let parsedBody: unknown;
    try {
      parsedBody = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400, headers: { "content-type": "application/json; charset=utf-8" } });
    }

    if (url.pathname === "/api/auth/login") {
      const parsed = loginSchema.safeParse(parsedBody);
      if (!parsed.success) return new Response(JSON.stringify({ error: "Validation failed" }), { status: 400, headers: { "content-type": "application/json; charset=utf-8" } });

      const email = parsed.data.email.trim().toLowerCase();
      const tokenRes = await supabaseAuthTokenExchange(email, parsed.data.password);
      if (!tokenRes || tokenRes.error || !tokenRes.access_token) {
        console.error("supabaseAuthTokenExchange failed", tokenRes);
        const message = getTokenErrorMessage(tokenRes);
        return new Response(JSON.stringify({ error: message }), { status: 401, headers: { "content-type": "application/json; charset=utf-8" } });
      }

      const user = tokenRes.user as { id: string; email: string; user_metadata?: { first_name?: string; last_name?: string } } | null;
      if (!user) {
        return new Response(JSON.stringify({ error: "Invalid email or password" }), { status: 401, headers: { "content-type": "application/json; charset=utf-8" } });
      }
      // update last_login
      try {
        await supabaseUpdateLastLogin(user.id);
      } catch {}

      // fetch profile
      const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=first_name,last_name,email,role,created_at,last_login,is_active`, { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } });
      const profiles = profileRes.ok ? await profileRes.json() : [];
      const profile = profiles[0];

      const sessionUser: SessionUser = {
        id: user.id,
        firstName: profile?.first_name ?? user.user_metadata?.first_name ?? "",
        lastName: profile?.last_name ?? user.user_metadata?.last_name ?? "",
        email: profile?.email ?? user.email,
        role: profile?.role ?? "Operations Officer",
        createdAt: profile?.created_at ?? new Date().toISOString(),
        lastLogin: profile?.last_login ?? null,
      };

      const access = tokenRes.access_token ?? "";
      const refresh = tokenRes.refresh_token ?? "";
      const expiresIn = tokenRes.expires_in ?? AUTH_SESSION_DURATION_MS / 1000;
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      return new Response(JSON.stringify({ user: sessionUser, expiresAt }), { status: 200, headers: { "content-type": "application/json; charset=utf-8", "set-cookie": `${buildCookie(AUTH_COOKIE_NAME, access, expiresIn)}; ${buildCookie(REFRESH_COOKIE_NAME, refresh, LONG_REFRESH_AGE_SECONDS)}` } });
    }

    if (url.pathname === "/api/auth/forgot-password") {
      const { email } = (parsedBody as any) ?? {};
      if (!email) return new Response(JSON.stringify({ error: "Email required" }), { status: 400, headers: { "content-type": "application/json; charset=utf-8" } });

      const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) return new Response(JSON.stringify({ error: "Unable to send reset email" }), { status: 500, headers: { "content-type": "application/json; charset=utf-8" } });

      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
    }

    // register
    const parsed = registerSchema.safeParse(parsedBody);
    if (!parsed.success) return new Response(JSON.stringify({ error: "Validation failed" }), { status: 400, headers: { "content-type": "application/json; charset=utf-8" } });

    if (getRegistrationKey().length === 0) return new Response(JSON.stringify({ error: "Registration Key Invalid" }), { status: 500, headers: { "content-type": "application/json; charset=utf-8" } });
    if (parsed.data.registrationKey.trim() !== getRegistrationKey()) return new Response(JSON.stringify({ error: "Registration Key Invalid" }), { status: 403, headers: { "content-type": "application/json; charset=utf-8" } });

    const email = parsed.data.email.trim().toLowerCase();
    const firstName = parsed.data.firstName.trim();
    const lastName = parsed.data.lastName.trim();

    const created = await supabaseCreateUserAdmin(email, parsed.data.password, firstName, lastName);
    if (!created || !created.res) {
      console.error("supabaseCreateUserAdmin: no response", created);
      return new Response(JSON.stringify({ error: "Unable to create account (no response from Supabase)" }), { status: 500, headers: { "content-type": "application/json; charset=utf-8" } });
    }

    if (!created.res.ok) {
      console.error("supabaseCreateUserAdmin failed", { status: created.res.status, body: created.body });
      // Handle duplicate email specially
      if (created.body?.error_code === "email_exists" || created.body?.code === 422) {
        return new Response(JSON.stringify({ error: "Email address already registered" }), { status: 409, headers: { "content-type": "application/json; charset=utf-8" } });
      }

      const message = created.body?.message ?? created.body?.error_description ?? JSON.stringify(created.body) ?? "Unknown error";
      return new Response(JSON.stringify({ error: `Unable to create account: ${message}` }), { status: created.res.status || 500, headers: { "content-type": "application/json; charset=utf-8" } });
    }

    const userId = created.body?.id;
    if (!userId) {
      console.error("supabaseCreateUserAdmin missing id", created.body);
      return new Response(JSON.stringify({ error: "Unable to create account: missing user id" }), { status: 500, headers: { "content-type": "application/json; charset=utf-8" } });
    }

    const inserted = await supabaseInsertProfile(userId, firstName, lastName, email, "Operations Officer");
    if (!inserted || !inserted.res) {
      console.error("supabaseInsertProfile: no response", inserted);
      return new Response(JSON.stringify({ error: "Unable to create profile (no response from Supabase)" }), { status: 500, headers: { "content-type": "application/json; charset=utf-8" } });
    }

    if (!inserted.res.ok) {
      console.error("supabaseInsertProfile failed", { status: inserted.res.status, body: inserted.body });
      const message = inserted.body?.message ?? inserted.body?.error ?? JSON.stringify(inserted.body) ?? "Unknown error";
      // If table missing (PGRST205), provide actionable guidance
      if (inserted.body?.code === "PGRST205" || (typeof message === "string" && message.includes("Could not find the table 'public.profiles'"))) {
        return new Response(JSON.stringify({ error: "Unable to create profile: profiles table not found. Run the SQL migration to create public.profiles." }), { status: 500, headers: { "content-type": "application/json; charset=utf-8" } });
      }

      return new Response(JSON.stringify({ error: `Unable to create profile: ${message}` }), { status: inserted.res.status || 500, headers: { "content-type": "application/json; charset=utf-8" } });
    }

    const tokenRes = await supabaseAuthTokenExchange(email, parsed.data.password);
    if (!tokenRes || tokenRes.error || !tokenRes.access_token) {
      console.error("supabaseAuthTokenExchange failed after create", tokenRes);
      return new Response(JSON.stringify({ error: `Account created but sign-in failed: ${getTokenErrorMessage(tokenRes)}` }), { status: 201, headers: { "content-type": "application/json; charset=utf-8" } });
    }

    const user = tokenRes.user as { id: string; email: string; user_metadata?: { first_name?: string; last_name?: string } } | null;
    if (!user) {
      return new Response(JSON.stringify({ error: "Account created but sign-in failed: missing user" }), { status: 201, headers: { "content-type": "application/json; charset=utf-8" } });
    }
    const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=first_name,last_name,email,role,created_at,last_login,is_active`, { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } });
    const profiles = profileRes.ok ? await profileRes.json() : [];
    const profile = profiles[0];

    const sessionUser: SessionUser = {
      id: user.id,
      firstName: profile?.first_name ?? firstName,
      lastName: profile?.last_name ?? lastName,
      email: profile?.email ?? email,
      role: profile?.role ?? "Operations Officer",
      createdAt: profile?.created_at ?? new Date().toISOString(),
      lastLogin: profile?.last_login ?? null,
    };

    const access = tokenRes.access_token ?? "";
    const refresh = tokenRes.refresh_token ?? "";
    const expiresIn = tokenRes.expires_in ?? AUTH_SESSION_DURATION_MS / 1000;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    return new Response(JSON.stringify({ user: sessionUser, expiresAt }), { status: 201, headers: { "content-type": "application/json; charset=utf-8", "set-cookie": `${buildCookie(AUTH_COOKIE_NAME, access, expiresIn)}; ${buildCookie(REFRESH_COOKIE_NAME, refresh, LONG_REFRESH_AGE_SECONDS)}` } });
  } catch (err) {
    console.error("Unhandled error in handleAuthRequest:", err);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500, headers: { "content-type": "application/json; charset=utf-8" } });
  }
}
