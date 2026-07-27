import type { AdminUserAction } from "@/services/admin/users/adminUserTypes";

export const USER_ACTION_LABELS: Record<AdminUserAction, string> = {
  ACTIVATE: "Activate",
  SUSPEND: "Suspend",
  LOCK: "Lock",
  UNLOCK: "Unlock",
  DEACTIVATE: "Deactivate",
  SEND_PASSWORD_RESET: "Send password reset",
  RESEND_INVITATION: "Resend invitation",
};

export const USER_ACTION_CONSEQUENCES: Record<AdminUserAction, string> = {
  ACTIVATE:
    "The user will be allowed to sign in and access pages permitted by their canonical role.",
  SUSPEND: "The user will be denied new BELTrak sessions until an administrator activates them.",
  LOCK: "The account will be locked and the user will be denied BELTrak access until it is unlocked.",
  UNLOCK: "The account will return to ACTIVE and the user will be allowed to sign in.",
  DEACTIVATE:
    "The account will be disabled for BELTrak access. Its identity and audit history will be retained.",
  SEND_PASSWORD_RESET:
    "Supabase will send a password recovery link to the authoritative Auth email.",
  RESEND_INVITATION:
    "Supabase will send a new password-setup link to the pending user's authoritative Auth email.",
};
