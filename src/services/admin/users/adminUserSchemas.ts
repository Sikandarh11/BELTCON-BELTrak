import { z } from "zod";

import { canonicalRoleSchema } from "@/auth/canonicalRoles";
import { strongPasswordSchema } from "@/services/authService";
import {
  ADMIN_USER_ACTIONS,
  ADMIN_USER_STATUSES,
  ADMIN_USER_SYNC_STATUSES,
} from "./adminUserTypes";

export const adminUserSyncStatusSchema = z.enum(ADMIN_USER_SYNC_STATUSES);
export const adminUserIdSchema = z.string().uuid("A valid user ID is required");
export const adminUserStatusSchema = z.enum(ADMIN_USER_STATUSES);

const optionalQueryValue = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

export const adminUserListQuerySchema = z.object({
  search: z.preprocess(
    optionalQueryValue,
    z.string().trim().max(160, "Search is too long").optional(),
  ),
  role: z.preprocess(optionalQueryValue, canonicalRoleSchema.optional()),
  status: z.preprocess(optionalQueryValue, adminUserStatusSchema.optional()),
  active: z.preprocess(optionalQueryValue, z.enum(["true", "false"]).optional()),
  syncStatus: z.preprocess(optionalQueryValue, adminUserSyncStatusSchema.optional()),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const repairAdminProfileSchema = z
  .object({
    firstName: z.string().trim().min(1, "First name is required").max(80),
    lastName: z.string().trim().min(1, "Last name is required").max(80),
    role: canonicalRoleSchema,
    reason: z.string().trim().min(3, "A reason of at least 3 characters is required").max(500),
  })
  .strict();

export const createAdminUserSchema = z
  .object({
    firstName: z.string().trim().min(1, "First name is required").max(80),
    lastName: z.string().trim().min(1, "Last name is required").max(80),
    email: z
      .string()
      .trim()
      .email("A valid email address is required")
      .transform((email) => email.toLowerCase()),
    temporaryPassword: strongPasswordSchema,
    confirmPassword: z.string().min(1, "Password confirmation is required"),
    role: canonicalRoleSchema,
    isActive: z.boolean(),
  })
  .strict()
  .refine((input) => input.temporaryPassword === input.confirmPassword, {
    message: "Temporary password and confirmation must match",
    path: ["confirmPassword"],
  });

export const inviteAdminUserSchema = z
  .object({
    firstName: z.string().trim().min(1, "First name is required").max(80),
    lastName: z.string().trim().min(1, "Last name is required").max(80),
    email: z
      .string()
      .trim()
      .email("A valid email address is required")
      .transform((email) => email.toLowerCase()),
    role: canonicalRoleSchema,
  })
  .strict();

const reasonSchema = z
  .string()
  .trim()
  .min(3, "A reason of at least 3 characters is required")
  .max(500, "Reason must be 500 characters or fewer");

export const editAdminUserSchema = z
  .object({
    firstName: z.string().trim().min(1, "First name is required").max(80),
    lastName: z.string().trim().min(1, "Last name is required").max(80),
    role: canonicalRoleSchema,
    isActive: z.boolean(),
    expectedVersion: z.number().int().min(1),
    reason: reasonSchema,
  })
  .strict();

export const adminUserActionSchema = z
  .object({
    action: z.enum(ADMIN_USER_ACTIONS),
    expectedVersion: z.number().int().min(1),
    reason: reasonSchema,
  })
  .strict();
