import "@tanstack/react-start/server-only";

import { z } from "zod";

import { supabase } from "@/lib/supabaseClient";
import { getSupabaseAdminClient } from "@/services/supabaseAdmin.server";
import { AdminUserError } from "./adminUserErrors";
import type {
  AdminAuthIdentity,
  AdminProfileIdentity,
  AdminUserAction,
  AdminUserAuditInput,
  CreateInvitedProfileInput,
  CreateAdminAuthUserInput,
  CreateAdminProfileInput,
  EditAdminUserInput,
  InviteAdminAuthUserInput,
  RepairAdminProfileInput,
} from "./adminUserTypes";

const PROFILE_PAGE_SIZE = 1000;
const AUTH_PAGE_SIZE = 1000;

const profileRowSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  role: z.string(),
  status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "LOCKED", "DEACTIVATED"]),
  is_active: z.boolean().nullable(),
  must_change_password: z.boolean(),
  created_at: z.string(),
  last_login: z.string().nullable(),
  updated_at: z.string(),
  created_by: z.string().uuid().nullable(),
  version: z.number().int().min(1),
});

export interface AdminUserRepository {
  listAllAuthUsers(): Promise<AdminAuthIdentity[]>;
  listAllProfiles(): Promise<AdminProfileIdentity[]>;
  findAuthUserById(userId: string): Promise<AdminAuthIdentity | null>;
  findAuthUserByEmail(email: string): Promise<AdminAuthIdentity | null>;
  findProfileById(userId: string): Promise<AdminProfileIdentity | null>;
  findProfileByEmail(email: string): Promise<AdminProfileIdentity | null>;
  countActiveSystemAdministrators(): Promise<number>;
  createAuthUser(input: CreateAdminAuthUserInput): Promise<AdminAuthIdentity>;
  inviteAuthUser(
    input: InviteAdminAuthUserInput,
  ): Promise<{ user: AdminAuthIdentity; deliveryStatus: "SENT" | "FAILED" }>;
  createProfile(input: CreateAdminProfileInput): Promise<AdminProfileIdentity>;
  createInvitedProfile(input: CreateInvitedProfileInput): Promise<AdminProfileIdentity>;
  updateProfile(input: EditAdminUserInput): Promise<AdminProfileIdentity>;
  transitionStatus(
    input: Omit<EditAdminUserInput, "firstName" | "lastName" | "role" | "isActive"> & {
      action: Extract<AdminUserAction, "ACTIVATE" | "SUSPEND" | "LOCK" | "UNLOCK" | "DEACTIVATE">;
    },
  ): Promise<AdminProfileIdentity>;
  resendInvitation(email: string, redirectTo: string): Promise<void>;
  sendPasswordReset(email: string, redirectTo: string): Promise<void>;
  deleteAuthUser(userId: string): Promise<void>;
  recordAudit(input: AdminUserAuditInput): Promise<void>;
  repairProfile(input: RepairAdminProfileInput): Promise<AdminProfileIdentity>;
}

function metadataText(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function mapAuthUser(user: {
  id: string;
  email?: string;
  created_at: string;
  last_sign_in_at?: string;
  email_confirmed_at?: string;
  user_metadata?: Record<string, unknown>;
}): AdminAuthIdentity {
  return {
    id: user.id,
    email: user.email?.trim() || null,
    firstName: metadataText(user.user_metadata, "first_name"),
    lastName: metadataText(user.user_metadata, "last_name"),
    createdAt: user.created_at,
    lastSignInAt: user.last_sign_in_at ?? null,
    emailConfirmed: Boolean(user.email_confirmed_at),
  };
}

function mapProfile(row: unknown): AdminProfileIdentity {
  const parsed = profileRowSchema.safeParse(row);
  if (!parsed.success) {
    throw new AdminUserError(
      "Stored BELTrak profile data is invalid",
      "ADMIN_USER_PERSISTENCE_ERROR",
      500,
      { cause: parsed.error },
    );
  }

  return {
    id: parsed.data.id,
    email: parsed.data.email,
    firstName: parsed.data.first_name,
    lastName: parsed.data.last_name,
    role: parsed.data.role,
    status: parsed.data.status,
    isActive: parsed.data.is_active ?? true,
    mustChangePassword: parsed.data.must_change_password,
    createdAt: parsed.data.created_at,
    lastLogin: parsed.data.last_login,
    updatedAt: parsed.data.updated_at,
    createdBy: parsed.data.created_by,
    version: parsed.data.version,
  };
}

function persistenceError(message: string, cause: unknown) {
  return new AdminUserError(message, "ADMIN_USER_PERSISTENCE_ERROR", 500, { cause });
}

function duplicateError(cause?: unknown) {
  return new AdminUserError(
    "An account with this email already exists.",
    "ADMIN_USER_DUPLICATE",
    409,
    cause === undefined ? undefined : { cause },
  );
}

function safeEmailPattern(email: string) {
  return email.replace(/[\\%_]/g, (value) => `\\${value}`);
}

async function lookupAuthUserByEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  for (let page = 1; ; page += 1) {
    const { data, error } = await getSupabaseAdminClient().auth.admin.listUsers({
      page,
      perPage: AUTH_PAGE_SIZE,
    });
    if (error) throw persistenceError("Unable to check the Supabase Auth email", error);

    const users = data?.users ?? [];
    const match = users.find((user) => user.email?.trim().toLowerCase() === normalized);
    if (match) return mapAuthUser(match);
    if (users.length < AUTH_PAGE_SIZE) return null;
  }
}

function rpcProfile(data: unknown, error: { code?: string } | null, action: string) {
  if (error) {
    if (error.code === "40001") {
      throw new AdminUserError(
        "This user was changed by another administrator. Refresh and try again.",
        "ADMIN_USER_VERSION_CONFLICT",
        409,
        { cause: error },
      );
    }
    if (error.code === "P0002") {
      throw new AdminUserError("BELTrak user profile was not found", "ADMIN_USER_NOT_FOUND", 404, {
        cause: error,
      });
    }
    if (error.code === "P0001") {
      throw new AdminUserError(
        "The requested account status transition is not allowed",
        "ADMIN_USER_INVALID_TRANSITION",
        409,
        { cause: error },
      );
    }
    if (error.code === "P0003") {
      throw new AdminUserError(
        "The final active System Administrator cannot be demoted, deactivated, or deleted.",
        "ADMIN_USER_LAST_ADMIN_CONFLICT",
        409,
        { cause: error },
      );
    }
    if (error.code === "42501") {
      throw new AdminUserError(
        "The requested account change is not permitted",
        "ADMIN_USER_FORBIDDEN",
        403,
        { cause: error },
      );
    }
    throw persistenceError(`Unable to ${action}`, error);
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result) throw persistenceError(`${action} returned no profile`, undefined);
  return mapProfile(result);
}

export const adminUserRepository: AdminUserRepository = {
  async listAllAuthUsers() {
    const users: AdminAuthIdentity[] = [];

    for (let page = 1; ; page += 1) {
      const { data, error } = await getSupabaseAdminClient().auth.admin.listUsers({
        page,
        perPage: AUTH_PAGE_SIZE,
      });

      if (error) {
        throw persistenceError("Unable to load Supabase Auth users", error);
      }

      const pageUsers = data?.users ?? [];
      users.push(...pageUsers.map(mapAuthUser));
      if (pageUsers.length < AUTH_PAGE_SIZE) break;
    }

    return users;
  },

  async listAllProfiles() {
    const profiles: AdminProfileIdentity[] = [];

    for (let offset = 0; ; offset += PROFILE_PAGE_SIZE) {
      const { data, error } = await getSupabaseAdminClient()
        .from("profiles")
        .select(
          "id,email,first_name,last_name,role,status,is_active,must_change_password,created_at,last_login,updated_at,created_by,version",
        )
        .order("id", { ascending: true })
        .range(offset, offset + PROFILE_PAGE_SIZE - 1);

      if (error) {
        throw persistenceError("Unable to load BELTrak profiles", error);
      }

      const rows = data ?? [];
      profiles.push(...rows.map(mapProfile));
      if (rows.length < PROFILE_PAGE_SIZE) break;
    }

    return profiles;
  },

  async findAuthUserById(userId) {
    const { data, error } = await getSupabaseAdminClient().auth.admin.getUserById(userId);

    if (error) {
      if (error.status === 404) return null;
      throw persistenceError("Unable to load the Supabase Auth user", error);
    }

    return data.user ? mapAuthUser(data.user) : null;
  },

  async findAuthUserByEmail(email) {
    return lookupAuthUserByEmail(email);
  },

  async findProfileById(userId) {
    const { data, error } = await getSupabaseAdminClient()
      .from("profiles")
      .select(
        "id,email,first_name,last_name,role,status,is_active,must_change_password,created_at,last_login,updated_at,created_by,version",
      )
      .eq("id", userId)
      .maybeSingle();

    if (error) throw persistenceError("Unable to load the BELTrak profile", error);
    return data ? mapProfile(data) : null;
  },

  async findProfileByEmail(email) {
    const { data, error } = await getSupabaseAdminClient()
      .from("profiles")
      .select(
        "id,email,first_name,last_name,role,status,is_active,must_change_password,created_at,last_login,updated_at,created_by,version",
      )
      .ilike("email", safeEmailPattern(email))
      .limit(1)
      .maybeSingle();

    if (error) {
      throw persistenceError("Unable to check the BELTrak profile email", error);
    }

    return data ? mapProfile(data) : null;
  },

  async countActiveSystemAdministrators() {
    const { count, error } = await getSupabaseAdminClient()
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "System Administrator")
      .eq("status", "ACTIVE")
      .eq("is_active", true);

    if (error) {
      throw persistenceError("Unable to verify active System Administrators", error);
    }

    return count ?? 0;
  },

  async createAuthUser(input) {
    const { data, error } = await getSupabaseAdminClient().auth.admin.createUser({
      email: input.email,
      password: input.temporaryPassword,
      email_confirm: true,
      user_metadata: {
        first_name: input.firstName,
        last_name: input.lastName,
      },
    });

    if (error || !data.user) {
      const errorCode = "code" in (error ?? {}) ? error?.code : undefined;
      const duplicate =
        errorCode === "email_exists" ||
        (error?.status === 422 && /already|registered|exists/i.test(error.message ?? ""));
      if (duplicate) throw duplicateError(error);

      throw new AdminUserError(
        "Unable to create the Supabase Auth account",
        "ADMIN_USER_AUTH_CREATION_ERROR",
        502,
        { cause: error ?? undefined },
      );
    }

    return mapAuthUser(data.user);
  },

  async inviteAuthUser(input) {
    const { data, error } = await getSupabaseAdminClient().auth.admin.inviteUserByEmail(
      input.email,
      {
        data: {
          first_name: input.firstName,
          last_name: input.lastName,
        },
        redirectTo: input.redirectTo,
      },
    );

    if (!error && data.user) {
      return { user: mapAuthUser(data.user), deliveryStatus: "SENT" };
    }

    const existing = await lookupAuthUserByEmail(input.email);
    if (existing && !/already|registered|exists/i.test(error?.message ?? "")) {
      return { user: existing, deliveryStatus: "FAILED" };
    }
    if (existing || /already|registered|exists/i.test(error?.message ?? "")) {
      throw duplicateError(error);
    }

    throw new AdminUserError(
      "Unable to create the Supabase invitation",
      "ADMIN_USER_EMAIL_DELIVERY_FAILED",
      502,
      { cause: error ?? undefined },
    );
  },

  async createProfile(input) {
    const { data, error } = await getSupabaseAdminClient().rpc("create_admin_user_profile_v1", {
      p_user_id: input.userId,
      p_first_name: input.firstName,
      p_last_name: input.lastName,
      p_role: input.role,
      p_is_active: input.isActive,
      p_created_by: input.actorId,
      p_canonical_role: input.canonicalRole,
      p_request_id: input.requestId,
      p_created_at: input.timestamp,
    });

    if (error) {
      if (error.code === "23505") throw duplicateError(error);
      throw persistenceError("Unable to create the BELTrak profile", error);
    }

    const created = Array.isArray(data) ? data[0] : data;
    if (!created) {
      throw persistenceError("Profile creation returned no profile", undefined);
    }

    return mapProfile(created);
  },

  async createInvitedProfile(input) {
    const { data, error } = await getSupabaseAdminClient().rpc("create_invited_user_profile_v1", {
      p_user_id: input.userId,
      p_first_name: input.firstName,
      p_last_name: input.lastName,
      p_role: input.role,
      p_created_by: input.actorId,
      p_canonical_role: input.canonicalRole,
      p_request_id: input.requestId,
      p_created_at: input.timestamp,
      p_delivery_status: input.deliveryStatus,
    });

    if (error?.code === "23505") throw duplicateError(error);
    return rpcProfile(data, error, "create the invited BELTrak profile");
  },

  async updateProfile(input) {
    const { data, error } = await getSupabaseAdminClient().rpc("update_admin_user_profile_v1", {
      p_user_id: input.userId,
      p_first_name: input.firstName,
      p_last_name: input.lastName,
      p_role: input.role,
      p_is_active: input.isActive,
      p_expected_version: input.expectedVersion,
      p_reason: input.reason,
      p_actor_id: input.actorId,
      p_canonical_role: input.canonicalRole,
      p_request_id: input.requestId,
      p_updated_at: input.timestamp,
    });
    return rpcProfile(data, error, "update the BELTrak user");
  },

  async transitionStatus(input) {
    const { data, error } = await getSupabaseAdminClient().rpc("transition_admin_user_status_v1", {
      p_user_id: input.userId,
      p_action: input.action,
      p_expected_version: input.expectedVersion,
      p_reason: input.reason,
      p_actor_id: input.actorId,
      p_canonical_role: input.canonicalRole,
      p_request_id: input.requestId,
      p_updated_at: input.timestamp,
    });
    return rpcProfile(data, error, "change the BELTrak account status");
  },

  async resendInvitation(email, redirectTo) {
    // Supabase invitations create an Auth identity and cannot safely be replayed
    // for that existing identity. Recovery sends a fresh, single-use password
    // setup link without creating a duplicate user.
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) {
      throw new AdminUserError(
        "Supabase could not resend the password-setup invitation",
        "ADMIN_USER_EMAIL_DELIVERY_FAILED",
        502,
        { cause: error },
      );
    }
  },

  async sendPasswordReset(email, redirectTo) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) {
      throw new AdminUserError(
        "Supabase could not deliver the account email",
        "ADMIN_USER_EMAIL_DELIVERY_FAILED",
        502,
        { cause: error },
      );
    }
  },

  async deleteAuthUser(userId) {
    const { error } = await getSupabaseAdminClient().auth.admin.deleteUser(userId);
    if (error) {
      throw persistenceError("Unable to remove the incomplete Supabase Auth account", error);
    }
  },

  async recordAudit(input) {
    const { error } = await getSupabaseAdminClient()
      .from("audit_events")
      .insert({
        action: input.action,
        actor_type: "USER",
        actor_id: input.actorId,
        canonical_role: input.canonicalRole,
        source_system: "BELTRAK_ADMIN",
        outcome: input.outcome,
        error_code: input.errorCode ?? null,
        request_id: input.requestId,
        metadata: {
          targetUserId: input.targetUserId,
          targetEmail: input.targetEmail,
          assignedRole: input.assignedRole,
          ...(input.compensation ? { compensation: input.compensation } : {}),
          ...(input.reason ? { reason: input.reason } : {}),
          ...(input.deliveryStatus ? { deliveryStatus: input.deliveryStatus } : {}),
        },
        created_at: input.timestamp,
      });

    if (error) {
      throw persistenceError("Unable to record the user administration audit event", error);
    }
  },

  async repairProfile(input) {
    const { data, error } = await getSupabaseAdminClient().rpc("repair_user_profile_v2", {
      p_user_id: input.userId,
      p_first_name: input.firstName,
      p_last_name: input.lastName,
      p_role: input.role,
      p_actor_id: input.actorId,
      p_canonical_role: input.canonicalRole,
      p_request_id: input.requestId,
      p_reason: input.reason,
      p_repaired_at: input.timestamp,
    });

    if (error) {
      if (error.code === "P0002") {
        throw new AdminUserError(
          "Supabase Auth user was not found",
          "ADMIN_USER_AUTH_USER_NOT_FOUND",
          404,
          { cause: error },
        );
      }
      throw persistenceError("Unable to repair the BELTrak profile", error);
    }

    const repaired = Array.isArray(data) ? data[0] : data;
    if (!repaired) {
      throw persistenceError("Profile repair returned no profile", undefined);
    }

    return mapProfile(repaired);
  },
};
