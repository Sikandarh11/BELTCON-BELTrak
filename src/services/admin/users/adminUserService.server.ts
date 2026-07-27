import "@tanstack/react-start/server-only";

import { CANONICAL_ROLES, isCanonicalRole, roleIsAtLeast } from "@/auth/canonicalRoles";
import { AdminUserError } from "./adminUserErrors";
import { adminUserRepository, type AdminUserRepository } from "./adminUserRepository.server";
import type {
  AdminAuthIdentity,
  AdminProfileIdentity,
  AdminUser,
  AdminUserActionInput,
  AdminUserActionResult,
  AdminUserListFilters,
  AdminUserPage,
  CreateAdminUserInput,
  CreatedAdminUser,
  EditAdminUserInput,
  InviteAdminUserInput,
  InvitedAdminUser,
  RepairAdminProfileInput,
} from "./adminUserTypes";

export interface AdminUserService {
  listUsers(filters: AdminUserListFilters): Promise<AdminUserPage>;
  repairProfile(input: RepairAdminProfileInput): Promise<AdminUser>;
  createUser(input: CreateAdminUserInput): Promise<CreatedAdminUser>;
  inviteUser(input: InviteAdminUserInput): Promise<InvitedAdminUser>;
  editUser(input: EditAdminUserInput): Promise<AdminUser>;
  performAction(input: AdminUserActionInput): Promise<AdminUserActionResult>;
}

function normalizedEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function reconcileUser(
  authUser: AdminAuthIdentity | null,
  profile: AdminProfileIdentity | null,
): AdminUser {
  if (authUser && !profile) {
    return {
      id: authUser.id,
      email: authUser.email ?? "",
      firstName: authUser.firstName,
      lastName: authUser.lastName,
      role: null,
      status: null,
      isActive: null,
      mustChangePassword: null,
      createdAt: authUser.createdAt,
      lastLogin: authUser.lastSignInAt,
      emailConfirmed: authUser.emailConfirmed,
      syncStatus: "MISSING_PROFILE",
      version: null,
    };
  }

  if (profile && !authUser) {
    return {
      id: profile.id,
      email: profile.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      role: profile.role,
      status: profile.status,
      isActive: profile.isActive,
      mustChangePassword: profile.mustChangePassword,
      createdAt: profile.createdAt,
      lastLogin: profile.lastLogin,
      emailConfirmed: null,
      syncStatus: "MISSING_AUTH_USER",
      version: profile.version,
    };
  }

  if (!authUser || !profile) {
    throw new AdminUserError(
      "Unable to reconcile an empty identity",
      "ADMIN_USER_PERSISTENCE_ERROR",
      500,
    );
  }

  return {
    id: authUser.id,
    email: authUser.email ?? profile.email,
    firstName: profile.firstName,
    lastName: profile.lastName,
    role: profile.role,
    status: profile.status,
    isActive: profile.isActive,
    mustChangePassword: profile.mustChangePassword,
    createdAt: authUser.createdAt,
    lastLogin: authUser.lastSignInAt ?? profile.lastLogin,
    emailConfirmed: authUser.emailConfirmed,
    syncStatus:
      normalizedEmail(authUser.email) === normalizedEmail(profile.email)
        ? "COMPLETE"
        : "EMAIL_MISMATCH",
    version: profile.version,
  };
}

function stableUserSort(left: AdminUser, right: AdminUser) {
  const leftKey =
    `${left.lastName}\u0000${left.firstName}\u0000${left.email}\u0000${left.id}`.toLowerCase();
  const rightKey =
    `${right.lastName}\u0000${right.firstName}\u0000${right.email}\u0000${right.id}`.toLowerCase();
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function matchesFilters(user: AdminUser, filters: AdminUserListFilters) {
  const search = filters.search?.trim().toLowerCase();
  if (search) {
    const searchable = `${user.firstName} ${user.lastName} ${user.email}`.toLowerCase();
    if (!searchable.includes(search)) return false;
  }

  if (filters.role && user.role !== filters.role) return false;
  if (filters.status && user.status !== filters.status) return false;
  if (filters.isActive !== undefined && user.isActive !== filters.isActive) return false;
  if (filters.syncStatus && user.syncStatus !== filters.syncStatus) return false;
  return true;
}

function reconcileAll(
  authUsers: AdminAuthIdentity[],
  profiles: AdminProfileIdentity[],
): AdminUser[] {
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const authIds = new Set(authUsers.map((user) => user.id));
  const users = authUsers.map((authUser) => {
    const profile = profilesById.get(authUser.id) ?? null;
    return reconcileUser(authUser, profile);
  });

  for (const profile of profiles) {
    if (!authIds.has(profile.id)) {
      users.push(reconcileUser(null, profile));
    }
  }

  return users.sort(stableUserSort);
}

export function createAdminUserService(
  repository: AdminUserRepository = adminUserRepository,
): AdminUserService {
  function requireServiceRole(
    actorRole: unknown,
    requiredRole: "Airport Administrator" | "System Administrator",
  ) {
    if (!roleIsAtLeast(actorRole, requiredRole)) {
      throw new AdminUserError(
        `Canonical ${requiredRole} role or higher is required`,
        "ADMIN_USER_FORBIDDEN",
        403,
      );
    }
  }

  async function protectFinalSystemAdministrator(
    profile: AdminProfileIdentity,
    keepsActiveSystemAdministrator: boolean,
  ) {
    if (
      profile.role !== "System Administrator" ||
      profile.status !== "ACTIVE" ||
      !profile.isActive ||
      keepsActiveSystemAdministrator
    ) {
      return;
    }

    if ((await repository.countActiveSystemAdministrators()) <= 1) {
      throw new AdminUserError(
        "The final active System Administrator cannot be demoted or deactivated.",
        "ADMIN_USER_LAST_ADMIN_CONFLICT",
        409,
      );
    }
  }

  return {
    async listUsers(filters) {
      const [authUsers, profiles] = await Promise.all([
        repository.listAllAuthUsers(),
        repository.listAllProfiles(),
      ]);
      const matching = reconcileAll(authUsers, profiles).filter((user) =>
        matchesFilters(user, filters),
      );
      const start = (filters.page - 1) * filters.pageSize;
      const totalPages = Math.ceil(matching.length / filters.pageSize);

      return {
        users: matching.slice(start, start + filters.pageSize),
        pagination: {
          page: filters.page,
          pageSize: filters.pageSize,
          total: matching.length,
          totalPages,
        },
      };
    },

    async repairProfile(input) {
      requireServiceRole(input.canonicalRole, "System Administrator");
      if (!isCanonicalRole(input.role)) {
        throw new AdminUserError(
          "A valid canonical role is required",
          "ADMIN_USER_VALIDATION_ERROR",
          400,
        );
      }

      const authUser = await repository.findAuthUserById(input.userId);
      if (!authUser) {
        throw new AdminUserError(
          "Supabase Auth user was not found",
          "ADMIN_USER_AUTH_USER_NOT_FOUND",
          404,
        );
      }

      const profile = await repository.repairProfile({
        ...input,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
      });

      return reconcileUser(authUser, profile);
    },

    async createUser(input) {
      requireServiceRole(input.canonicalRole, "System Administrator");
      const email = input.email.trim().toLowerCase();
      const firstName = input.firstName.trim();
      const lastName = input.lastName.trim();
      const auditBase = {
        actorId: input.actorId,
        canonicalRole: input.canonicalRole,
        targetEmail: email,
        assignedRole: input.role,
        requestId: input.requestId,
        timestamp: input.timestamp,
      } as const;

      await repository.recordAudit({
        ...auditBase,
        action: "USER_CREATION_REQUESTED",
        targetUserId: null,
        outcome: "REQUESTED",
      });

      let existingProfile: AdminProfileIdentity | null;
      try {
        existingProfile = await repository.findProfileByEmail(email);
      } catch (error) {
        await repository.recordAudit({
          ...auditBase,
          action: "USER_CREATION_FAILED",
          targetUserId: null,
          outcome: "FAILURE",
          errorCode: error instanceof AdminUserError ? error.code : "ADMIN_USER_PERSISTENCE_ERROR",
        });
        throw error;
      }

      if (existingProfile) {
        await repository.recordAudit({
          ...auditBase,
          action: "USER_CREATION_FAILED",
          targetUserId: existingProfile.id,
          outcome: "FAILURE",
          errorCode: "ADMIN_USER_DUPLICATE",
        });
        throw new AdminUserError(
          "An account with this email already exists.",
          "ADMIN_USER_DUPLICATE",
          409,
        );
      }

      let authUser: AdminAuthIdentity;
      try {
        authUser = await repository.createAuthUser({
          email,
          temporaryPassword: input.temporaryPassword,
          firstName,
          lastName,
        });
      } catch (error) {
        await repository.recordAudit({
          ...auditBase,
          action: "USER_CREATION_FAILED",
          targetUserId: null,
          outcome: "FAILURE",
          errorCode:
            error instanceof AdminUserError ? error.code : "ADMIN_USER_AUTH_CREATION_ERROR",
        });
        throw error;
      }

      try {
        await repository.recordAudit({
          ...auditBase,
          action: "AUTH_USER_CREATED",
          targetUserId: authUser.id,
          outcome: "SUCCESS",
        });

        const profile = await repository.createProfile({
          userId: authUser.id,
          firstName,
          lastName,
          role: input.role,
          isActive: input.isActive,
          actorId: input.actorId,
          canonicalRole: input.canonicalRole,
          requestId: input.requestId,
          timestamp: input.timestamp,
        });

        return {
          id: authUser.id,
          email: authUser.email ?? email,
          firstName: profile.firstName,
          lastName: profile.lastName,
          role: input.role,
          status: input.isActive ? "ACTIVE" : "PENDING",
          mustChangePassword: true,
        };
      } catch (profileError) {
        try {
          await repository.deleteAuthUser(authUser.id);
        } catch (cleanupError) {
          const criticalAudits = [
            repository.recordAudit({
              ...auditBase,
              action: "USER_CREATION_COMPENSATION_REQUIRED",
              targetUserId: authUser.id,
              outcome: "CRITICAL",
              errorCode: "AUTH_USER_DELETE_FAILED",
              compensation: "AUTH_USER_DELETE_FAILED",
            }),
            repository.recordAudit({
              ...auditBase,
              action: "USER_CREATION_FAILED",
              targetUserId: authUser.id,
              outcome: "FAILURE",
              errorCode: "ADMIN_USER_COMPENSATION_REQUIRED",
              compensation: "AUTH_USER_DELETE_FAILED",
            }),
          ];
          const auditResults = await Promise.allSettled(criticalAudits);
          if (auditResults.some((result) => result.status === "rejected")) {
            console.error("[BELTrak critical audit] Unable to persist compensation audit", {
              requestId: input.requestId,
              targetUserId: authUser.id,
            });
          }

          throw new AdminUserError(
            "Account creation was incomplete and requires administrator repair.",
            "ADMIN_USER_COMPENSATION_REQUIRED",
            500,
            { cause: cleanupError },
          );
        }

        await repository.recordAudit({
          ...auditBase,
          action: "USER_CREATION_FAILED",
          targetUserId: authUser.id,
          outcome: "COMPENSATED",
          errorCode:
            profileError instanceof AdminUserError
              ? profileError.code
              : "ADMIN_USER_PERSISTENCE_ERROR",
          compensation: "AUTH_USER_DELETED",
        });

        if (
          profileError instanceof AdminUserError &&
          profileError.code === "ADMIN_USER_DUPLICATE"
        ) {
          throw profileError;
        }

        throw new AdminUserError(
          "Unable to create the BELTrak user. The incomplete Auth account was removed.",
          "ADMIN_USER_PERSISTENCE_ERROR",
          500,
          { cause: profileError },
        );
      }
    },

    async inviteUser(input) {
      requireServiceRole(input.canonicalRole, "System Administrator");
      const email = input.email.trim().toLowerCase();
      const firstName = input.firstName.trim();
      const lastName = input.lastName.trim();
      const [existingAuth, existingProfile] = await Promise.all([
        repository.findAuthUserByEmail(email),
        repository.findProfileByEmail(email),
      ]);
      if (existingAuth || existingProfile) {
        throw new AdminUserError(
          "An account with this email already exists.",
          "ADMIN_USER_DUPLICATE",
          409,
        );
      }

      const invited = await repository.inviteAuthUser({
        email,
        firstName,
        lastName,
        redirectTo: input.redirectTo,
      });

      try {
        const profile = await repository.createInvitedProfile({
          userId: invited.user.id,
          firstName,
          lastName,
          role: input.role,
          actorId: input.actorId,
          canonicalRole: input.canonicalRole,
          requestId: input.requestId,
          timestamp: input.timestamp,
          deliveryStatus: invited.deliveryStatus,
        });

        return {
          id: invited.user.id,
          email: invited.user.email ?? email,
          firstName: profile.firstName,
          lastName: profile.lastName,
          role: input.role,
          status: "PENDING",
          mustChangePassword: true,
          deliveryStatus: invited.deliveryStatus,
        };
      } catch (profileError) {
        try {
          await repository.deleteAuthUser(invited.user.id);
        } catch {
          throw new AdminUserError(
            "Invitation creation was incomplete and requires administrator repair.",
            "ADMIN_USER_COMPENSATION_REQUIRED",
            500,
            { cause: profileError },
          );
        }
        throw new AdminUserError(
          "Unable to create the invited BELTrak profile. The Auth account was removed.",
          "ADMIN_USER_PERSISTENCE_ERROR",
          500,
          { cause: profileError },
        );
      }
    },

    async editUser(input) {
      requireServiceRole(input.canonicalRole, "Airport Administrator");

      const [authUser, existingProfile] = await Promise.all([
        repository.findAuthUserById(input.userId),
        repository.findProfileById(input.userId),
      ]);
      if (!authUser || !existingProfile) {
        throw new AdminUserError(
          "A complete Auth user and BELTrak profile are required",
          "ADMIN_USER_NOT_FOUND",
          404,
        );
      }

      if (
        input.canonicalRole !== "System Administrator" &&
        (existingProfile.role === "System Administrator" ||
          input.role === "System Administrator" ||
          input.isActive !== existingProfile.isActive)
      ) {
        throw new AdminUserError(
          "Only a System Administrator may manage privileged roles or account activation.",
          "ADMIN_USER_FORBIDDEN",
          403,
        );
      }

      if (
        input.actorId === input.userId &&
        (!input.isActive || input.role !== existingProfile.role)
      ) {
        throw new AdminUserError(
          "You cannot remove your own administrator access.",
          "ADMIN_USER_FORBIDDEN",
          403,
        );
      }
      await protectFinalSystemAdministrator(
        existingProfile,
        input.role === "System Administrator" && input.isActive,
      );
      const profile = await repository.updateProfile({
        ...input,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        reason: input.reason.trim(),
      });
      return reconcileUser(authUser, profile);
    },

    async performAction(input) {
      requireServiceRole(input.canonicalRole, "System Administrator");
      const [authUser, profile] = await Promise.all([
        repository.findAuthUserById(input.userId),
        repository.findProfileById(input.userId),
      ]);
      if (!authUser || !profile) {
        throw new AdminUserError(
          "A complete Auth user and BELTrak profile are required",
          "ADMIN_USER_NOT_FOUND",
          404,
        );
      }
      if (profile.version !== input.expectedVersion) {
        throw new AdminUserError(
          "This user was changed by another administrator. Refresh and try again.",
          "ADMIN_USER_VERSION_CONFLICT",
          409,
        );
      }
      if (
        input.actorId === input.userId &&
        ["SUSPEND", "LOCK", "DEACTIVATE"].includes(input.action)
      ) {
        throw new AdminUserError(
          "You cannot remove your own administrator access.",
          "ADMIN_USER_FORBIDDEN",
          403,
        );
      }

      if (["SUSPEND", "LOCK", "DEACTIVATE"].includes(input.action)) {
        await protectFinalSystemAdministrator(profile, false);
      }

      if (input.action === "SEND_PASSWORD_RESET" || input.action === "RESEND_INVITATION") {
        if (
          (input.action === "RESEND_INVITATION" && profile.status !== "PENDING") ||
          (input.action === "SEND_PASSWORD_RESET" && profile.status === "DEACTIVATED")
        ) {
          throw new AdminUserError(
            "The requested action is not allowed for this account status",
            "ADMIN_USER_INVALID_TRANSITION",
            409,
          );
        }

        const auditAction =
          input.action === "RESEND_INVITATION" ? "USER_INVITATION_RESENT" : "PASSWORD_RESET_SENT";
        const assignedRole = CANONICAL_ROLES.find((role) => role === profile.role);
        if (!assignedRole) {
          throw new AdminUserError(
            "The BELTrak profile has an invalid canonical role",
            "ADMIN_USER_PERSISTENCE_ERROR",
            500,
          );
        }
        try {
          if (input.action === "RESEND_INVITATION") {
            await repository.resendInvitation(profile.email, input.redirectTo);
          } else {
            await repository.sendPasswordReset(profile.email, input.redirectTo);
          }
          await repository.recordAudit({
            action: auditAction,
            actorId: input.actorId,
            canonicalRole: input.canonicalRole,
            targetUserId: input.userId,
            targetEmail: profile.email,
            assignedRole,
            outcome: "SUCCESS",
            requestId: input.requestId,
            timestamp: input.timestamp,
            reason: input.reason.trim(),
            deliveryStatus: "SENT",
          });
        } catch (error) {
          await repository.recordAudit({
            action: auditAction,
            actorId: input.actorId,
            canonicalRole: input.canonicalRole,
            targetUserId: input.userId,
            targetEmail: profile.email,
            assignedRole,
            outcome: "FAILURE",
            requestId: input.requestId,
            timestamp: input.timestamp,
            reason: input.reason.trim(),
            deliveryStatus: "FAILED",
            errorCode: "ADMIN_USER_EMAIL_DELIVERY_FAILED",
          });
          throw error;
        }

        return {
          user: reconcileUser(authUser, profile),
          action: input.action,
          deliveryStatus: "SENT",
        };
      }

      const updated = await repository.transitionStatus({
        userId: input.userId,
        action: input.action,
        expectedVersion: input.expectedVersion,
        reason: input.reason.trim(),
        actorId: input.actorId,
        canonicalRole: input.canonicalRole,
        requestId: input.requestId,
        timestamp: input.timestamp,
      });
      return {
        user: reconcileUser(authUser, updated),
        action: input.action,
      };
    },
  };
}

export const adminUserService = createAdminUserService();
