import { Link } from "@tanstack/react-router";
import { AlertTriangle, BellRing, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useAlarms } from "@/services/alarms/alarmClient";
import type { AlarmListFilters } from "@/services/alarms/alarmSchemas";

const OPEN_ALARM_FILTERS: AlarmListFilters = { page: 1, pageSize: 100, statuses: ["OPEN"] };

export function GlobalBanners() {
  const alarms = useAlarms(OPEN_ALARM_FILTERS);
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

  useEffect(() => {
    setDismissed(new Set());
  }, [alarms.dataUpdatedAt]);

  const openAlarms = alarms.data?.alarms ?? [];
  const escapeAlarms = openAlarms.filter(
    (alarm) => alarm.zone === "EMERGENCY_DOOR" || alarm.zone === "EMPLOYEE_EXIT",
  );
  const dismiss = (key: string) => setDismissed((previous) => new Set(previous).add(key));

  return (
    <div className="global-banners flex flex-col no-print">
      {offline ? (
        <div className="flex items-center gap-3 bg-muted px-4 py-1.5 text-[12px] text-muted-foreground">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="flex-1">You are offline — operational changes cannot be queued.</span>
        </div>
      ) : null}
      {escapeAlarms.length > 0 && !dismissed.has("escape") ? (
        <div className="flex items-center gap-3 bg-danger px-4 py-2 text-[13px] font-medium text-destructive-foreground animate-pulse">
          <BellRing className="size-4 shrink-0" />
          <span className="flex-1">
            ESCAPE ALERT — suspect bag detected at {escapeAlarms[0].zone.replace(/_/g, " ")}
            {escapeAlarms.length > 1 ? ` (+${escapeAlarms.length - 1} more)` : ""}
          </span>
          <Link to="/alarms" className="text-[12px] underline">
            View alarms
          </Link>
          <button type="button" onClick={() => dismiss("escape")} aria-label="Dismiss escape alert">
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}
      {openAlarms.length > 0 && escapeAlarms.length === 0 && !dismissed.has("alarm") ? (
        <div className="flex items-center gap-3 bg-danger/90 px-4 py-1.5 text-[12px] text-destructive-foreground">
          <BellRing className="size-3.5 shrink-0" />
          <span className="flex-1">
            {openAlarms.length} unacknowledged alarm{openAlarms.length === 1 ? "" : "s"} —{" "}
            {openAlarms
              .slice(0, 2)
              .map((alarm) => alarm.zone.replace(/_/g, " "))
              .join(", ")}
          </span>
          <Link to="/alarms" className="underline">
            Go to alarms
          </Link>
          <button type="button" onClick={() => dismiss("alarm")} aria-label="Dismiss alarm banner">
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
