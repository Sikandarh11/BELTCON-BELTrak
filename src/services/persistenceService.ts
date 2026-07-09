import { supabase } from "@/lib/supabaseClient";
import type { Bag, Alarm, RfidEvent, Resolution, Reader } from "@/types";

// Column name mapping: TS camelCase ↔ SQL snake_case
function bagToRow(b: Bag) {
  return {
    id: b.id, bhs_uid: b.bhsUid, iata_code: b.iataCode, epc: b.epc,
    flight: b.flight, is_suspect: b.isSuspect, status: b.status,
    current_zone: b.currentZone,
  };
}
function rowToBag(r: any): Bag {
  return {
    id: r.id, bhsUid: r.bhs_uid, iataCode: r.iata_code, epc: r.epc,
    flight: r.flight, isSuspect: r.is_suspect, status: r.status,
    currentZone: r.current_zone,
  };
}

function alarmToRow(a: Alarm) {
  return {
    id: a.id, bag_id: a.bagId, zone: a.zone,
    triggered_at: a.triggeredAt, acknowledged_by: a.acknowledgedBy,
    outcome: a.outcome,
  };
}
function rowToAlarm(r: any): Alarm {
  return {
    id: r.id, bagId: r.bag_id, zone: r.zone,
    triggeredAt: r.triggered_at, acknowledgedBy: r.acknowledged_by,
    outcome: r.outcome,
  };
}

function eventToRow(e: RfidEvent) {
  return {
    id: e.id, epc: e.epc, reader_id: e.readerId, zone: e.zone,
    event_type: e.eventType, first_seen: e.firstSeen, last_seen: e.lastSeen,
    read_count: e.readCount, rssi: e.rssi,
  };
}
function rowToEvent(r: any): RfidEvent {
  return {
    id: r.id, epc: r.epc, readerId: r.reader_id, zone: r.zone,
    eventType: r.event_type, firstSeen: r.first_seen, lastSeen: r.last_seen,
    readCount: r.read_count, rssi: r.rssi,
  };
}

function resToRow(r: Resolution) {
  return {
    id: r.id, bag_id: r.bagId, officer_id: r.officerId,
    action: r.action, resolved_at: r.resolvedAt,
  };
}
function rowToRes(r: any): Resolution {
  return {
    id: r.id, bagId: r.bag_id, officerId: r.officer_id,
    action: r.action, resolvedAt: r.resolved_at,
  };
}

function readerToRow(r: Reader) {
  return {
    id: r.id, name: r.name, model: r.model, zone: r.zone,
    ip: r.ip, status: r.status, read_rate: r.readRate,
  };
}
function rowToReader(r: any): Reader {
  return {
    id: r.id, name: r.name, model: r.model, zone: r.zone,
    ip: r.ip, status: r.status, readRate: r.read_rate,
  };
}

export const persistenceService = {
  // ---- LOAD (hydrate store from Supabase) ----
  async loadAll() {
    const [bagsRes, alarmsRes, eventsRes, resRes, readersRes] = await Promise.all([
      supabase.from("bags").select("*").order("created_at", { ascending: false }),
      supabase.from("alarms").select("*").order("triggered_at", { ascending: false }),
      supabase.from("rfid_events").select("*").order("first_seen", { ascending: false }),
      supabase.from("resolutions").select("*").order("resolved_at", { ascending: false }),
      supabase.from("readers").select("*").order("id"),
    ]);

    return {
      bags: (bagsRes.data || []).map(rowToBag),
      alarms: (alarmsRes.data || []).map(rowToAlarm),
      events: (eventsRes.data || []).map(rowToEvent),
      resolutions: (resRes.data || []).map(rowToRes),
      readers: (readersRes.data || []).map(rowToReader),
    };
  },

  // ---- PERSIST (fire-and-forget, log errors but don't block UI) ----
  async upsertBag(bag: Bag) {
    const { error } = await supabase.from("bags").upsert(bagToRow(bag));
    if (error) console.error("[persist] upsertBag:", error.message);
  },

  async updateBag(id: string, patch: Partial<Bag>) {
    const row: any = {};
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.currentZone !== undefined) row.current_zone = patch.currentZone;
    if (patch.epc !== undefined) row.epc = patch.epc;
    if (Object.keys(row).length === 0) return;
    const { error } = await supabase.from("bags").update(row).eq("id", id);
    if (error) console.error("[persist] updateBag:", error.message);
  },

  async insertAlarm(alarm: Alarm) {
    const { error } = await supabase.from("alarms").insert(alarmToRow(alarm));
    if (error) console.error("[persist] insertAlarm:", error.message);
  },

  async updateAlarm(id: string, patch: Partial<Alarm>) {
    const row: any = {};
    if (patch.acknowledgedBy !== undefined) row.acknowledged_by = patch.acknowledgedBy;
    if (patch.outcome !== undefined) row.outcome = patch.outcome;
    if (Object.keys(row).length === 0) return;
    const { error } = await supabase.from("alarms").update(row).eq("id", id);
    if (error) console.error("[persist] updateAlarm:", error.message);
  },

  async insertEvent(event: RfidEvent) {
    const { error } = await supabase.from("rfid_events").insert(eventToRow(event));
    if (error) console.error("[persist] insertEvent:", error.message);
  },

  async updateEvent(id: string, patch: Partial<RfidEvent>) {
    const row: any = {};
    if (patch.lastSeen !== undefined) row.last_seen = patch.lastSeen;
    if (patch.readCount !== undefined) row.read_count = patch.readCount;
    if (Object.keys(row).length === 0) return;
    const { error } = await supabase.from("rfid_events").update(row).eq("id", id);
    if (error) console.error("[persist] updateEvent:", error.message);
  },

  async insertResolution(res: Resolution) {
    const { error } = await supabase.from("resolutions").insert(resToRow(res));
    if (error) console.error("[persist] insertResolution:", error.message);
  },

  async updateReader(id: string, patch: Partial<Reader>) {
    const row: any = {};
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.readRate !== undefined) row.read_rate = patch.readRate;
    if (patch.ip !== undefined) row.ip = patch.ip;
    if (patch.zone !== undefined) row.zone = patch.zone;
    if (Object.keys(row).length === 0) return;
    const { error } = await supabase.from("readers").update(row).eq("id", id);
    if (error) console.error("[persist] updateReader:", error.message);
  },

  // ---- RESET (truncate + re-seed readers) ----
  async resetAll() {
    await supabase.from("resolutions").delete().neq("id", "");
    await supabase.from("alarms").delete().neq("id", "");
    await supabase.from("rfid_events").delete().neq("id", "");
    await supabase.from("bags").delete().neq("id", "");
    // Readers stay — they're infrastructure, not transactional
    // But reset their status to seed values
    const { SEED_READERS } = await import("@/mocks/seed");
    for (const r of SEED_READERS) {
      await supabase.from("readers").update({
        status: r.status, read_rate: r.readRate,
      }).eq("id", r.id);
    }
  },
};