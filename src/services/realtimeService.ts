import { supabase } from "@/lib/supabaseClient";
import { useAppStore } from "@/store/appStore";

let channel: ReturnType<typeof supabase.channel> | null = null;
export type RealtimeSnapshot = {
  status: "disconnected" | "connecting" | "connected" | "error";
  eventsReceived: number;
};

let snapshot: RealtimeSnapshot = {
  status: "disconnected",
  eventsReceived: 0,
};
const listeners = new Set<() => void>();

function updateSnapshot(patch: Partial<RealtimeSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
}

function recordRealtimeEvent() {
  updateSnapshot({ eventsReceived: snapshot.eventsReceived + 1 });
}

export function getRealtimeSnapshot() {
  return snapshot;
}

export function subscribeToRealtimeStatus(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function startRealtime() {
  if (channel) return; // already subscribed

  updateSnapshot({ status: "connecting" });
  channel = supabase
    .channel("beltrak-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "alarms" }, () => {
      recordRealtimeEvent();
      // Simple approach: re-hydrate the full store on any alarm change
      // This catches changes from other tabs/users
      useAppStore.getState().hydrate();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "bags" }, () => {
      recordRealtimeEvent();
      useAppStore.getState().hydrate();
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        updateSnapshot({ status: "connected" });
        console.log("[realtime] Connected");
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        updateSnapshot({ status: "error" });
      } else if (status === "CLOSED") {
        updateSnapshot({ status: "disconnected" });
      }
    });
}

export function stopRealtime() {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
    updateSnapshot({ status: "disconnected" });
  }
}
