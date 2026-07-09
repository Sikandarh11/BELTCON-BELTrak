import { Link } from "@tanstack/react-router";
import { useAppStore } from "@/store/appStore";
import { BellRing, AlertTriangle, X } from "lucide-react";
import { useEffect, useState } from "react";

export function GlobalBanners() {
  const alarms = useAppStore((s) => s.alarms);
  const readers = useAppStore((s) => s.readers);
  const resetKey = useAppStore((s) => s.resetKey);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    setOffline(!navigator.onLine);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  const openAlarms = alarms.filter((a) => a.outcome === "OPEN");
  const offlineReaders = readers.filter((r) => r.status === "OFFLINE");
  const degradedReaders = readers.filter((r) => r.status === "DEGRADED");
  const escapeAlarms = alarms.filter(
    (a) => a.outcome === "OPEN" && (a.zone === "EMERGENCY_DOOR" || a.zone === "EMPLOYEE_EXIT")
  );

  function dismiss(key: string) {
    setDismissed((prev) => new Set(prev).add(key));
  }

  useEffect(() => {
    setDismissed(new Set());
  }, [resetKey]);

  return (
    <div className="flex flex-col">
      {offline && (
        <div className="bg-muted text-muted-foreground px-4 py-1.5 flex items-center gap-3 text-[12px]">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="flex-1">
            You are offline — changes will sync when connection is restored
          </span>
        </div>
      )}

      {/* Escape alert — full red, highest priority */}
      {escapeAlarms.length > 0 && !dismissed.has("escape") && (
        <div className="bg-danger text-destructive-foreground px-4 py-2 flex items-center gap-3 text-[13px] font-medium animate-pulse">
          <BellRing className="size-4 shrink-0" />
          <span className="flex-1">
            ESCAPE ALERT — suspect bag detected at {escapeAlarms[0].zone.replace(/_/g, " ")}
            {escapeAlarms.length > 1 && ` (+${escapeAlarms.length - 1} more)`}
          </span>
          <Link to="/alarms" className="underline text-[12px]">
            View alarms
          </Link>
          <button type="button" onClick={() => dismiss("escape")} aria-label="Dismiss escape alert">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Open alarms — red bar (skip if escape already showing) */}
      {openAlarms.length > 0 && escapeAlarms.length === 0 && !dismissed.has("alarm") && (
        <div className="bg-danger/90 text-destructive-foreground px-4 py-1.5 flex items-center gap-3 text-[12px]">
          <BellRing className="size-3.5 shrink-0" />
          <span className="flex-1">
            {openAlarms.length} unacknowledged alarm{openAlarms.length !== 1 ? "s" : ""}
            {" — "}
            {openAlarms.slice(0, 2).map((a) => a.zone.replace(/_/g, " ")).join(", ")}
            {openAlarms.length > 2 && ` +${openAlarms.length - 2} more`}
          </span>
          <Link to="/alarms" className="underline">
            Go to alarms
          </Link>
          <button type="button" onClick={() => dismiss("alarm")} aria-label="Dismiss alarm banner">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Degraded / offline readers — amber bar */}
      {offlineReaders.length > 0 && !dismissed.has("reader") && (
        <div className="bg-warning/90 text-primary-foreground px-4 py-1.5 flex items-center gap-3 text-[12px]">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="flex-1">
            DEGRADED MODE — {offlineReaders.length} reader{offlineReaders.length !== 1 ? "s" : ""} offline
            {degradedReaders.length > 0 && `, ${degradedReaders.length} degraded`}
            {" — coverage gaps possible"}
          </span>
          <Link to="/readers" className="underline">
            View readers
          </Link>
          <button type="button" onClick={() => dismiss("reader")} aria-label="Dismiss reader banner">
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}