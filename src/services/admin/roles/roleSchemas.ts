import { z } from "zod";

import type { CanonicalRole } from "@/auth/canonicalRoles";

export const PERMISSION_CODES = [
  "dashboard.view",
  "bag.read",
  "alarm.acknowledge",
  "alarm.escalate",
  "alarm.close",
  "alarm.read",
  "bag.manage",
  "bag.tag",
  "tagging.session.start",
  "tagging.tag.capture",
  "tagging.encode",
  "tagging.verify",
  "tagging.photo.capture",
  "tagging.commit",
  "tagging.cancel",
  "tagging.replace",
  "tagging.override.photo",
  "tagging.manual-entry",
  "tagging.inventory.import",
  "tagging.view.history",
  "tagging.metrics.view",
  "bag.recheck",
  "bag.resolve",
  "rfid.read",
  "reader.view",
  "reader.manage",
  "report.view",
  "user.view",
  "user.manage",
  "user.create",
  "user.update",
  "user.activate",
  "user.suspend",
  "user.lock",
  "user.deactivate",
  "user.reset_password",
  "role.view",
  "role.manage",
  "permission.manage",
  "settings.read",
  "settings.manage",
  "audit.view",
  "developer.access",
  "simulator.use",
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

/**
 * Canonical application-side metadata for the persisted permission catalog.
 * The database remains the grant authority; this map only supplies stable UI
 * names and categories for codes that are validated on the server as well.
 */
export const PERMISSION_CATALOG: Readonly<
  Record<
    PermissionCode,
    { name: string; description: string; category: string; riskLevel: PermissionRiskLevel }
  >
> = {
  "dashboard.view": {
    name: "View dashboard",
    description: "View operational dashboards.",
    category: "Dashboard",
    riskLevel: "LOW",
  },
  "bag.read": {
    name: "View bags",
    description: "View operational bag records.",
    category: "Bags",
    riskLevel: "LOW",
  },
  "bag.manage": {
    name: "Manage bags",
    description: "Legacy broad bag-management capability.",
    category: "Bags",
    riskLevel: "MEDIUM",
  },
  "bag.tag": {
    name: "Assign RFID tags",
    description: "Associate RFID tags with identified bags.",
    category: "Bags",
    riskLevel: "HIGH",
  },
  "tagging.session.start": {
    name: "Start tagging sessions",
    description: "Start or resume the active station bag's server-controlled tagging session.",
    category: "Tagging",
    riskLevel: "HIGH",
  },
  "tagging.tag.capture": {
    name: "Capture RFID tag identity",
    description: "Capture the configured RFID barcode and EPC identity.",
    category: "Tagging",
    riskLevel: "HIGH",
  },
  "tagging.encode": {
    name: "Encode RFID tags",
    description: "Run the station's trusted RFID encoder adapter.",
    category: "Tagging",
    riskLevel: "HIGH",
  },
  "tagging.verify": {
    name: "Verify RFID tags",
    description: "Run trusted read-back verification and preserve the evidence.",
    category: "Tagging",
    riskLevel: "HIGH",
  },
  "tagging.photo.capture": {
    name: "Capture bag photos",
    description: "Capture and stage validated bag-photo evidence.",
    category: "Tagging",
    riskLevel: "HIGH",
  },
  "tagging.commit": {
    name: "Commit tag assignments",
    description: "Atomically commit a verified tag assignment and advance the queue.",
    category: "Tagging",
    riskLevel: "CRITICAL",
  },
  "tagging.cancel": {
    name: "Cancel tagging sessions",
    description: "Cancel an incomplete tagging session with an audit reason.",
    category: "Tagging",
    riskLevel: "HIGH",
  },
  "tagging.replace": {
    name: "Replace RFID tags",
    description: "Replace an active RFID tag while retaining assignment history.",
    category: "Tagging",
    riskLevel: "CRITICAL",
  },
  "tagging.override.photo": {
    name: "Override required bag photo",
    description: "Approve a reasoned missing-photo operational-continuity exception.",
    category: "Tagging",
    riskLevel: "CRITICAL",
  },
  "tagging.manual-entry": {
    name: "Enter RFID identity manually",
    description: "Use controlled manual barcode or EPC entry when station configuration permits it.",
    category: "Tagging",
    riskLevel: "HIGH",
  },
  "tagging.inventory.import": {
    name: "Import RFID inventory",
    description: "Validate and import a configured supplier tag inventory.",
    category: "Tagging",
    riskLevel: "CRITICAL",
  },
  "tagging.view.history": {
    name: "View tagging history",
    description: "View tagging sessions, verification attempts, photos, and replacement history.",
    category: "Tagging",
    riskLevel: "MEDIUM",
  },
  "tagging.metrics.view": {
    name: "View tagging metrics",
    description: "View site- and station-scoped software tagging metrics.",
    category: "Tagging",
    riskLevel: "MEDIUM",
  },
  "bag.recheck": {
    name: "Run bag recheck",
    description: "Open recheck cases and request HBSS recall.",
    category: "Bags",
    riskLevel: "HIGH",
  },
  "bag.resolve": {
    name: "Resolve bags",
    description: "Complete an authorized bag resolution.",
    category: "Bags",
    riskLevel: "HIGH",
  },
  "alarm.read": {
    name: "View alarms",
    description: "View alarm information.",
    category: "Alarms",
    riskLevel: "LOW",
  },
  "alarm.acknowledge": {
    name: "Acknowledge alarms",
    description: "Acknowledge active alarms.",
    category: "Alarms",
    riskLevel: "MEDIUM",
  },
  "alarm.escalate": {
    name: "Escalate alarms",
    description: "Escalate an alarm for supervisory response.",
    category: "Alarms",
    riskLevel: "HIGH",
  },
  "alarm.close": {
    name: "Close alarms",
    description: "Close alarms after an authorized resolution.",
    category: "Alarms",
    riskLevel: "HIGH",
  },
  "rfid.read": {
    name: "View RFID activity",
    description: "View RFID journey and event data.",
    category: "RFID",
    riskLevel: "LOW",
  },
  "reader.view": {
    name: "View RFID readers",
    description: "View reader configuration and health.",
    category: "RFID Readers",
    riskLevel: "LOW",
  },
  "reader.manage": {
    name: "Manage RFID readers",
    description: "Change authorized reader configuration.",
    category: "RFID Readers",
    riskLevel: "HIGH",
  },
  "report.view": {
    name: "View reports",
    description: "View and export authorized operational reports.",
    category: "Reports",
    riskLevel: "LOW",
  },
  "audit.view": {
    name: "View audit log",
    description: "View and export authorized audit events.",
    category: "Audit",
    riskLevel: "HIGH",
  },
  "user.view": {
    name: "View users",
    description: "View BELTCON user identities and profile health.",
    category: "Administration",
    riskLevel: "MEDIUM",
  },
  "user.manage": {
    name: "Manage users (legacy)",
    description: "Legacy broad user-management capability.",
    category: "Administration",
    riskLevel: "CRITICAL",
  },
  "user.create": {
    name: "Create users",
    description: "Create user identities and matching profiles.",
    category: "Administration",
    riskLevel: "CRITICAL",
  },
  "user.update": {
    name: "Update users",
    description: "Update non-secret user profile attributes.",
    category: "Administration",
    riskLevel: "HIGH",
  },
  "user.activate": {
    name: "Activate users",
    description: "Activate eligible user accounts.",
    category: "Administration",
    riskLevel: "HIGH",
  },
  "user.suspend": {
    name: "Suspend users",
    description: "Suspend user accounts.",
    category: "Administration",
    riskLevel: "HIGH",
  },
  "user.lock": {
    name: "Lock users",
    description: "Lock or unlock user accounts.",
    category: "Administration",
    riskLevel: "HIGH",
  },
  "user.deactivate": {
    name: "Deactivate users",
    description: "Deactivate user accounts.",
    category: "Administration",
    riskLevel: "CRITICAL",
  },
  "user.reset_password": {
    name: "Reset user passwords",
    description: "Initiate administrative password reset or invitation delivery.",
    category: "Administration",
    riskLevel: "CRITICAL",
  },
  "role.view": {
    name: "View roles",
    description: "View the canonical role-permission matrix.",
    category: "Administration",
    riskLevel: "MEDIUM",
  },
  "role.manage": {
    name: "Manage roles",
    description: "Change role permission assignments.",
    category: "Administration",
    riskLevel: "CRITICAL",
  },
  "permission.manage": {
    name: "Manage permissions",
    description: "Change persisted permission assignments.",
    category: "Administration",
    riskLevel: "CRITICAL",
  },
  "settings.read": {
    name: "View settings",
    description: "View safe system settings.",
    category: "Administration",
    riskLevel: "LOW",
  },
  "settings.manage": {
    name: "Manage settings",
    description: "Change authorized system settings.",
    category: "Administration",
    riskLevel: "CRITICAL",
  },
  "developer.access": {
    name: "Access developer tools",
    description: "Access developer diagnostics.",
    category: "Development",
    riskLevel: "CRITICAL",
  },
  "simulator.use": {
    name: "Use simulators",
    description: "Use enabled non-production simulators.",
    category: "Development",
    riskLevel: "CRITICAL",
  },
  "xray.view": {
    name: "View X-ray scans",
    description: "View authorized X-ray references.",
    category: "X-ray",
    riskLevel: "MEDIUM",
  },
  "xray.refresh": {
    name: "Refresh X-ray scans",
    description: "Request scan refresh from the configured adapter.",
    category: "X-ray",
    riskLevel: "HIGH",
  },
};
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
