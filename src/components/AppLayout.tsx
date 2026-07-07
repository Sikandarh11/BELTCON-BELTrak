import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Map, BellRing, History, Target, ScanLine, Radio, FileBarChart2,
  Settings, MapPinned, ShieldAlert, GitBranch, UserCog, Users, Search, Bell, ChevronDown,
  CircleDot, Plane, Activity, LogOut,
} from "lucide-react";
import { type ReactNode } from "react";

import type { SessionUser } from "@/services/authService";

const NAV = [
  { section: "Operations", items: [
    { to: "/", label: "Dashboard", icon: LayoutDashboard },
    { to: "/map", label: "Live Operations Map", icon: Map },
    { to: "/alarms", label: "Notifications & Alarms", icon: BellRing, badge: 4 },
    { to: "/history", label: "Query Tag History", icon: History },
    { to: "/target", label: "Target Information", icon: Target },
    { to: "/recheck", label: "Recheck Station", icon: ScanLine },
    { to: "/readers", label: "RFID Readers", icon: Radio },
    { to: "/reports", label: "Reports", icon: FileBarChart2 },
  ]},
  { section: "Administration", items: [
    { to: "/settings/system", label: "System Settings", icon: Settings },
    { to: "/settings/map", label: "Map Settings", icon: MapPinned },
    { to: "/settings/threats", label: "Threat Types", icon: ShieldAlert },
    { to: "/settings/escalations", label: "Escalations", icon: GitBranch },
    { to: "/settings/roles", label: "Manage Roles", icon: UserCog },
    { to: "/settings/users", label: "Manage Users", icon: Users },
  ]},
];

export function AppLayout({ children, currentUser, onLogout }: { children: ReactNode; currentUser?: SessionUser | null; onLogout?: () => void | Promise<void> }) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const userInitials = currentUser ? `${currentUser.firstName.charAt(0)}${currentUser.lastName.charAt(0)}`.trim() || "U" : "SK";

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* SIDEBAR */}
      <aside className="w-64 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex flex-col">
        <div className="px-5 py-4 border-b border-sidebar-border flex items-center gap-2.5">
          <div className="size-9 rounded-md bg-primary/15 border border-primary/40 flex items-center justify-center">
            <Plane className="size-5 text-primary -rotate-45" />
          </div>
          <div className="leading-tight">
            <div className="font-semibold tracking-tight text-[15px]">BELTrak</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Operations Control</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-5">
          {NAV.map((g) => (
            <div key={g.section}>
              <div className="px-2.5 mb-1.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/80">
                {g.section}
              </div>
              <ul className="space-y-0.5">
                {g.items.map((it) => {
                  const active = pathname === it.to;
                  const Icon = it.icon;
                  return (
                    <li key={it.to}>
                      <Link
                        to={it.to}
                        className={`group flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] transition-colors ${
                          active
                            ? "bg-sidebar-accent text-foreground shadow-[inset_2px_0_0_0] shadow-primary"
                            : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-foreground"
                        }`}
                      >
                        <Icon className={`size-4 ${active ? "text-primary" : "text-sidebar-foreground/60 group-hover:text-foreground"}`} />
                        <span className="flex-1 truncate">{it.label}</span>
                        {"badge" in it && it.badge ? (
                          <span className="text-[10px] font-semibold rounded-full bg-danger/20 text-danger px-1.5 py-0.5 border border-danger/30">
                            {it.badge}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="border-t border-sidebar-border p-3 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <CircleDot className="size-3 text-success animate-pulse" />
            <span>All systems nominal</span>
          </div>
          <div className="mt-1 font-mono text-[10px]">v3.4.1 · build 2026.06.17</div>
        </div>
      </aside>

      {/* MAIN */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* TOP HEADER */}
        <header className="h-14 shrink-0 border-b border-border bg-panel/60 backdrop-blur flex items-center px-4 gap-3">
          <button className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border bg-background/50 text-[13px] hover:bg-accent">
            <Plane className="size-3.5 text-primary -rotate-45" />
            <span className="font-medium">OPS</span>
            <span className="text-muted-foreground hidden md:inline">Operations Hub</span>
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </button>
          <div className="hidden md:flex items-center gap-1.5 text-[12px] text-muted-foreground border border-border rounded-md px-2.5 py-1.5">
            <span className="text-muted-foreground/70">Shift</span>
            <span className="text-foreground font-medium">Morning · 06:00–14:00</span>
          </div>

          <div className="flex-1 max-w-md mx-auto relative">
            <Search className="size-4 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              placeholder="Search bag, tag, passenger, flight…"
              className="w-full bg-background/50 border border-border rounded-md pl-8 pr-3 py-1.5 text-[13px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 border border-success/30 bg-success/10 text-success rounded-md">
            <Activity className="size-3.5" />
            <span className="font-medium">LIVE</span>
          </div>
          <button className="relative size-9 rounded-md border border-border hover:bg-accent flex items-center justify-center">
            <Bell className="size-4" />
            <span className="absolute top-1 right-1 size-2 rounded-full bg-danger animate-pulse" />
          </button>
          <div className="flex items-center gap-2 pl-3 border-l border-border">
            <div className="size-8 rounded-full bg-linear-to-br from-primary to-info flex items-center justify-center text-[11px] font-semibold text-primary-foreground">{userInitials}</div>
            <div className="hidden md:block leading-tight">
              <div className="text-[12px] font-medium">{currentUser ? `${currentUser.firstName} ${currentUser.lastName}` : "Secure User"}</div>
              <div className="text-[10px] text-muted-foreground">{currentUser?.role ?? "Session pending"}</div>
            </div>
            <button
              type="button"
              onClick={() => void onLogout?.()}
              className="ml-1 inline-flex size-8 items-center justify-center rounded-md border border-border hover:bg-accent"
              aria-label="Sign out"
            >
              <LogOut className="size-4 text-muted-foreground" />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-[13px] text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Panel({ title, action, children, className = "" }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-border bg-panel/60 ${className}`}>
      {title && (
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <div className="text-[12px] uppercase tracking-[0.14em] text-muted-foreground font-medium">{title}</div>
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE: "bg-danger/15 text-danger border-danger/30",
    ESCALATED: "bg-warning/15 text-warning border-warning/30",
    ACKNOWLEDGED: "bg-info/15 text-info border-info/30",
    CLOSED: "bg-muted text-muted-foreground border-border",
    Online: "bg-success/15 text-success border-success/30",
    Degraded: "bg-warning/15 text-warning border-warning/30",
    Offline: "bg-danger/15 text-danger border-danger/30",
    Active: "bg-success/15 text-success border-success/30",
    Inactive: "bg-muted text-muted-foreground border-border",
    "On Break": "bg-warning/15 text-warning border-warning/30",
    ALARM: "bg-danger/15 text-danger border-danger/30",
    TRACKING: "bg-info/15 text-info border-info/30",
    CONNECTED: "bg-success/15 text-success border-success/30",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded border ${map[status] ?? "bg-muted text-muted-foreground border-border"}`}>
      <span className={`size-1.5 rounded-full ${status === "ACTIVE" || status === "ALARM" || status === "Offline" ? "bg-danger animate-pulse" : status === "Online" || status === "CONNECTED" || status === "Active" ? "bg-success" : status === "TRACKING" || status === "ACKNOWLEDGED" ? "bg-info" : "bg-warning"}`} />
      {status}
    </span>
  );
}
