import { supabase } from "@/lib/supabaseClient";
import { useAppStore } from "@/store/appStore";

let channel: ReturnType<typeof supabase.channel> | null = null;

export function startRealtime() {
  if (channel) return; // already subscribed

  channel = supabase
    .channel("beltrak-changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "alarms" },
      () => {
        // Simple approach: re-hydrate the full store on any alarm change
        // This catches changes from other tabs/users
        useAppStore.getState().hydrate();
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "bags" },
      () => {
        useAppStore.getState().hydrate();
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        console.log("[realtime] Connected");
      }
    });
}

export function stopRealtime() {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
}