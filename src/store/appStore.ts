import { create } from "zustand";
import type { Bag, Alarm, RfidEvent, Resolution, Reader } from "@/types";
import { SEED_BAGS, SEED_ALARMS, SEED_EVENTS, SEED_READERS, USERS, ESCALATIONS } from "@/mocks/seed";
import { persistenceService } from "@/services/persistenceService";

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: "Active" | "On Break" | "Inactive";
  last: string;
}

export interface EscalationRule {
  id: string;
  trigger: string;
  role: string;
  method: string;
  sla: string;
  enabled: boolean;
}

export interface AuditEntry {
  id: string;
  action: string;
  userId: string;
  userName: string;
  detail: string;
  timestamp: string;
}

interface AppState {
  bags: Bag[];
  alarms: Alarm[];
  events: RfidEvent[];
  resolutions: Resolution[];
  readers: Reader[];
  users: AppUser[];
  escalationRules: EscalationRule[];
  auditLog: AuditEntry[];
  resetKey: number;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  upsertBag: (bag: Bag) => void;
  updateBag: (id: string, patch: Partial<Bag>) => void;
  addAlarm: (alarm: Alarm) => void;
  updateAlarm: (id: string, patch: Partial<Alarm>) => void;
  addEvent: (event: RfidEvent) => void;
  updateEvent: (id: string, patch: Partial<RfidEvent>) => void;
  addResolution: (resolution: Resolution) => void;
  updateReader: (id: string, patch: Partial<Reader>) => void;
  addUser: (user: AppUser) => void;
  updateUser: (id: string, patch: Partial<AppUser>) => void;
  deleteUser: (id: string) => void;
  addEscalationRule: (rule: EscalationRule) => void;
  updateEscalationRule: (id: string, patch: Partial<EscalationRule>) => void;
  deleteEscalationRule: (id: string) => void;
  addAuditEntry: (entry: Omit<AuditEntry, "id" | "timestamp">) => void;
  reset: () => void;
}

const INITIAL_STATE = {
  bags: SEED_BAGS,
  alarms: SEED_ALARMS,
  events: SEED_EVENTS,
  resolutions: [] as Resolution[],
  readers: SEED_READERS,
  users: USERS.map((u, i) => ({
    id: `user-${i + 1}`,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status as "Active" | "On Break" | "Inactive",
    last: u.last,
  })),
  escalationRules: ESCALATIONS.map((e, i) => ({
    id: `esc-${i + 1}`,
    trigger: e.trigger,
    role: e.role,
    method: e.method,
    sla: e.sla,
    enabled: true,
  })),
  auditLog: [] as AuditEntry[],
  resetKey: 0,
  hydrated: false,
};

export const useAppStore = create<AppState>((set) => ({
  ...INITIAL_STATE,

  hydrate: async () => {
    try {
      const data = await persistenceService.loadAll();
      if (data.bags.length > 0 || data.readers.length > 0) {
        set({
          bags: data.bags.length > 0 ? data.bags : SEED_BAGS,
          alarms: data.alarms,
          events: data.events,
          resolutions: data.resolutions,
          readers: data.readers.length > 0 ? data.readers : SEED_READERS,
          hydrated: true,
        });
      } else {
        set({ hydrated: true });
      }
    } catch (err) {
      console.warn("[store] Hydration failed, using seed data:", err);
      set({ hydrated: true });
    }
  },

  upsertBag: (bag) =>
    set((s) => {
      const idx = s.bags.findIndex((b) => b.id === bag.id);
      if (idx >= 0) {
        const next = [...s.bags];
        next[idx] = bag;
        persistenceService.upsertBag(bag);
        return { bags: next };
      }
      persistenceService.upsertBag(bag);
      return { bags: [...s.bags, bag] };
    }),

  updateBag: (id, patch) =>
    set((s) => {
      persistenceService.updateBag(id, patch);
      return {
        bags: s.bags.map((b) => (b.id === id ? { ...b, ...patch } : b)),
      };
    }),

  addAlarm: (alarm) =>
    set((s) => {
      persistenceService.insertAlarm(alarm);
      return { alarms: [alarm, ...s.alarms] };
    }),

  updateAlarm: (id, patch) =>
    set((s) => {
      persistenceService.updateAlarm(id, patch);
      return {
        alarms: s.alarms.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      };
    }),

  addEvent: (event) =>
    set((s) => {
      persistenceService.insertEvent(event);
      return { events: [event, ...s.events] };
    }),

  updateEvent: (id, patch) =>
    set((s) => {
      persistenceService.updateEvent(id, patch);
      return {
        events: s.events.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      };
    }),

  addResolution: (resolution) =>
    set((s) => {
      persistenceService.insertResolution(resolution);
      return { resolutions: [resolution, ...s.resolutions] };
    }),

  updateReader: (id, patch) =>
    set((s) => {
      persistenceService.updateReader(id, patch);
      return {
        readers: s.readers.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      };
    }),

  addUser: (user) =>
    set((s) => ({ users: [...s.users, user] })),

  updateUser: (id, patch) =>
    set((s) => ({ users: s.users.map((u) => (u.id === id ? { ...u, ...patch } : u)) })),

  deleteUser: (id) =>
    set((s) => ({ users: s.users.filter((u) => u.id !== id) })),

  addEscalationRule: (rule) =>
    set((s) => ({ escalationRules: [...s.escalationRules, rule] })),

  updateEscalationRule: (id, patch) =>
    set((s) => ({ escalationRules: s.escalationRules.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),

  deleteEscalationRule: (id) =>
    set((s) => ({ escalationRules: s.escalationRules.filter((r) => r.id !== id) })),

  addAuditEntry: (entry) =>
    set((s) => ({
      auditLog: [
        { ...entry, id: `audit-${Date.now()}`, timestamp: new Date().toISOString() },
        ...s.auditLog,
      ].slice(0, 500),
    })),

  reset: () => {
    persistenceService.resetAll();
    set({ ...INITIAL_STATE, resetKey: Date.now() });
  },
}));
