import { z } from "zod";

import type { CanonicalRole } from "@/auth/canonicalRoles";

export const PERMISSION_CODES = [
  "dashboard.view",
  "alarm.acknowledge",
  "alarm.escalate",
  "alarm.close",
  "bag.manage",
  "bag.tag",
  "bag.recheck",
  "reader.view",
  "reader.manage",
  "report.view",
  "user.view",
  "user.manage",
  "role.view",
  "role.manage",
  "settings.manage",
  "audit.view",
  "developer.access",
  "xray.view",
  "xray.refresh",
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];

export const CRITICAL_SYSTEM_ADMIN_PERMISSIONS = [
  "role.view",
  "role.manage",
  "user.view",
  "user.manage",
  "settings.manage",
] as const satisfies readonly PermissionCode[];

export const permissionCodeSchema = z.enum(PERMISSION_CODES);
export const rolePermissionIdSchema = z.string().uuid("A valid role ID is required");

const changeReasonSchema = z
  .string()
  .trim()
  .min(3, "A change reason of at least 3 characters is required")
  .max(500, "Change reason must be 500 characters or fewer");

export const updateRolePermissionsSchema = z
  .object({
    permissionCodes: z
      .array(z.string().trim().min(1).max(80))
      .max(PERMISSION_CODES.length, "Too many permission codes were supplied"),
    expectedVersion: z.number().int().min(1),
    reason: changeReasonSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.permissionCodes).size !== input.permissionCodes.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["permissionCodes"],
        message: "Permission codes must not contain duplicates",
      });
    }
  });

export const rolePermissionUpdateResultSchema = z.object({
  roleId: z.string().uuid(),
  roleCode: z.string().min(1),
  version: z.number().int().min(2),
  beforePermissionCodes: z.array(permissionCodeSchema),
  afterPermissionCodes: z.array(permissionCodeSchema),
});

export type PermissionRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface PermissionDefinition {
  id: string;
  code: PermissionCode;
  name: string;
  description: string;
  category: string;
  riskLevel: PermissionRiskLevel;
}

export interface RoleWithPermissions {
  id: string;
  code: string;
  name: CanonicalRole;
  description: string;
  isSystem: boolean;
  isActive: boolean;
  version: number;
  permissionCodes: PermissionCode[];
}

export interface RolesWithPermissions {
  roles: RoleWithPermissions[];
  permissions: PermissionDefinition[];
}

export interface UpdateRolePermissionsRequest {
  permissionCodes: string[];
  expectedVersion: number;
  reason: string;
}

export interface UpdateRolePermissionsInput extends UpdateRolePermissionsRequest {
  roleId: string;
  actorId: string;
  canonicalRole: CanonicalRole;
  requestId: string;
  timestamp: string;
}

export interface RolePermissionUpdateResult {
  roleId: string;
  roleCode: string;
  version: number;
  beforePermissionCodes: PermissionCode[];
  afterPermissionCodes: PermissionCode[];
}

export interface RolePermissionFailureAuditInput {
  actorId: string;
  canonicalRole: CanonicalRole;
  roleId: string;
  beforePermissionCodes: PermissionCode[];
  afterPermissionCodes: string[];
  reason: string;
  expectedVersion: number;
  requestId: string;
  timestamp: string;
  errorCode: string;
}
