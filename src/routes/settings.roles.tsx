import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useBlocker } from "@tanstack/react-router";
import { AlertTriangle, LoaderCircle, RefreshCw, Save, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";

import { hasPermission } from "@/auth/permissions";
import { useSession } from "@/auth/SessionContext";
import { Panel, PageHeader } from "@/components/AppLayout";
import { PermissionGate } from "@/components/RoleGate";
import {
  ADMIN_ROLE_PERMISSIONS_QUERY_KEY,
  RolePermissionApiError,
  getRolesWithPermissions,
  updateRolePermissions,
} from "@/services/admin/roles/roleClient";
import {
  CRITICAL_SYSTEM_ADMIN_PERMISSIONS,
  type PermissionCode,
  type RolesWithPermissions,
} from "@/services/admin/roles/roleSchemas";
import { AUTH_SESSION_KEY } from "@/services/authService";

export const Route = createFileRoute("/settings/roles")({
  head: () => ({ meta: [{ title: "Manage Roles · BELTrak" }] }),
  component: ManageRoles,
});

type PermissionDraft = Record<string, PermissionCode[]>;

function matrixDraft(data: RolesWithPermissions): PermissionDraft {
  return Object.fromEntries(data.roles.map((role) => [role.id, [...role.permissionCodes]]));
}

function samePermissionCodes(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((code) => rightSet.has(code));
}

function LoadingMatrix() {
  return (
    <Panel className="!p-0 overflow-hidden">
      <div className="animate-pulse">
        <div className="h-12 border-b border-border bg-muted/40" />
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="flex h-11 items-center gap-5 border-b border-border px-4">
            <div className="h-3 w-44 rounded bg-muted" />
            <div className="ml-auto h-4 w-2/3 rounded bg-muted/70" />
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ManageRoles() {
  const session = useSession();
  const queryClient = useQueryClient();
  const canView = hasPermission(session.permissions, "role.view");
  const canEdit =
    session.role === "System Administrator" && hasPermission(session.permissions, "role.manage");
  const [draft, setDraft] = useState<PermissionDraft | null>(null);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [versionConflict, setVersionConflict] = useState(false);

  const rolesQuery = useQuery({
    queryKey: ADMIN_ROLE_PERMISSIONS_QUERY_KEY,
    queryFn: getRolesWithPermissions,
    enabled: canView,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const changedRoles = useMemo(() => {
    if (!rolesQuery.data || !draft) return [];
    return rolesQuery.data.roles.filter(
      (role) => !samePermissionCodes(role.permissionCodes, draft[role.id] ?? []),
    );
  }, [draft, rolesQuery.data]);
  const hasDirtyChanges = changedRoles.length > 0;

  useEffect(() => {
    if (!rolesQuery.data) return;
    setDraft((current) => {
      if (!current) return matrixDraft(rolesQuery.data);
      const currentIsDirty = rolesQuery.data.roles.some(
        (role) => !samePermissionCodes(role.permissionCodes, current[role.id] ?? []),
      );
      return currentIsDirty ? current : matrixDraft(rolesQuery.data);
    });
  }, [rolesQuery.data]);

  const blocker = useBlocker({
    shouldBlockFn: () => hasDirtyChanges,
    enableBeforeUnload: hasDirtyChanges,
    withResolver: true,
  });

  useEffect(() => {
    if (blocker.status !== "blocked") return;
    if (window.confirm("You have unsaved role permission changes. Leave without saving?")) {
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker]);

  const saveMutation = useMutation({
    mutationFn: async ({
      roles,
      changeReason,
    }: {
      roles: typeof changedRoles;
      changeReason: string;
    }) => {
      const updates = [];
      for (const role of roles) {
        updates.push(
          await updateRolePermissions(role.id, {
            permissionCodes: draft?.[role.id] ?? [],
            expectedVersion: role.version,
            reason: changeReason,
          }),
        );
      }
      return updates;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ADMIN_ROLE_PERMISSIONS_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: AUTH_SESSION_KEY });
      const refreshed = await rolesQuery.refetch();
      if (refreshed.data) setDraft(matrixDraft(refreshed.data));
      setReason("");
      setReasonOpen(false);
      setSaveError(null);
      setVersionConflict(false);
      toast.success("Role permissions saved.");
    },
    onError: async (error) => {
      const conflict = error instanceof RolePermissionApiError && error.status === 409;
      const message = conflict
        ? "This role was changed by another administrator."
        : error instanceof Error
          ? error.message
          : "Unable to save role permissions";
      setSaveError(message);
      setVersionConflict(conflict);
      setReasonOpen(false);
      toast.error(message);
      if (conflict) {
        await queryClient.invalidateQueries({ queryKey: ADMIN_ROLE_PERMISSIONS_QUERY_KEY });
        await rolesQuery.refetch();
      }
    },
  });

  function togglePermission(roleId: string, permissionCode: PermissionCode) {
    if (!canEdit || saveMutation.isPending) return;
    setSaveError(null);
    setVersionConflict(false);
    setDraft((current) => {
      if (!current) return current;
      const existing = current[roleId] ?? [];
      return {
        ...current,
        [roleId]: existing.includes(permissionCode)
          ? existing.filter((code) => code !== permissionCode)
          : [...existing, permissionCode],
      };
    });
  }

  function beginSave() {
    if (!canEdit || !hasDirtyChanges || saveMutation.isPending) return;
    setSaveError(null);
    setReasonOpen(true);
  }

  function submitSave() {
    const changeReason = reason.trim();
    if (changeReason.length < 3) return;
    saveMutation.mutate({ roles: changedRoles, changeReason });
  }

  const dataUnavailable =
    rolesQuery.data &&
    (rolesQuery.data.roles.length === 0 || rolesQuery.data.permissions.length === 0);

  return (
    <PermissionGate
      userPermissions={session.permissions}
      requiredPermission="role.view"
      pageName="Manage Roles"
    >
      <div className="p-6">
        <PageHeader
          title="Manage Roles"
          subtitle="Durable permission assignments for BELTrak canonical roles."
          actions={
            <button
              type="button"
              onClick={() => void rolesQuery.refetch()}
              disabled={rolesQuery.isFetching || saveMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] font-medium hover:bg-accent disabled:opacity-50"
            >
              <RefreshCw className={`size-3.5 ${rolesQuery.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </button>
          }
        />

        {!canEdit && canView ? (
          <div className="mb-4 flex items-center gap-2 rounded-md border border-info/30 bg-info/10 px-3 py-2 text-[12px] text-info">
            <ShieldCheck className="size-4" />
            Read-only. Canonical System Administrator with role.manage is required to edit.
          </div>
        ) : null}

        {hasDirtyChanges ? (
          <div className="mb-4 flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[12px] text-warning">
            <AlertTriangle className="size-4" />
            {changedRoles.length} role{changedRoles.length === 1 ? "" : "s"} with unsaved changes.
          </div>
        ) : null}

        {saveError ? (
          <div className="mb-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
            <div className="font-medium">{saveError}</div>
            {versionConflict ? (
              <div className="mt-1 text-[11px]">
                Current server permissions were refetched. Your local selections remain so you can
                review the highlighted differences and retry.
              </div>
            ) : null}
          </div>
        ) : null}

        {rolesQuery.isLoading ? <LoadingMatrix /> : null}

        {rolesQuery.isError ? (
          <Panel>
            <div className="py-10 text-center">
              <AlertTriangle className="mx-auto size-8 text-danger" />
              <div className="mt-3 text-[14px] font-medium">Unable to load role permissions</div>
              <div className="mt-1 text-[12px] text-muted-foreground">
                {rolesQuery.error instanceof Error
                  ? rolesQuery.error.message
                  : "The permission service is unavailable."}
              </div>
              <button
                type="button"
                onClick={() => void rolesQuery.refetch()}
                className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground"
              >
                <RefreshCw className="size-3.5" />
                Retry
              </button>
            </div>
          </Panel>
        ) : null}

        {dataUnavailable ? (
          <Panel>
            <div className="py-10 text-center">
              <ShieldCheck className="mx-auto size-8 text-muted-foreground" />
              <div className="mt-3 text-[14px] font-medium">Permission catalog unavailable</div>
              <div className="mt-1 text-[12px] text-muted-foreground">
                No canonical roles or permissions were returned by the server.
              </div>
            </div>
          </Panel>
        ) : null}

        {rolesQuery.data && draft && !dataUnavailable ? (
          <>
            <Panel className="!p-0 overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-border bg-background/40">
                    <th className="sticky left-0 bg-background px-4 py-3 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Permission
                    </th>
                    {rolesQuery.data.roles.map((role) => (
                      <th key={role.id} className="min-w-40 px-3 py-3 text-center font-medium">
                        <span className="block text-[11px]">{role.name}</span>
                        <span className="mt-0.5 block font-mono text-[9px] text-muted-foreground">
                          v{role.version}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rolesQuery.data.permissions.map((permission) => (
                    <tr
                      key={permission.id}
                      className="border-b border-border last:border-0 hover:bg-accent/20"
                    >
                      <td className="sticky left-0 bg-panel px-4 py-2.5">
                        <span className="block font-medium">{permission.name}</span>
                        <span className="block font-mono text-[10px] text-muted-foreground">
                          {permission.code} · {permission.category}
                        </span>
                      </td>
                      {rolesQuery.data.roles.map((role) => {
                        const checked = (draft[role.id] ?? []).includes(permission.code);
                        const changed = checked !== role.permissionCodes.includes(permission.code);
                        const criticalSystemPermission =
                          role.name === "System Administrator" &&
                          CRITICAL_SYSTEM_ADMIN_PERMISSIONS.includes(
                            permission.code as (typeof CRITICAL_SYSTEM_ADMIN_PERMISSIONS)[number],
                          );
                        const disabled =
                          !canEdit ||
                          !role.isActive ||
                          criticalSystemPermission ||
                          saveMutation.isPending;
                        return (
                          <td
                            key={role.id}
                            className={`px-3 py-2.5 text-center ${changed ? "bg-warning/10" : ""}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled}
                              onChange={() => togglePermission(role.id, permission.code)}
                              aria-label={`${permission.name} for ${role.name}`}
                              className="size-4 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>

            <div className="mt-4 flex items-center justify-between gap-4">
              <div className="text-[11px] text-muted-foreground">
                Permission changes take effect on the next server request after a successful save.
              </div>
              <button
                type="button"
                onClick={beginSave}
                disabled={!canEdit || !hasDirtyChanges || saveMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-[12px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saveMutation.isPending ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                Save permissions
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-5">
              {rolesQuery.data.roles.map((role) => (
                <div key={role.id} className="rounded-lg border border-border bg-panel/60 p-3">
                  <div className="text-[13px] font-medium">{role.name}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {(draft[role.id] ?? []).length} / {rolesQuery.data.permissions.length}{" "}
                    permissions
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>

      {reasonOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="permission-reason-title"
            className="w-full max-w-md rounded-lg border border-border bg-panel shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div id="permission-reason-title" className="text-[14px] font-semibold">
                Confirm permission changes
              </div>
              <button
                type="button"
                onClick={() => setReasonOpen(false)}
                disabled={saveMutation.isPending}
                aria-label="Close"
                className="rounded p-1 hover:bg-accent"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="p-4">
              <label htmlFor="role-permission-reason" className="text-[12px] font-medium">
                Change reason
              </label>
              <textarea
                id="role-permission-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={500}
                autoFocus
                rows={4}
                placeholder="Explain why these permission assignments are changing"
                className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="mt-1 text-[10px] text-muted-foreground">
                Required for the durable audit trail. {reason.trim().length}/500
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
              <button
                type="button"
                onClick={() => setReasonOpen(false)}
                disabled={saveMutation.isPending}
                className="rounded-md border border-border px-3 py-1.5 text-[12px] hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitSave}
                disabled={reason.trim().length < 3 || saveMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground disabled:opacity-50"
              >
                {saveMutation.isPending ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                Confirm and save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </PermissionGate>
  );
}
