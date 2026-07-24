import {
  Code2,
  ScanLine,
  ScrollText,
  ShieldCheck,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { forwardRef, useId, useImperativeHandle, useRef } from "react";

import { APP_ROLES, ROLE_DETAILS, persistLastRole, type AppRole } from "@/auth/appRoles";

const ROLE_ICONS: Record<AppRole, LucideIcon> = {
  Admin: ShieldCheck,
  Developer: Code2,
  Operator: ScanLine,
  Supervisor: UsersRound,
  Auditor: ScrollText,
};

export type RoleSelectorHandle = {
  focus: () => void;
};

type RoleSelectorProps = {
  label: string;
  role: AppRole;
  onRoleChange: (role: AppRole) => void;
};

export const RoleSelector = forwardRef<RoleSelectorHandle, RoleSelectorProps>(function RoleSelector(
  { label, role, onRoleChange },
  ref,
) {
  const id = useId();
  const selectRef = useRef<HTMLSelectElement>(null);
  const firstButtonRef = useRef<HTMLButtonElement>(null);
  const SelectedIcon = ROLE_ICONS[role];

  useImperativeHandle(ref, () => ({
    focus() {
      const desktopSelectorVisible =
        typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches;

      if (desktopSelectorVisible) {
        firstButtonRef.current?.focus();
      } else {
        selectRef.current?.focus();
      }
    },
  }));

  function selectRole(nextRole: AppRole) {
    persistLastRole(nextRole);
    onRoleChange(nextRole);
  }

  return (
    <div className="space-y-2">
      <label id={`${id}-label`} htmlFor={`${id}-select`} className="block text-sm text-slate-700">
        {label}
      </label>

      <div className="relative sm:hidden">
        <SelectedIcon
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-cyan-700"
        />
        <select
          ref={selectRef}
          id={`${id}-select`}
          value={role}
          onChange={(event) => selectRole(event.target.value as AppRole)}
          aria-describedby={`${id}-help`}
          className="w-full appearance-none rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-10 text-sm font-medium text-slate-900 outline-none transition focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20"
        >
          {APP_ROLES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs text-slate-500"
        >
          ▼
        </span>
      </div>

      <div
        role="group"
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-help`}
        className="hidden grid-cols-5 gap-1 rounded-2xl border border-slate-200 bg-slate-50 p-1 sm:grid"
      >
        {APP_ROLES.map((option, index) => {
          const Icon = ROLE_ICONS[option];
          const selected = option === role;

          return (
            <button
              key={option}
              ref={index === 0 ? firstButtonRef : undefined}
              type="button"
              aria-pressed={selected}
              onClick={() => selectRole(option)}
              className={`inline-flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl border px-1.5 py-2 text-[10px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 ${
                selected
                  ? "border-transparent bg-primary text-primary-foreground shadow-sm"
                  : "border-slate-200 bg-white text-slate-700 hover:border-cyan-400/40 hover:bg-cyan-50"
              }`}
            >
              <Icon aria-hidden="true" className="size-3.5" />
              <span className="truncate">{option}</span>
            </button>
          );
        })}
      </div>

      <p id={`${id}-help`} aria-live="polite" className="text-xs text-slate-500">
        {ROLE_DETAILS[role].helperText}
      </p>
    </div>
  );
});
