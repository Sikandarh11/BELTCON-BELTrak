import { fetchSession } from "./authService";

export async function getCurrentUserRole() {
  try {
    const session = await fetchSession();
    return session.user.role;
  } catch {
    return null;
  }
}

export function roleIsAtLeast(role: string, required: string) {
  const order = ["Operations Officer", "Customs Supervisor", "Control Center Operator", "Operations Administrator", "Admin"];
  const r1 = order.indexOf(role);
  const r2 = order.indexOf(required);
  if (r1 === -1 || r2 === -1) return false;
  return r1 >= r2;
}
