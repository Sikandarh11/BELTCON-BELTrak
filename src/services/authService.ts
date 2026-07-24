import { z } from "zod";
import { getLastMode, setLastMode, type WorkspaceMode } from "@/auth/appRoles";

export const AUTH_COOKIE_NAME = "etb_auth_token";
export const AUTH_SESSION_KEY = ["auth", "session"] as const;
// Make client-visible session duration very long (10 years) so sessions
// appear effectively permanent in the UI. Real authentication lifetime is
// controlled by Supabase refresh tokens server-side; we also extend the
// refresh cookie lifetime on the server to match below.
export const AUTH_SESSION_DURATION_MS = 10 * 365 * 24 * 60 * 60 * 1000; // 10 years

export const AUTH_ROLES = [
  "Operations Officer",
  "Customs Supervisor",
  "Control Center Operator",
  "Airport Administrator",
  "System Administrator",
] as const;

const passwordStrengthRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;

export const PASSWORD_REQUIREMENTS =
  "Password must be at least 12 characters and include uppercase, lowercase, number, and special character.";

export const loginSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export const registerSchema = z
  .object({
    firstName: z.string().trim().min(1, "First name is required").max(80, "First name is too long"),
    lastName: z.string().trim().min(1, "Last name is required").max(80, "Last name is too long"),
    email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
    password: z
      .string()
      .min(12, "Password must be at least 12 characters long")
      .regex(passwordStrengthRegex, PASSWORD_REQUIREMENTS),
    confirmPassword: z.string().min(1, "Confirm your password"),
    registrationKey: z.string().trim().min(1, "Registration key is required"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type LoginInput = z.infer<typeof loginSchema> & {
  workspaceMode: WorkspaceMode;
};
export type RegisterInput = z.infer<typeof registerSchema> & {
  workspaceMode: WorkspaceMode;
};

export type SessionUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: (typeof AUTH_ROLES)[number];
  createdAt: string;
  lastLogin: string | null;
};

export type AuthSessionResponse = {
  user: SessionUser;
  expiresAt: string;
  workspaceMode: WorkspaceMode;
};

type AuthSessionApiResponse = Omit<AuthSessionResponse, "workspaceMode">;

export class AuthApiError extends Error {
  fieldErrors?: Record<string, string>;
  status: number;

  constructor(message: string, status = 400, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

async function parseAuthError(response: Response): Promise<AuthApiError> {
  const fallbackMessage = response.status === 401 ? "Unauthorized" : "Request failed";

  try {
    const body = (await response.json()) as {
      error?: string;
      fieldErrors?: Record<string, string>;
    };
    return new AuthApiError(body.error ?? fallbackMessage, response.status, body.fieldErrors);
  } catch {
    return new AuthApiError(fallbackMessage, response.status);
  }
}

async function authJsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    throw await parseAuthError(response);
  }

  return (await response.json()) as T;
}

export async function login(input: LoginInput) {
  const session = await authJsonRequest<AuthSessionApiResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });

  setLastMode(input.workspaceMode);
  return { ...session, workspaceMode: input.workspaceMode };
}

export async function register(input: RegisterInput) {
  const session = await authJsonRequest<AuthSessionApiResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });

  setLastMode(input.workspaceMode);
  return { ...session, workspaceMode: input.workspaceMode };
}

export async function fetchSession(): Promise<AuthSessionResponse> {
  const session = await authJsonRequest<AuthSessionApiResponse>("/api/auth/session");
  // UI hint only, not server-authorized.
  return { ...session, workspaceMode: getLastMode("Admin") };
}

export async function logout() {
  return authJsonRequest<{ ok: true }>("/api/auth/logout", {
    method: "POST",
  });
}

export async function forgotPassword(email: string) {
  return authJsonRequest<{ ok: true }>("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}
