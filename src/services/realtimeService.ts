/**
 * @deprecated Phase 8 intentionally defers Supabase Realtime until RLS and
 * publication settings can be verified. Operational hooks use targeted query
 * refetch intervals and mutation invalidation meanwhile. This module must not
 * hydrate or mutate Zustand records.
 */
export type RealtimeSnapshot = {
  status: "disconnected" | "connecting" | "connected" | "error";
  eventsReceived: number;
};

const snapshot: RealtimeSnapshot = { status: "disconnected", eventsReceived: 0 };

export function getRealtimeSnapshot() {
  return snapshot;
}

export function subscribeToRealtimeStatus(_listener: () => void) {
  return () => undefined;
}

export function startRealtime() {
  // Deliberately no subscription: do not risk unauthorized browser channels.
}

export function stopRealtime() {
  // No active channel exists while Realtime invalidation is deferred.
}
