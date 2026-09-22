import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import { supabase } from "@/lib/supabaseClient";
import {
  authAccountService,
  SAFE_SIGN_IN_MESSAGE,
  type AuthIdentity,
} from "@/services/authAccount.server";
import {
  AUTH_COOKIE_NAME,
  AUTH_SESSION_DURATION_MS,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  type SessionUser,
} from "./authService";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const REGISTRATION_KEY = process.env.ETB_REGISTRATION_KEY ?? "";

const REFRESH_COOKIE_NAME = `${AUTH_COOKIE_NAME}_refresh`;
// Keep refresh tokens cookie long-lived (10 years) so users don't need to
// re-register frequently. Note: server-side refresh token validity is still
// controlled by Supabase; this only sets the cookie lifetime.
const LONG_REFRESH_AGE_SECONDS = 60 * 60 * 24 * 3650; // ~10 years
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

const recoverySessionSchema = z
  .object({
    accessToken: z.string().min(20).max(8192),
    refreshToken: z.string().min(20).max(8192),
    expiresIn: z.number().int().min(60).max(86400).optional(),
  })
  .strict();

function getCookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function buildCookie(name: string, value: string, expiresInSeconds: number) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Strict",
    `Max-Age=${Math.max(0, Math.floor(expiresInSeconds))}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

function clearCookie(name: string) {
  const parts = [`${name}=`, "HttpOnly", "Path=/", "SameSite=Strict", "Max-Age=0"];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

function jsonResponse(body: unknown, status = 200, cookies: string[] = []) {
  const headers = new Headers(JSON_HEADERS);
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function authCookies(accessToken: string, refreshToken: string, expiresIn: number) {
  return [
    buildCookie(AUTH_COOKIE_NAME, accessToken, expiresIn),
    buildCookie(REFRESH_COOKIE_NAME, refreshToken, LONG_REFRESH_AGE_SECONDS),
  ];
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
  } catch (error) {
    return {
      error: {
        message: error instanceof Error ? error.message : "Authentication request failed",
      },
    };
  }
}

function validationErrorResponse(error: {
  flatten: () => { fieldErrors: Record<string, string[]> };
}) {
  const flattened = error.flatten();
  const fieldErrors = Object.fromEntries(
    Object.entries(flattened.fieldErrors)
      .filter((entry): entry is [string, string[]] => Boolean(entry[1]?.[0]))
      .map(([field, messages]) => [field, messages[0]]),
  );
  const message = Object.values(fieldErrors)[0] ?? "Validation failed";

  return new Response(JSON.stringify({ error: message, fieldErrors }), {
    status: 400,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
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

async function supabaseCreateUserAdmin(
  email: string,
  password: string,
  firstName: string,
  lastName: string,
) {
  const url = `${SUPABASE_URL}/auth/v1/admin/users`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      email,
      password,
      user_metadata: { first_name: firstName, last_name: lastName },
      email_confirm: true,
    }),
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  return { res, body };
}

async function supabaseInsertProfile(
  id: string,
  firstName: string,
  lastName: string,
  email: string,
  role = "Operations Officer",
) {
  const url = `${SUPABASE_URL}/rest/v1/profiles`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      id,
      first_name: firstName,
      last_name: lastName,
      email,
      role,
      status: "ACTIVE",
      is_active: true,
      must_change_password: false,
    }),
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  return { res, body };
}

function getRegistrationKey() {
  return REGISTRATION_KEY.trim();
}

export interface AuthRepositoryOptions {
  accountService?: typeof authAccountService;
  exchangePassword?: typeof supabaseAuthTokenExchange;
  exchangeRefreshToken?: typeof supabaseRefreshTokenExchange;
  getUser?: typeof supabaseGetUser;
}

async function sessionForAccessToken(accessToken: string, options: AuthRepositoryOptions) {
  const identity = (await (options.getUser ?? supabaseGetUser)(accessToken)) as AuthIdentity | null;
  if (!identity?.id) return null;

  const user = await (options.accountService ?? authAccountService).getSessionUser(identity);
  return {
    token: accessToken,
    user,
    expiresAt: new Date(Date.now() + AUTH_SESSION_DURATION_MS).toISOString(),
  };
}

export async function getSessionFromRequest(request: Request, options: AuthRepositoryOptions = {}) {
  const token = getCookieValue(request, AUTH_COOKIE_NAME);
  const refresh = getCookieValue(request, REFRESH_COOKIE_NAME);

  if (!token && refresh) {
    try {
      const refreshed = await (options.exchangeRefreshToken ?? supabaseRefreshTokenExchange)(
        refresh,
      );
      if (refreshed?.access_token) {
        return await sessionForAccessToken(refreshed.access_token, options);
      }
    } catch {
      return null;
    }
  }

  if (!token) return null;

  try {
    return await sessionForAccessToken(token, options);
  } catch {
    return null;
  }
}

export async function handleAuthRequest(request: Request, options: AuthRepositoryOptions = {}) {
  const url = new URL(request.url);
  const requestId = request.headers.get("x-request-id")?.trim() || randomUUID();
  const accountService = options.accountService ?? authAccountService;
  const handledPaths = new Set([
    "/api/auth/session",
    "/api/auth/logout",
    "/api/auth/refresh",
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/forgot-password",
    "/api/auth/recovery-session",
    "/api/auth/change-password",
  ]);

  if (!handledPaths.has(url.pathname)) return null;

  try {
    if (url.pathname === "/api/auth/session") {
      if (request.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);
      const session = await getSessionFromRequest(request, options);
      if (!session) return jsonResponse({ error: "Unauthorized" }, 401);
      return jsonResponse({ user: session.user, expiresAt: session.expiresAt });
    }

    if (url.pathname === "/api/auth/logout") {
      if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
      return jsonResponse({ ok: true }, 200, [
        clearCookie(AUTH_COOKIE_NAME),
        clearCookie(REFRESH_COOKIE_NAME),
      ]);
    }

    if (url.pathname === "/api/auth/refresh") {
      if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
      const refresh = getCookieValue(request, REFRESH_COOKIE_NAME);
      if (!refresh) return jsonResponse({ error: "Unauthorized" }, 401);

      const refreshed = await (options.exchangeRefreshToken ?? supabaseRefreshTokenExchange)(
        refresh,
      );
      if (!refreshed?.access_token || !refreshed.refresh_token) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }

      const session = await sessionForAccessToken(refreshed.access_token, options);
      if (!session) return jsonResponse({ error: "Unauthorized" }, 401);
      const expiresIn = refreshed.expires_in ?? AUTH_SESSION_DURATION_MS / 1000;
      return jsonResponse({ ok: true }, 200, [
        ...authCookies(refreshed.access_token, refreshed.refresh_token, expiresIn),
      ]);
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    let parsedBody: unknown;
    try {
      parsedBody = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid request body" }, 400);
    }

    if (url.pathname === "/api/auth/forgot-password") {
      const parsed = forgotPasswordSchema.safeParse(parsedBody);
      if (parsed.success) {
        const configuredRedirect = process.env.PASSWORD_RECOVERY_REDIRECT_URL?.trim();
        const redirectTo =
          configuredRedirect || new URL("/change-password", request.url).toString();
        try {
          await accountService.requestPasswordRecovery(parsed.data.email, redirectTo);
        } catch {
          // Account existence and provider delivery failures intentionally share one response.
        }
      }
      return jsonResponse({ ok: true });
    }

    if (url.pathname === "/api/auth/recovery-session") {
      const parsed = recoverySessionSchema.safeParse(parsedBody);
      if (!parsed.success) return jsonResponse({ error: "Invalid recovery session" }, 400);

      let suppliedSession;
      try {
        suppliedSession = await sessionForAccessToken(parsed.data.accessToken, options);
      } catch {
        return jsonResponse({ error: "Invalid or expired recovery session" }, 401);
      }
      if (!suppliedSession) {
        return jsonResponse({ error: "Invalid or expired recovery session" }, 401);
      }

      const refreshed = await (options.exchangeRefreshToken ?? supabaseRefreshTokenExchange)(
        parsed.data.refreshToken,
      );
      if (!refreshed?.access_token || !refreshed.refresh_token) {
        return jsonResponse({ error: "Invalid or expired recovery session" }, 401);
      }

      let refreshedSession;
      try {
        refreshedSession = await sessionForAccessToken(refreshed.access_token, options);
      } catch {
        return jsonResponse({ error: "Invalid or expired recovery session" }, 401);
      }
      if (!refreshedSession || refreshedSession.user.id !== suppliedSession.user.id) {
        return jsonResponse({ error: "Invalid or expired recovery session" }, 401);
      }

      const expiresIn = refreshed.expires_in ?? parsed.data.expiresIn ?? 3600;
      return jsonResponse({ ok: true }, 200, [
        ...authCookies(refreshed.access_token, refreshed.refresh_token, expiresIn),
      ]);
    }

    if (url.pathname === "/api/auth/change-password") {
      const session = await getSessionFromRequest(request, options);
      if (!session) return jsonResponse({ error: "An authenticated session is required" }, 401);

      const parsed = changePasswordSchema.safeParse(parsedBody);
      if (!parsed.success) return validationErrorResponse(parsed.error);

      try {
        await accountService.changePassword({
          user: session.user,
          accessToken: session.token,
          newPassword: parsed.data.newPassword,
          requestId,
          timestamp: new Date().toISOString(),
        });
      } catch {
        return jsonResponse(
          { error: "Unable to change password. Try again or contact your administrator." },
          500,
        );
      }

      return jsonResponse({ ok: true });
    }

    if (url.pathname === "/api/auth/login") {
      const parsed = loginSchema.safeParse(parsedBody);
      if (!parsed.success) return validationErrorResponse(parsed.error);

      const email = parsed.data.email.trim().toLowerCase();
      const tokenRes = await (options.exchangePassword ?? supabaseAuthTokenExchange)(
        email,
        parsed.data.password,
      );
      if (!tokenRes || tokenRes.error || !tokenRes.access_token || !tokenRes.refresh_token) {
        return jsonResponse({ error: "Invalid email or password" }, 401);
      }

      const identity = tokenRes.user as AuthIdentity | null;
      if (!identity?.id) return jsonResponse({ error: "Invalid email or password" }, 401);

      let sessionUser: SessionUser;
      try {
        sessionUser = await accountService.getSessionUser(identity);
        await accountService.recordSuccessfulLogin(identity.id, new Date().toISOString());
      } catch {
        return jsonResponse({ error: SAFE_SIGN_IN_MESSAGE }, 401);
      }

      const expiresIn = tokenRes.expires_in ?? AUTH_SESSION_DURATION_MS / 1000;
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
      return jsonResponse({ user: sessionUser, expiresAt }, 200, [
        ...authCookies(tokenRes.access_token, tokenRes.refresh_token, expiresIn),
      ]);
    }

    const parsed = registerSchema.safeParse(parsedBody);
    if (!parsed.success) return validationErrorResponse(parsed.error);

    if (getRegistrationKey().length === 0) {
      return jsonResponse({ error: "Registration Key Invalid" }, 500);
    }
    if (parsed.data.registrationKey.trim() !== getRegistrationKey()) {
      return jsonResponse({ error: "Registration Key Invalid" }, 403);
    }

    const email = parsed.data.email.trim().toLowerCase();
    const firstName = parsed.data.firstName.trim();
    const lastName = parsed.data.lastName.trim();
    const created = await supabaseCreateUserAdmin(email, parsed.data.password, firstName, lastName);

    if (!created?.res) {
      return jsonResponse({ error: "Unable to create account" }, 500);
    }
    if (!created.res.ok) {
      const providerMessage =
        typeof created.body?.msg === "string"
          ? created.body.msg
          : typeof created.body?.message === "string"
            ? created.body.message
            : "";
      const normalizedProviderMessage = providerMessage.toLowerCase();
      if (
        created.body?.error_code === "email_exists" ||
        normalizedProviderMessage.includes("already registered") ||
        normalizedProviderMessage.includes("already exists") ||
        normalizedProviderMessage.includes("email exists")
      ) {
        return jsonResponse({ error: "Email address already registered" }, 409);
      }
      return jsonResponse(
        { error: providerMessage || "Unable to create account" },
        created.res.status || 500,
      );
    }

    const userId = created.body?.id;
    if (!userId) return jsonResponse({ error: "Unable to create account" }, 500);

    const inserted = await supabaseInsertProfile(
      userId,
      firstName,
      lastName,
      email,
      "Operations Officer",
    );
    if (!inserted?.res?.ok) {
      return jsonResponse({ error: "Unable to create profile" }, inserted?.res?.status || 500);
    }

    const tokenRes = await (options.exchangePassword ?? supabaseAuthTokenExchange)(
      email,
      parsed.data.password,
    );
    if (!tokenRes || tokenRes.error || !tokenRes.access_token || !tokenRes.refresh_token) {
      return jsonResponse({ error: "Account created but sign-in failed" }, 201);
    }

    const identity = tokenRes.user as AuthIdentity | null;
    if (!identity?.id) {
      return jsonResponse({ error: "Account created but sign-in failed" }, 201);
    }

    let sessionUser: SessionUser;
    try {
      sessionUser = await accountService.getSessionUser(identity);
    } catch {
      return jsonResponse({ error: SAFE_SIGN_IN_MESSAGE }, 401);
    }

    const expiresIn = tokenRes.expires_in ?? AUTH_SESSION_DURATION_MS / 1000;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    return jsonResponse({ user: sessionUser, expiresAt }, 201, [
      ...authCookies(tokenRes.access_token, tokenRes.refresh_token, expiresIn),
    ]);
  } catch {
    console.error("[BELTrak auth] Request failed", {
      pathname: url.pathname,
      requestId,
    });
    return jsonResponse({ error: "Internal Server Error" }, 500);
  }
}
