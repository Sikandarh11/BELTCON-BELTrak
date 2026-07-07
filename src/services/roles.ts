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
  const order = ["Operations Officer", "Control Center Operator", "Customs Supervisor", "Airport Administrator", "System Administrator"];
  const resolveRank = (value: string) => {
    const index = order.indexOf(value);
    if (index === -1) {
      console.warn("Unknown role name:", value);
    }
    return index;
  };

  const r1 = resolveRank(role);
  const r2 = resolveRank(required);
  if (r1 === -1 || r2 === -1) return false;
  return r1 >= r2;
}
