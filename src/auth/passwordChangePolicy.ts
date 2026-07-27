import type { SessionUser } from "@/services/authService";

export const PASSWORD_CHANGE_PATH = "/change-password";

export function requiresPasswordChange(user: SessionUser | null | undefined) {
  return user?.mustChangePassword === true;
}

export function passwordChangeRedirect(pathname: string, user: SessionUser | null | undefined) {
  return requiresPasswordChange(user) && pathname !== PASSWORD_CHANGE_PATH
    ? PASSWORD_CHANGE_PATH
    : null;
}

export function blocksOperationalApi(user: SessionUser | null | undefined) {
  return requiresPasswordChange(user);
}
