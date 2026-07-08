import { create } from "zustand";
import type { Bag, Alarm, RfidEvent, Resolution, Reader } from "@/types";
import { SEED_BAGS, SEED_ALARMS, SEED_EVENTS, SEED_READERS } from "@/mocks/seed";

interface AppState {
  bags: Bag[];
  alarms: Alarm[];
  events: RfidEvent[];
  resolutions: Resolution[];
  readers: Reader[];

  upsertBag: (bag: Bag) => void;
  updateBag: (id: string, patch: Partial<Bag>) => void;
  addAlarm: (alarm: Alarm) => void;
  updateAlarm: (id: string, patch: Partial<Alarm>) => void;
  addEvent: (event: RfidEvent) => void;
  updateEvent: (id: string, patch: Partial<RfidEvent>) => void;
  addResolution: (resolution: Resolution) => void;
  updateReader: (id: string, patch: Partial<Reader>) => void;
  reset: () => void;
}

const INITIAL_STATE = {
  bags: SEED_BAGS,
  alarms: SEED_ALARMS,
  events: SEED_EVENTS,
  resolutions: [] as Resolution[],
  readers: SEED_READERS,
};

export const useAppStore = create<AppState>((set) => ({
  ...INITIAL_STATE,

  upsertBag: (bag) =>
    set((s) => {
      const idx = s.bags.findIndex((b) => b.id === bag.id);
      if (idx >= 0) {
        const next = [...s.bags];
        next[idx] = bag;
        return { bags: next };
      }
      return { bags: [...s.bags, bag] };
    }),

  updateBag: (id, patch) =>
    set((s) => ({
      bags: s.bags.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    })),

  addAlarm: (alarm) =>
    set((s) => ({ alarms: [alarm, ...s.alarms] })),

  updateAlarm: (id, patch) =>
    set((s) => ({
      alarms: s.alarms.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    })),

  addEvent: (event) =>
    set((s) => ({ events: [event, ...s.events] })),

  updateEvent: (id, patch) =>
    set((s) => ({
      events: s.events.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    })),

  addResolution: (resolution) =>
    set((s) => ({ resolutions: [resolution, ...s.resolutions] })),

  updateReader: (id, patch) =>
    set((s) => ({
      readers: s.readers.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    })),

  reset: () => set({ ...INITIAL_STATE }),
}));
