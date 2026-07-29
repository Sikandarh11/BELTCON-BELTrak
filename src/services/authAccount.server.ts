import "@tanstack/react-start/server-only";

import { z } from "zod";

import { canonicalRoleSchema, type CanonicalRole } from "@/auth/canonicalRoles";
import { supabase } from "@/lib/supabaseClient";
import {
  loadEffectiveAuthorization,
  type EffectiveAuthorization,
} from "@/services/authorization/permissionAuthorization.server";
import { getSupabaseAdminClient } from "@/services/supabaseAdmin.server";
import { ACCOUNT_STATUSES, type SessionUser } from "@/services/authService";

export const SAFE_SIGN_IN_MESSAGE = "Unable to sign in. Contact your administrator.";

const authProfileRowSchema = z.object({
  id: z.string().uuid(),
  first_name: z.string(),
  last_name: z.string(),
  email: z.string().email(),
  role: canonicalRoleSchema,
  status: z.enum(ACCOUNT_STATUSES),
  is_active: z.boolean(),
  must_change_password: z.boolean(),
  created_at: z.string(),
  last_login: z.string().nullable(),
});

export type AuthProfile = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: SessionUser["role"];
  status: SessionUser["status"];
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastLogin: string | null;
};

export type AuthIdentity = {
  id: string;
  email?: string | null;
};

export type CompletePasswordChangeInput = {
  userId: string;
  actorId: string;
  canonicalRole: CanonicalRole;
  requestId: string;
  timestamp: string;
  otherSessionsRevoked: boolean;
};

export interface AuthAccountRepository {
  findProfileByUserId(userId: string): Promise<AuthProfile | null>;
  updateLastLogin(userId: string, timestamp: string): Promise<void>;
  updatePassword(userId: string, newPassword: string): Promise<void>;
  revokeOtherSessions(accessToken: string): Promise<void>;
  completePasswordChange(input: CompletePasswordChangeInput): Promise<AuthProfile>;
  sendPasswordRecovery(email: string, redirectTo: string): Promise<void>;
}

type AuthorizationLoader = (userId: string) => Promise<EffectiveAuthorization>;

export class AuthAccountError extends Error {
  readonly code:
    | "ACCOUNT_INELIGIBLE"
    | "PASSWORD_CHANGE_FAILED"
    | "PASSWORD_CHANGE_PERSISTENCE_FAILED";

  constructor(
    message: string,
    code: "ACCOUNT_INELIGIBLE" | "PASSWORD_CHANGE_FAILED" | "PASSWORD_CHANGE_PERSISTENCE_FAILED",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AuthAccountError";
    this.code = code;
  }
}

function mapProfile(row: unknown): AuthProfile {
  const parsed = authProfileRowSchema.safeParse(row);
  if (!parsed.success) {
    throw new AuthAccountError(SAFE_SIGN_IN_MESSAGE, "ACCOUNT_INELIGIBLE", {
      cause: parsed.error,
    });
  }

  return {
    id: parsed.data.id,
    firstName: parsed.data.first_name,
    lastName: parsed.data.last_name,
    email: parsed.data.email.trim().toLowerCase(),
    role: parsed.data.role,
    status: parsed.data.status,
    isActive: parsed.data.is_active,
    mustChangePassword: parsed.data.must_change_password,
    createdAt: parsed.data.created_at,
    lastLogin: parsed.data.last_login,
  };
}

export function isEligibleProfile(profile: AuthProfile | null): profile is AuthProfile {
  return profile !== null && profile.status === "ACTIVE" && profile.isActive;
}

export function sessionUserFromProfile(
  identity: AuthIdentity,
  profile: AuthProfile | null,
  authorization: Pick<EffectiveAuthorization, "permissions" | "authorizationVersion"> = {
    permissions: [],
    authorizationVersion: 0,
  },
): SessionUser {
  if (!isEligibleProfile(profile) || profile.id !== identity.id) {
    throw new AuthAccountError(SAFE_SIGN_IN_MESSAGE, "ACCOUNT_INELIGIBLE");
  }

  return {
    id: identity.id,
    firstName: profile.firstName,
    lastName: profile.lastName,
    email: profile.email,
    role: profile.role,
    status: profile.status,
    isActive: profile.isActive,
    mustChangePassword: profile.mustChangePassword,
    createdAt: profile.createdAt,
    lastLogin: profile.lastLogin,
    permissions: authorization.permissions,
    authorizationVersion: authorization.authorizationVersion,
  };
}

export const authAccountRepository: AuthAccountRepository = {
  async findProfileByUserId(userId) {
    const { data, error } = await getSupabaseAdminClient()
      .from("profiles")
      .select(
        "id,first_name,last_name,email,role,status,is_active,must_change_password,created_at,last_login",
      )
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      throw new AuthAccountError(SAFE_SIGN_IN_MESSAGE, "ACCOUNT_INELIGIBLE", {
        cause: error,
      });
    }

    return data ? mapProfile(data) : null;
  },

  async updateLastLogin(userId, timestamp) {
    const { error } = await getSupabaseAdminClient()
      .from("profiles")
      .update({ last_login: timestamp, updated_at: timestamp })
      .eq("id", userId);

    if (error) {
      throw new AuthAccountError(
        "Unable to update login activity",
        "PASSWORD_CHANGE_PERSISTENCE_FAILED",
        {
          cause: error,
        },
      );
    }
  },

  async updatePassword(userId, newPassword) {
    const { error } = await getSupabaseAdminClient().auth.admin.updateUserById(userId, {
      password: newPassword,
    });

    if (error) {
      throw new AuthAccountError("Unable to change the password", "PASSWORD_CHANGE_FAILED", {
        cause: error,
      });
    }
  },

  async revokeOtherSessions(accessToken) {
    const { error } = await getSupabaseAdminClient().auth.admin.signOut(accessToken, "others");
    if (error) {
      throw new AuthAccountError(
        "Unable to revoke other sessions",
        "PASSWORD_CHANGE_PERSISTENCE_FAILED",
        { cause: error },
      );
    }
  },

  async completePasswordChange(input) {
    const { data, error } = await getSupabaseAdminClient().rpc("complete_password_change_v1", {
      p_user_id: input.userId,
      p_actor_id: input.actorId,
      p_canonical_role: input.canonicalRole,
      p_request_id: input.requestId,
      p_changed_at: input.timestamp,
      p_other_sessions_revoked: input.otherSessionsRevoked,
    });

    if (error) {
      throw new AuthAccountError(
        "Password changed, but BELTrak could not complete the account update",
        "PASSWORD_CHANGE_PERSISTENCE_FAILED",
        { cause: error },
      );
    }

    const profile = Array.isArray(data) ? data[0] : data;
    if (!profile) {
      throw new AuthAccountError(
        "Password changed, but BELTrak could not complete the account update",
        "PASSWORD_CHANGE_PERSISTENCE_FAILED",
      );
    }

    return mapProfile(profile);
  },

  async sendPasswordRecovery(email, redirectTo) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    if (error) throw error;
  },
};

export function createAuthAccountService(
  repository: AuthAccountRepository = authAccountRepository,
  authorizationLoader?: AuthorizationLoader,
) {
  const loadAuthorization =
    authorizationLoader ??
    (repository === authAccountRepository
      ? loadEffectiveAuthorization
      : async (userId: string): Promise<EffectiveAuthorization> => ({
          canonicalRole:
            (await repository.findProfileByUserId(userId))?.role ?? "Operations Officer",
          userId,
          profileId: userId,
          permissions: [],
          accountStatus: "ACTIVE",
          authorizationVersion: 0,
        }));

  return {
    async getSessionUser(identity: AuthIdentity) {
      const profile = await repository.findProfileByUserId(identity.id);
      const authorization = isEligibleProfile(profile)
        ? await loadAuthorization(identity.id)
        : { permissions: [], authorizationVersion: 0 };
      return sessionUserFromProfile(identity, profile, authorization);
    },

    async recordSuccessfulLogin(userId: string, timestamp: string) {
      await repository.updateLastLogin(userId, timestamp);
    },

    async changePassword(input: {
      user: SessionUser;
      accessToken: string;
      newPassword: string;
      requestId: string;
      timestamp: string;
    }) {
      await repository.updatePassword(input.user.id, input.newPassword);

      let otherSessionsRevoked = true;
      try {
        await repository.revokeOtherSessions(input.accessToken);
      } catch {
        otherSessionsRevoked = false;
      }

      const profile = await repository.completePasswordChange({
        userId: input.user.id,
        actorId: input.user.id,
        canonicalRole: input.user.role,
        requestId: input.requestId,
        timestamp: input.timestamp,
        otherSessionsRevoked,
      });
      const authorization = await loadAuthorization(input.user.id);

      return {
        user: sessionUserFromProfile(
          { id: input.user.id, email: input.user.email },
          profile,
          authorization,
        ),
        otherSessionsRevoked,
      };
    },

    async requestPasswordRecovery(email: string, redirectTo: string) {
      await repository.sendPasswordRecovery(email, redirectTo);
    },
  };
}

export const authAccountService = createAuthAccountService();
