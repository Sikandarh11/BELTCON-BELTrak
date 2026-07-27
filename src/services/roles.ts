import { fetchSession } from "./authService";
export {
  canonicalRoleRank,
  compareCanonicalRoles,
  isCanonicalRole,
  requireCanonicalRole,
  roleIsAtLeast,
} from "@/auth/canonicalRoles";

export async function getCurrentUserRole() {
  try {
    const session = await fetchSession();
    return session.user.role;
  } catch {
    return null;
  }
}
