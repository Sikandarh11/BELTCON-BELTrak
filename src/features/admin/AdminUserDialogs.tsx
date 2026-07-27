import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  MailPlus,
  Pencil,
  ShieldAlert,
  UserPlus,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { CANONICAL_ROLES } from "@/auth/canonicalRoles";
import {
  adminUserActionSchema,
  createAdminUserSchema,
  editAdminUserSchema,
  inviteAdminUserSchema,
  repairAdminProfileSchema,
} from "@/services/admin/users/adminUserSchemas";
import type {
  AdminUser,
  AdminUserAction,
  AdminUserActionRequest,
  CanonicalRole,
  CreateAdminUserRequest,
  EditAdminUserRequest,
  InviteAdminUserRequest,
  RepairAdminProfileRequest,
} from "@/services/admin/users/adminUserTypes";
import { USER_ACTION_CONSEQUENCES, USER_ACTION_LABELS } from "./adminUserUi";

const fieldClass =
  "mt-1 w-full rounded border border-border bg-background px-2.5 py-2 text-[13px] outline-none focus:border-primary focus:ring-1 focus:ring-primary/30";
const labelClass = "text-[11px] text-muted-foreground";

function Modal({
  title,
  description,
  labelledBy,
  pending,
  onClose,
  children,
  footer,
  maxWidth = "max-w-2xl",
}: {
  title: string;
  description: string;
  labelledBy: string;
  pending: boolean;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  maxWidth?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <div
        className={`max-h-[calc(100vh-2rem)] w-full ${maxWidth} overflow-y-auto rounded-lg border border-border bg-card shadow-2xl`}
      >
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 id={labelledBy} className="text-base font-semibold">
              {title}
            </h2>
            <p className="mt-1 text-[12px] text-muted-foreground">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label={`Close ${title}`}
            className="flex size-8 items-center justify-center rounded hover:bg-accent disabled:opacity-50"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4">{children}</div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">{footer}</div>
      </div>
    </div>
  );
}

function CancelButton({ pending, onClick }: { pending: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="rounded-md border border-border px-3 py-2 text-[12px] hover:bg-accent disabled:opacity-50"
    >
      Cancel
    </button>
  );
}

function RoleSelect({
  id,
  value,
  onChange,
  roles = CANONICAL_ROLES,
}: {
  id: string;
  value: CanonicalRole;
  onChange: (value: CanonicalRole) => void;
  roles?: readonly CanonicalRole[];
}) {
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        Canonical role
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as CanonicalRole)}
        className={fieldClass}
      >
        {roles.map((role) => (
          <option key={role} value={role}>
            {role}
          </option>
        ))}
      </select>
    </div>
  );
}

function NameFields({
  prefix,
  firstName,
  lastName,
  onFirstName,
  onLastName,
}: {
  prefix: string;
  firstName: string;
  lastName: string;
  onFirstName: (value: string) => void;
  onLastName: (value: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label htmlFor={`${prefix}-first-name`} className={labelClass}>
          First name
        </label>
        <input
          id={`${prefix}-first-name`}
          value={firstName}
          maxLength={80}
          autoComplete="given-name"
          onChange={(event) => onFirstName(event.target.value)}
          className={fieldClass}
        />
      </div>
      <div>
        <label htmlFor={`${prefix}-last-name`} className={labelClass}>
          Last name
        </label>
        <input
          id={`${prefix}-last-name`}
          value={lastName}
          maxLength={80}
          autoComplete="family-name"
          onChange={(event) => onLastName(event.target.value)}
          className={fieldClass}
        />
      </div>
    </div>
  );
}

function ReasonField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        Reason <span className="text-danger">*</span>
      </label>
      <textarea
        id={id}
        value={value}
        maxLength={500}
        rows={3}
        required
        placeholder="Explain why this administrative change is required"
        onChange={(event) => onChange(event.target.value)}
        className={fieldClass}
      />
      <p className="mt-1 text-[10px] text-muted-foreground">
        This reason is stored in the durable audit record.
      </p>
    </div>
  );
}

function validationError(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.success ? null : (result.error?.issues[0]?.message ?? "Check the entered values");
}

export function CreateUserDialog({
  pending,
  onClose,
  onSubmit,
}: {
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: CreateAdminUserRequest) => void;
}) {
  const [form, setForm] = useState<CreateAdminUserRequest>({
    firstName: "",
    lastName: "",
    email: "",
    temporaryPassword: "",
    confirmPassword: "",
    role: "Operations Officer",
    isActive: true,
  });
  const [showTemporaryPassword, setShowTemporaryPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const passwordChecks = [
    ["At least 12 characters", form.temporaryPassword.length >= 12],
    ["One uppercase letter", /[A-Z]/.test(form.temporaryPassword)],
    ["One lowercase letter", /[a-z]/.test(form.temporaryPassword)],
    ["One number", /\d/.test(form.temporaryPassword)],
    ["One special character", /[^A-Za-z0-9]/.test(form.temporaryPassword)],
    [
      "Passwords match",
      form.confirmPassword.length > 0 && form.temporaryPassword === form.confirmPassword,
    ],
  ] as const;

  function clearSensitiveState() {
    setForm((current) => ({ ...current, temporaryPassword: "", confirmPassword: "" }));
    setShowTemporaryPassword(false);
    setShowConfirmPassword(false);
  }

  function close() {
    clearSensitiveState();
    onClose();
  }

  function submit() {
    const parsed = createAdminUserSchema.safeParse(form);
    const error = validationError(parsed);
    if (error || !parsed.success) {
      setMessage(error);
      return;
    }
    setMessage(null);
    onSubmit(parsed.data);
  }

  return (
    <Modal
      title="Create BELTrak user"
      description="Create a Supabase Auth account with a temporary password and matching BELTrak profile."
      labelledBy="create-user-title"
      pending={pending}
      onClose={close}
      footer={
        <>
          <CancelButton pending={pending} onClick={close} />
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[12px] font-medium text-primary-foreground disabled:opacity-50"
          >
            <UserPlus className="size-3.5" aria-hidden="true" />
            {pending ? "Creating…" : "Create user"}
          </button>
        </>
      }
    >
      <NameFields
        prefix="create"
        firstName={form.firstName}
        lastName={form.lastName}
        onFirstName={(firstName) => setForm({ ...form, firstName })}
        onLastName={(lastName) => setForm({ ...form, lastName })}
      />

      <div>
        <label htmlFor="create-email" className={labelClass}>
          Email
        </label>
        <input
          id="create-email"
          type="email"
          value={form.email}
          autoComplete="email"
          onChange={(event) => setForm({ ...form, email: event.target.value })}
          className={`${fieldClass} font-mono`}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="create-temporary-password" className={labelClass}>
            Temporary password
          </label>
          <div className="relative">
            <input
              id="create-temporary-password"
              type={showTemporaryPassword ? "text" : "password"}
              value={form.temporaryPassword}
              autoComplete="new-password"
              onChange={(event) => setForm({ ...form, temporaryPassword: event.target.value })}
              className={`${fieldClass} pr-10`}
            />
            <button
              type="button"
              onClick={() => setShowTemporaryPassword((current) => !current)}
              aria-label={
                showTemporaryPassword ? "Hide temporary password" : "Show temporary password"
              }
              className="absolute bottom-0 right-0 flex h-9 w-10 items-center justify-center text-muted-foreground hover:text-foreground"
            >
              {showTemporaryPassword ? (
                <EyeOff className="size-4" aria-hidden="true" />
              ) : (
                <Eye className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
        <div>
          <label htmlFor="create-confirm-password" className={labelClass}>
            Confirm password
          </label>
          <div className="relative">
            <input
              id="create-confirm-password"
              type={showConfirmPassword ? "text" : "password"}
              value={form.confirmPassword}
              autoComplete="new-password"
              onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
              className={`${fieldClass} pr-10`}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword((current) => !current)}
              aria-label={
                showConfirmPassword ? "Hide password confirmation" : "Show password confirmation"
              }
              className="absolute bottom-0 right-0 flex h-9 w-10 items-center justify-center text-muted-foreground hover:text-foreground"
            >
              {showConfirmPassword ? (
                <EyeOff className="size-4" aria-hidden="true" />
              ) : (
                <Eye className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-1.5 rounded-md border border-border bg-muted/25 px-3 py-2.5 sm:grid-cols-2">
        {passwordChecks.map(([label, passed]) => (
          <div
            key={label}
            className={`flex items-center gap-1.5 text-[10px] ${
              passed ? "text-success" : "text-muted-foreground"
            }`}
          >
            <span
              className={`flex size-3.5 items-center justify-center rounded-full border ${
                passed ? "border-success bg-success/10" : "border-border"
              }`}
            >
              {passed && <Check className="size-2.5" aria-hidden="true" />}
            </span>
            {label}
          </div>
        ))}
      </div>

      <RoleSelect
        id="create-role"
        value={form.role}
        onChange={(role) => setForm({ ...form, role })}
      />

      <label className="flex items-start gap-2 rounded-md border border-border px-3 py-2.5">
        <input
          type="checkbox"
          checked={form.isActive}
          onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
          className="mt-0.5 size-4"
        />
        <span>
          <span className="block text-[12px] font-medium">Active immediately</span>
          <span className="block text-[10px] text-muted-foreground">
            Disabled creates a PENDING profile. Temporary-password users must still change their
            password before operational access.
          </span>
        </span>
      </label>

      {message && (
        <div
          role="alert"
          className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[11px] text-danger"
        >
          {message}
        </div>
      )}
    </Modal>
  );
}

export function InviteUserDialog({
  pending,
  onClose,
  onSubmit,
}: {
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: InviteAdminUserRequest) => void;
}) {
  const [form, setForm] = useState<InviteAdminUserRequest>({
    firstName: "",
    lastName: "",
    email: "",
    role: "Operations Officer",
  });
  const [message, setMessage] = useState<string | null>(null);

  function submit() {
    const parsed = inviteAdminUserSchema.safeParse(form);
    const error = validationError(parsed);
    if (error || !parsed.success) {
      setMessage(error);
      return;
    }
    setMessage(null);
    onSubmit(parsed.data);
  }

  return (
    <Modal
      title="Invite BELTrak user"
      description="Create a PENDING Auth identity and matching profile, then email a password-setup link."
      labelledBy="invite-user-title"
      pending={pending}
      onClose={onClose}
      footer={
        <>
          <CancelButton pending={pending} onClick={onClose} />
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[12px] font-medium text-primary-foreground disabled:opacity-50"
          >
            <MailPlus className="size-3.5" aria-hidden="true" />
            {pending ? "Inviting…" : "Invite user"}
          </button>
        </>
      }
    >
      <NameFields
        prefix="invite"
        firstName={form.firstName}
        lastName={form.lastName}
        onFirstName={(firstName) => setForm({ ...form, firstName })}
        onLastName={(lastName) => setForm({ ...form, lastName })}
      />
      <div>
        <label htmlFor="invite-email" className={labelClass}>
          Email
        </label>
        <input
          id="invite-email"
          type="email"
          value={form.email}
          autoComplete="email"
          onChange={(event) => setForm({ ...form, email: event.target.value })}
          className={`${fieldClass} font-mono`}
        />
      </div>
      <RoleSelect
        id="invite-role"
        value={form.role}
        onChange={(role) => setForm({ ...form, role })}
      />
      <div className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-[11px] text-muted-foreground">
        The administrator does not set a password. Supabase sends a password-setup invitation to the
        user. The account remains PENDING until activated.
      </div>
      {message && (
        <div
          role="alert"
          className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[11px] text-danger"
        >
          {message}
        </div>
      )}
    </Modal>
  );
}

export function EditUserDialog({
  user,
  assignableRoles,
  canEditActive = true,
  pending,
  onClose,
  onSubmit,
}: {
  user: AdminUser;
  assignableRoles?: readonly CanonicalRole[];
  canEditActive?: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: EditAdminUserRequest) => void;
}) {
  const [form, setForm] = useState<EditAdminUserRequest>({
    firstName: user.firstName,
    lastName: user.lastName,
    role: (user.role as CanonicalRole | null) ?? "Operations Officer",
    isActive: user.isActive ?? false,
    expectedVersion: user.version ?? 0,
    reason: "",
  });
  const [message, setMessage] = useState<string | null>(null);

  function submit() {
    const parsed = editAdminUserSchema.safeParse(form);
    const error = validationError(parsed);
    if (error || !parsed.success) {
      setMessage(error);
      return;
    }
    setMessage(null);
    onSubmit(parsed.data);
  }

  return (
    <Modal
      title="Edit BELTrak user"
      description="Update profile attributes with optimistic version protection."
      labelledBy="edit-user-title"
      pending={pending}
      onClose={onClose}
      footer={
        <>
          <CancelButton pending={pending} onClick={onClose} />
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[12px] font-medium text-primary-foreground disabled:opacity-50"
          >
            <Pencil className="size-3.5" aria-hidden="true" />
            {pending ? "Saving…" : "Save changes"}
          </button>
        </>
      }
    >
      <div className="rounded-md border border-border bg-muted/25 px-3 py-2 text-[11px]">
        <span className="text-muted-foreground">Auth identity:</span>{" "}
        <span className="font-mono">{user.email}</span>
        <div className="mt-1 font-mono text-[9px] text-muted-foreground">{user.id}</div>
      </div>
      <NameFields
        prefix="edit"
        firstName={form.firstName}
        lastName={form.lastName}
        onFirstName={(firstName) => setForm({ ...form, firstName })}
        onLastName={(lastName) => setForm({ ...form, lastName })}
      />
      <RoleSelect
        id="edit-role"
        value={form.role}
        roles={assignableRoles}
        onChange={(role) => setForm({ ...form, role })}
      />
      <label className="flex items-start gap-2 rounded-md border border-border px-3 py-2.5">
        <input
          type="checkbox"
          checked={form.isActive}
          disabled={!canEditActive}
          onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
          className="mt-0.5 size-4"
        />
        <span>
          <span className="block text-[12px] font-medium">Active account</span>
          <span className="block text-[10px] text-muted-foreground">
            {canEditActive
              ? "Changing this setting also transitions the profile between ACTIVE and DEACTIVATED."
              : "Only a System Administrator may change account activation."}
          </span>
        </span>
      </label>
      <ReasonField
        id="edit-reason"
        value={form.reason}
        onChange={(reason) => setForm({ ...form, reason })}
      />
      <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-muted-foreground">
        Confirm that the canonical role and active state are correct. Concurrent changes are
        rejected and require a refresh.
      </div>
      {message && (
        <div
          role="alert"
          className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[11px] text-danger"
        >
          {message}
        </div>
      )}
    </Modal>
  );
}

export function UserActionDialog({
  user,
  action,
  pending,
  onClose,
  onSubmit,
}: {
  user: AdminUser;
  action: AdminUserAction;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: AdminUserActionRequest) => void;
}) {
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const title = USER_ACTION_LABELS[action];

  function submit() {
    const parsed = adminUserActionSchema.safeParse({
      action,
      expectedVersion: user.version ?? 0,
      reason,
    });
    const error = validationError(parsed);
    if (error || !parsed.success) {
      setMessage(error);
      return;
    }
    setMessage(null);
    onSubmit(parsed.data);
  }

  return (
    <Modal
      title={`${title} user`}
      description={`${user.firstName} ${user.lastName} · ${user.email}`}
      labelledBy="user-action-title"
      pending={pending}
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={
        <>
          <CancelButton pending={pending} onClick={onClose} />
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[12px] font-medium disabled:opacity-50 ${
              action === "DEACTIVATE" || action === "SUSPEND" || action === "LOCK"
                ? "bg-danger text-danger-foreground"
                : "bg-primary text-primary-foreground"
            }`}
          >
            {action === "SEND_PASSWORD_RESET" || action === "RESEND_INVITATION" ? (
              <KeyRound className="size-3.5" aria-hidden="true" />
            ) : (
              <ShieldAlert className="size-3.5" aria-hidden="true" />
            )}
            {pending ? "Applying…" : `Confirm ${title.toLowerCase()}`}
          </button>
        </>
      }
    >
      <div className="flex gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <div>
          <div className="text-[12px] font-medium">Consequences</div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {USER_ACTION_CONSEQUENCES[action]}
          </p>
        </div>
      </div>
      <ReasonField id="action-reason" value={reason} onChange={setReason} />
      {message && (
        <div
          role="alert"
          className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[11px] text-danger"
        >
          {message}
        </div>
      )}
    </Modal>
  );
}

export function RepairProfileDialog({
  user,
  pending,
  onClose,
  onSubmit,
}: {
  user: AdminUser;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: RepairAdminProfileRequest) => void;
}) {
  const [form, setForm] = useState<RepairAdminProfileRequest>({
    firstName: user.firstName,
    lastName: user.lastName,
    role: (user.role as CanonicalRole | null) ?? "Operations Officer",
    reason: "",
  });
  const [message, setMessage] = useState<string | null>(null);

  function submit() {
    const parsed = repairAdminProfileSchema.safeParse(form);
    const error = validationError(parsed);
    if (error || !parsed.success) {
      setMessage(error);
      return;
    }
    setMessage(null);
    onSubmit(parsed.data);
  }

  return (
    <Modal
      title="Repair BELTrak profile"
      description="Use the Supabase Auth identity as the authoritative source."
      labelledBy="repair-profile-title"
      pending={pending}
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={
        <>
          <CancelButton pending={pending} onClick={onClose} />
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[12px] font-medium text-primary-foreground disabled:opacity-50"
          >
            <Wrench className="size-3.5" aria-hidden="true" />
            {pending ? "Repairing…" : "Repair profile"}
          </button>
        </>
      }
    >
      <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-[11px]">
        The profile will use <span className="font-mono">{user.email}</span>, the exact Auth UUID,
        and the selected canonical role. No password is changed.
      </div>
      <NameFields
        prefix="repair"
        firstName={form.firstName}
        lastName={form.lastName}
        onFirstName={(firstName) => setForm({ ...form, firstName })}
        onLastName={(lastName) => setForm({ ...form, lastName })}
      />
      <RoleSelect
        id="repair-role"
        value={form.role}
        onChange={(role) => setForm({ ...form, role })}
      />
      <ReasonField
        id="repair-reason"
        value={form.reason}
        onChange={(reason) => setForm({ ...form, reason })}
      />
      {message && (
        <div
          role="alert"
          className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[11px] text-danger"
        >
          {message}
        </div>
      )}
    </Modal>
  );
}
