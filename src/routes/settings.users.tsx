import { useDeferredValue, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Edit3,
  KeyRound,
  Lock,
  MailPlus,
  MoreHorizontal,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Unlock,
  UserPlus,
  UserX,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import { useSession } from "@/auth/SessionContext";
import { CANONICAL_ROLES } from "@/auth/canonicalRoles";
import { hasPermission } from "@/auth/permissions";
import { Panel, PageHeader, StatusPill } from "@/components/AppLayout";
import { PermissionGate } from "@/components/RoleGate";
import { useAuthorizedMutation } from "@/hooks/useAuthorizedMutation";
import {
  CreateUserDialog,
  EditUserDialog,
  InviteUserDialog,
  RepairProfileDialog,
  UserActionDialog,
} from "@/features/admin/AdminUserDialogs";
import { USER_ACTION_LABELS } from "@/features/admin/adminUserUi";
import {
  ADMIN_USERS_QUERY_KEY,
  adminUsersQueryKey,
  createAdminUser,
  editAdminUser,
  inviteAdminUser,
  listAdminUsers,
  performAdminUserAction,
  repairAdminUserProfile,
} from "@/services/admin/users/adminUserClient";
import {
  ADMIN_USER_STATUSES,
  ADMIN_USER_SYNC_STATUSES,
  type AdminUser,
  type AdminUserAction,
  type AdminUserActionRequest,
  type AdminUserListFilters,
  type AdminUserStatus,
  type AdminUserSyncStatus,
  type CanonicalRole,
  type CreateAdminUserRequest,
  type EditAdminUserRequest,
  type InviteAdminUserRequest,
  type RepairAdminProfileRequest,
} from "@/services/admin/users/adminUserTypes";

export const Route = createFileRoute("/settings/users")({
  head: () => ({ meta: [{ title: "Manage Users · BELTrak" }] }),
  component: ManageUsers,
});

const PAGE_SIZE = 25;

const SYNC_MESSAGES: Record<AdminUserSyncStatus, string> = {
  COMPLETE: "Auth account and BELTrak profile are synchronized.",
  MISSING_PROFILE: "Auth account exists, but BELTrak profile is missing.",
  MISSING_AUTH_USER: "BELTrak profile exists, but Auth account is missing.",
  EMAIL_MISMATCH: "Auth and profile emails do not match.",
};

const SYNC_LABELS: Record<AdminUserSyncStatus, string> = {
  COMPLETE: "Complete",
  MISSING_PROFILE: "Missing profile",
  MISSING_AUTH_USER: "Missing Auth user",
  EMAIL_MISMATCH: "Email mismatch",
};

function formatTimestamp(value: string | null) {
  if (!value) return "Never";
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? value : timestamp.toLocaleString();
}

function userName(user: AdminUser) {
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || "Name unavailable";
}

function userInitials(user: AdminUser) {
  const initials = `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.trim();
  return initials || user.email.charAt(0).toUpperCase() || "?";
}

function canRepair(user: AdminUser) {
  return user.syncStatus === "MISSING_PROFILE" || user.syncStatus === "EMAIL_MISMATCH";
}

function SyncStatus({ user }: { user: AdminUser }) {
  if (user.syncStatus === "COMPLETE") {
    return (
      <div className="inline-flex items-center gap-1.5 text-[11px] text-success">
        <CheckCircle2 className="size-3.5" aria-hidden="true" />
        Complete
      </div>
    );
  }

  return (
    <div className="max-w-64">
      <div className="inline-flex items-center gap-1.5 font-medium text-warning">
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
        {SYNC_LABELS[user.syncStatus]}
      </div>
      <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
        {SYNC_MESSAGES[user.syncStatus]}
      </div>
    </div>
  );
}

function availableActions(user: AdminUser, actorRole: CanonicalRole): AdminUserAction[] {
  if (
    actorRole !== "System Administrator" ||
    user.syncStatus !== "COMPLETE" ||
    user.version === null
  ) {
    return [];
  }

  switch (user.status) {
    case "PENDING":
      return ["ACTIVATE", "LOCK", "DEACTIVATE", "RESEND_INVITATION"];
    case "ACTIVE":
      return ["SUSPEND", "LOCK", "DEACTIVATE", "SEND_PASSWORD_RESET"];
    case "SUSPENDED":
      return ["ACTIVATE", "LOCK", "DEACTIVATE", "SEND_PASSWORD_RESET"];
    case "LOCKED":
      return ["UNLOCK", "DEACTIVATE", "SEND_PASSWORD_RESET"];
    case "DEACTIVATED":
      return ["ACTIVATE"];
    default:
      return [];
  }
}

function actionIcon(action: AdminUserAction) {
  switch (action) {
    case "ACTIVATE":
      return <ShieldCheck className="size-3.5" aria-hidden="true" />;
    case "SUSPEND":
    case "DEACTIVATE":
      return <UserX className="size-3.5" aria-hidden="true" />;
    case "LOCK":
      return <Lock className="size-3.5" aria-hidden="true" />;
    case "UNLOCK":
      return <Unlock className="size-3.5" aria-hidden="true" />;
    case "SEND_PASSWORD_RESET":
      return <KeyRound className="size-3.5" aria-hidden="true" />;
    case "RESEND_INVITATION":
      return <MailPlus className="size-3.5" aria-hidden="true" />;
  }
}

function UserActions({
  user,
  actorRole,
  onEdit,
  onRepair,
  onAction,
}: {
  user: AdminUser;
  actorRole: CanonicalRole;
  onEdit: () => void;
  onRepair: () => void;
  onAction: (action: AdminUserAction) => void;
}) {
  const actions = availableActions(user, actorRole);
  const isSystemAdministrator = actorRole === "System Administrator";
  const editable =
    user.syncStatus === "COMPLETE" &&
    user.version !== null &&
    (isSystemAdministrator || user.role !== "System Administrator");

  if (user.syncStatus === "MISSING_AUTH_USER") {
    return <span className="text-[10px] text-muted-foreground">Auth account required</span>;
  }

  return (
    <div className="flex items-center gap-1.5">
      {isSystemAdministrator && canRepair(user) && (
        <button
          type="button"
          onClick={onRepair}
          className="inline-flex items-center gap-1 rounded border border-warning/30 px-2 py-1.5 text-[11px] font-medium text-warning hover:bg-warning/10"
        >
          <Wrench className="size-3.5" aria-hidden="true" />
          Repair
        </button>
      )}
      {editable && (
        <>
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1.5 text-[11px] font-medium hover:bg-accent"
          >
            <Edit3 className="size-3.5" aria-hidden="true" />
            Edit
          </button>
          <details className="group relative">
            <summary
              aria-label={`More actions for ${userName(user)}`}
              className="flex size-7 cursor-pointer list-none items-center justify-center rounded border border-border hover:bg-accent [&::-webkit-details-marker]:hidden"
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </summary>
            <div className="absolute right-0 top-9 z-20 min-w-52 rounded-md border border-border bg-card p-1 shadow-xl">
              {actions.map((action) => (
                <button
                  key={action}
                  type="button"
                  onClick={(event) => {
                    onAction(action);
                    event.currentTarget.closest("details")?.removeAttribute("open");
                  }}
                  className={`flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[11px] hover:bg-accent ${
                    action === "SUSPEND" || action === "LOCK" || action === "DEACTIVATE"
                      ? "text-danger"
                      : ""
                  }`}
                >
                  {actionIcon(action)}
                  {USER_ACTION_LABELS[action]}
                </button>
              ))}
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function ManageUsers() {
  const session = useSession();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [role, setRole] = useState<CanonicalRole | "ALL">("ALL");
  const [status, setStatus] = useState<AdminUserStatus | "ALL">("ALL");
  const [syncStatus, setSyncStatus] = useState<AdminUserSyncStatus | "ALL">("ALL");
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [repairTarget, setRepairTarget] = useState<AdminUser | null>(null);
  const [actionTarget, setActionTarget] = useState<{
    user: AdminUser;
    action: AdminUserAction;
  } | null>(null);

  const filters: AdminUserListFilters = {
    search: deferredSearch || undefined,
    role: role === "ALL" ? undefined : role,
    status: status === "ALL" ? undefined : status,
    syncStatus: syncStatus === "ALL" ? undefined : syncStatus,
    page,
    pageSize: PAGE_SIZE,
  };

  const usersQuery = useQuery({
    queryKey: adminUsersQueryKey(filters),
    queryFn: () => listAdminUsers(filters),
    enabled: hasPermission(session.permissions, "user.view"),
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });

  async function refreshUsers() {
    await queryClient.invalidateQueries({ queryKey: ADMIN_USERS_QUERY_KEY });
  }

  const createMutation = useAuthorizedMutation({
    mutationFn: (input: CreateAdminUserRequest) => createAdminUser(input),
    onSuccess: async (user) => {
      setShowCreate(false);
      toast.success(`BELTCON user created for ${user.email}`);
      await refreshUsers();
    },
    onError: (error) => {
      toast.error(error.message || "Unable to create user");
    },
  });

  function handleCreateUser(input: CreateAdminUserRequest) {
    createMutation.mutate(input);
  }

  const inviteMutation = useAuthorizedMutation({
    mutationFn: inviteAdminUser,
    onSuccess: async (invitation) => {
      setShowInvite(false);
      inviteMutation.reset();
      if (invitation.deliveryStatus === "FAILED") {
        toast.warning(
          "The user was created as PENDING, but invitation delivery failed. Use Resend invitation.",
        );
      } else {
        toast.success(`Invitation sent to ${invitation.email}`);
      }
      await refreshUsers();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Unable to invite user");
    },
  });

  const editMutation = useAuthorizedMutation({
    mutationFn: ({ userId, input }: { userId: string; input: EditAdminUserRequest }) =>
      editAdminUser(userId, input),
    onSuccess: async (user) => {
      setEditTarget(null);
      toast.success(`User updated for ${user.email}`);
      await refreshUsers();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Unable to update user");
    },
  });

  const repairMutation = useAuthorizedMutation({
    mutationFn: ({ userId, input }: { userId: string; input: RepairAdminProfileRequest }) =>
      repairAdminUserProfile(userId, input),
    onSuccess: async (user) => {
      setRepairTarget(null);
      toast.success(`Profile repaired for ${user.email}`);
      await refreshUsers();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Unable to repair profile");
    },
  });

  const actionMutation = useAuthorizedMutation({
    mutationFn: ({ userId, input }: { userId: string; input: AdminUserActionRequest }) =>
      performAdminUserAction(userId, input),
    onSuccess: async (result) => {
      setActionTarget(null);
      if (result.deliveryStatus === "FAILED") {
        toast.warning(`${USER_ACTION_LABELS[result.action]} could not be delivered`);
      } else {
        toast.success(`${USER_ACTION_LABELS[result.action]} completed`);
      }
      await refreshUsers();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Unable to complete user action");
    },
  });

  const result = usersQuery.data;
  const totalPages = Math.max(1, result?.pagination.totalPages ?? 1);
  const isSystemAdministrator = session.role === "System Administrator";
  const canCreate = hasPermission(session.permissions, "user.create");
  const canEdit = hasPermission(session.permissions, "user.update");
  const assignableRoles = isSystemAdministrator
    ? CANONICAL_ROLES
    : CANONICAL_ROLES.filter((candidate) => candidate !== "System Administrator");

  function closeCreate() {
    setShowCreate(false);
  }

  function closeInvite() {
    inviteMutation.reset();
    setShowInvite(false);
  }

  return (
    <PermissionGate
      userPermissions={session.permissions}
      requiredPermission="user.view"
      pageName="Manage Users"
    >
      <div className="p-6">
        <PageHeader
          title="Manage Users"
          subtitle={
            result
              ? `${result.pagination.total} Supabase Auth and BELTrak profile identities.`
              : "Authoritative Supabase Auth and BELTrak profile identities."
          }
          actions={
            <div className="flex flex-wrap gap-2">
              {canCreate && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowInvite(true)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 px-3 py-1.5 text-[12px] font-medium text-primary hover:bg-primary/5"
                  >
                    <MailPlus className="size-3.5" aria-hidden="true" />
                    Invite user
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCreate(true)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground"
                  >
                    <UserPlus className="size-3.5" aria-hidden="true" />
                    Create user
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => refreshUsers()}
                disabled={usersQuery.isFetching}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] font-medium hover:bg-accent disabled:opacity-50"
              >
                <RefreshCw
                  className={`size-3.5 ${usersQuery.isFetching ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
                Refresh
              </button>
            </div>
          }
        />

        <Panel className="mb-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_220px_180px_190px]">
            <div className="relative">
              <Search
                className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                aria-label="Search users by name or email"
                placeholder="Search name or email…"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                className="w-full rounded-md border border-border bg-background py-2 pl-8 pr-3 text-[12px]"
              />
            </div>
            <select
              aria-label="Filter users by canonical role"
              value={role}
              onChange={(event) => {
                setRole(event.target.value as CanonicalRole | "ALL");
                setPage(1);
              }}
              className="rounded-md border border-border bg-background px-2.5 py-2 text-[12px]"
            >
              <option value="ALL">All canonical roles</option>
              {CANONICAL_ROLES.map((canonicalRole) => (
                <option key={canonicalRole} value={canonicalRole}>
                  {canonicalRole}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter users by account status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as AdminUserStatus | "ALL");
                setPage(1);
              }}
              className="rounded-md border border-border bg-background px-2.5 py-2 text-[12px]"
            >
              <option value="ALL">All account statuses</option>
              {ADMIN_USER_STATUSES.map((accountStatus) => (
                <option key={accountStatus} value={accountStatus}>
                  {accountStatus}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter users by synchronization status"
              value={syncStatus}
              onChange={(event) => {
                setSyncStatus(event.target.value as AdminUserSyncStatus | "ALL");
                setPage(1);
              }}
              className="rounded-md border border-border bg-background px-2.5 py-2 text-[12px]"
            >
              <option value="ALL">All sync states</option>
              {ADMIN_USER_SYNC_STATUSES.map((currentSyncStatus) => (
                <option key={currentSyncStatus} value={currentSyncStatus}>
                  {SYNC_LABELS[currentSyncStatus]}
                </option>
              ))}
            </select>
          </div>
        </Panel>

        {usersQuery.isError ? (
          <Panel>
            <div className="flex flex-col items-center py-10 text-center">
              <ShieldAlert className="size-8 text-danger" aria-hidden="true" />
              <div className="mt-3 font-medium">Unable to load authoritative users</div>
              <div className="mt-1 max-w-md text-[12px] text-muted-foreground">
                {usersQuery.error instanceof Error
                  ? usersQuery.error.message
                  : "The user directory request failed."}
              </div>
              <button
                type="button"
                onClick={() => usersQuery.refetch()}
                className="mt-4 rounded-md border border-border px-3 py-2 text-[12px] hover:bg-accent"
              >
                Retry
              </button>
            </div>
          </Panel>
        ) : (
          <Panel className="!p-0 overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
              <span>
                {result
                  ? `Showing ${result.users.length} of ${result.pagination.total} users`
                  : "Loading authoritative users…"}
              </span>
              {usersQuery.isFetching && <span>Refreshing…</span>}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-360 text-[12.5px]">
                <thead className="border-b border-border bg-background/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    {[
                      "Name",
                      "Email",
                      "Canonical role",
                      "Account status",
                      "Email confirmation",
                      "Must change password",
                      "Last login",
                      "Sync status",
                      "Actions",
                    ].map((heading) => (
                      <th key={heading} className="px-3 py-2.5 text-left font-medium">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {usersQuery.isLoading
                    ? Array.from({ length: 5 }, (_, index) => (
                        <tr key={index} className="border-b border-border">
                          <td colSpan={9} className="px-3 py-3">
                            <div className="h-8 animate-pulse rounded bg-muted/60" />
                          </td>
                        </tr>
                      ))
                    : result?.users.map((user) => (
                        <tr key={user.id} className="border-b border-border hover:bg-accent/30">
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2.5">
                              <div className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-primary/70 to-info/70 text-[10px] font-semibold text-primary-foreground">
                                {userInitials(user)}
                              </div>
                              <div>
                                <div className="font-medium">{userName(user)}</div>
                                <div className="font-mono text-[9px] text-muted-foreground">
                                  {user.id}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-muted-foreground">
                            {user.email || "Unavailable"}
                          </td>
                          <td className="px-3 py-2.5">{user.role ?? "Not assigned"}</td>
                          <td className="px-3 py-2.5">
                            <StatusPill status={user.status ?? "Unknown"} />
                          </td>
                          <td className="px-3 py-2.5">
                            {user.emailConfirmed === null
                              ? "Unknown"
                              : user.emailConfirmed
                                ? "Confirmed"
                                : "Unconfirmed"}
                          </td>
                          <td className="px-3 py-2.5">
                            {user.mustChangePassword === null
                              ? "Unknown"
                              : user.mustChangePassword
                                ? "Required"
                                : "No"}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground">
                            {formatTimestamp(user.lastLogin)}
                          </td>
                          <td className="px-3 py-2.5">
                            <SyncStatus user={user} />
                          </td>
                          <td className="px-3 py-2.5">
                            <UserActions
                              user={user}
                              actorRole={session.role}
                              onEdit={() => setEditTarget(user)}
                              onRepair={() => setRepairTarget(user)}
                              onAction={(action) => setActionTarget({ user, action })}
                            />
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>

            {!usersQuery.isLoading && result?.users.length === 0 && (
              <div className="px-4 py-14 text-center">
                <div className="text-sm font-medium">No users match these filters</div>
                <div className="mt-1 text-[12px] text-muted-foreground">
                  The real Supabase user directory returned no matching identities.
                </div>
              </div>
            )}

            <div className="flex items-center justify-between border-t border-border px-3 py-2">
              <div className="text-[11px] text-muted-foreground">
                Page {page} of {totalPages}
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1 || usersQuery.isFetching}
                  aria-label="Previous users page"
                  className="flex size-8 items-center justify-center rounded border border-border hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft className="size-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={page >= totalPages || usersQuery.isFetching}
                  aria-label="Next users page"
                  className="flex size-8 items-center justify-center rounded border border-border hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronRight className="size-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </Panel>
        )}
      </div>

      {showCreate && (
        <CreateUserDialog
          pending={createMutation.isPending}
          onClose={closeCreate}
          onSubmit={handleCreateUser}
        />
      )}

      {showInvite && (
        <InviteUserDialog
          pending={inviteMutation.isPending}
          onClose={closeInvite}
          onSubmit={(input: InviteAdminUserRequest) => inviteMutation.mutate(input)}
        />
      )}

      {editTarget && (
        <EditUserDialog
          key={`${editTarget.id}:${editTarget.version}`}
          user={editTarget}
          assignableRoles={assignableRoles}
          canEditActive={canEdit && isSystemAdministrator}
          pending={editMutation.isPending}
          onClose={() => setEditTarget(null)}
          onSubmit={(input) => editMutation.mutate({ userId: editTarget.id, input })}
        />
      )}

      {repairTarget && (
        <RepairProfileDialog
          key={repairTarget.id}
          user={repairTarget}
          pending={repairMutation.isPending}
          onClose={() => setRepairTarget(null)}
          onSubmit={(input) => repairMutation.mutate({ userId: repairTarget.id, input })}
        />
      )}

      {actionTarget && (
        <UserActionDialog
          key={`${actionTarget.user.id}:${actionTarget.action}`}
          user={actionTarget.user}
          action={actionTarget.action}
          pending={actionMutation.isPending}
          onClose={() => setActionTarget(null)}
          onSubmit={(input) => actionMutation.mutate({ userId: actionTarget.user.id, input })}
        />
      )}
    </PermissionGate>
  );
}
