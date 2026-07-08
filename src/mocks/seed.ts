// Realistic dummy data for BELTrak prototype

import type { Alarm, Bag, Reader, RfidEvent } from "@/types";

export const SEED_BAGS: Bag[] = [
  { id: "b1", bhsUid: "BHS-240091", iataCode: "ETB-240091", epc: "EPC-240091", flight: "SV452", isSuspect: true, status: "ALARMED", currentZone: "CUSTOMS_EXIT_GATE_2" },
  { id: "b2", bhsUid: "BHS-240083", iataCode: "ETB-240083", epc: "EPC-240083", flight: "QR1163", isSuspect: true, status: "ESCALATED", currentZone: "RECLAIM_BELT_3" },
  { id: "b3", bhsUid: "BHS-240077", iataCode: "ETB-240077", epc: "EPC-240077", flight: "EK212", isSuspect: true, status: "UNDER_RECHECK", currentZone: "WASHROOM_NORTH" },
  { id: "b4", bhsUid: "BHS-240072", iataCode: "ETB-240072", epc: "EPC-240072", flight: "TK148", isSuspect: true, status: "IN_ARRIVAL_HALL", currentZone: "ARRIVAL_HALL" },
  { id: "b5", bhsUid: "BHS-240068", iataCode: "ETB-240068", epc: "EPC-240068", flight: "MS667", isSuspect: true, status: "RESOLVED", currentZone: "CUSTOMS_EXIT_GATE_1" },
  { id: "b6", bhsUid: "BHS-240055", iataCode: "ETB-240055", epc: "EPC-240055", flight: "EK783", isSuspect: true, status: "RESOLVED", currentZone: "LOST_FOUND" },
  { id: "b7", bhsUid: "BHS-240049", iataCode: "ETB-240049", epc: "EPC-240049", flight: "LH628", isSuspect: true, status: "RESOLVED", currentZone: "WASHROOM_SOUTH" },
  { id: "b8", bhsUid: "BHS-240041", iataCode: "ETB-240041", epc: "EPC-240041", flight: "AF655", isSuspect: true, status: "RESOLVED", currentZone: "CUSTOMS_EXIT_GATE_3" },
];

export const KPIS = [
  { label: "Suspect Bags Tagged Today", value: 127, delta: "+12 vs yesterday", tone: "primary" },
  { label: "Active Suspect Bags", value: 34, delta: "+3 last hour", tone: "warning" },
  { label: "Alarms Raised Today", value: 18, delta: "4 unresolved", tone: "danger" },
  { label: "Bags Cleared", value: 109, delta: "85.8% clearance", tone: "success" },
  { label: "Online RFID Readers", value: "42 / 44", delta: "2 offline", tone: "info" },
  { label: "Portal Gates Online", value: "6 / 6", delta: "All operational", tone: "success" },
] as const;

export const HOURLY_TAGS = [
  { h: "00", v: 14 }, { h: "01", v: 9 }, { h: "02", v: 7 }, { h: "03", v: 6 },
  { h: "04", v: 11 }, { h: "05", v: 22 }, { h: "06", v: 41 }, { h: "07", v: 58 },
  { h: "08", v: 73 }, { h: "09", v: 89 }, { h: "10", v: 76 }, { h: "11", v: 64 },
];

export const ALARM_TREND = [
  { d: "Mon", v: 22 }, { d: "Tue", v: 18 }, { d: "Wed", v: 27 },
  { d: "Thu", v: 31 }, { d: "Fri", v: 24 }, { d: "Sat", v: 19 }, { d: "Sun", v: 18 },
];

export const THREAT_DIST = [
  { name: "Suspect Bag", value: 64, color: "var(--color-danger)" },
  { name: "Movement Alert", value: 22, color: "var(--color-warning)" },
  { name: "Re-entry", value: 9, color: "var(--color-info)" },
  { name: "Unknown Tag", value: 5, color: "var(--color-primary)" },
];

export const READER_HEALTH = [
  { name: "Healthy", value: 38 },
  { name: "Degraded", value: 4 },
  { name: "Offline", value: 2 },
];

export const TRAFFIC_TREND = [
  { t: "06:00", pax: 1240 }, { t: "07:00", pax: 2180 }, { t: "08:00", pax: 3120 },
  { t: "09:00", pax: 4380 }, { t: "10:00", pax: 4120 }, { t: "11:00", pax: 3680 },
  { t: "12:00", pax: 3220 },
];

export type AlarmStatus = "ACTIVE" | "ACKNOWLEDGED" | "ESCALATED" | "CLOSED";
export const ALARMS: {
  id: string; time: string; tag: string; flight: string; location: string;
  threat: string; status: AlarmStatus; officer: string;
}[] = [
  { id: "A-7844", time: "09:14:22", tag: "ETB-240091", flight: "SV452", location: "Custom Exit Gate 02", threat: "Suspect Bag Detected", status: "ACTIVE", officer: "Unassigned" },
  { id: "A-7843", time: "09:08:51", tag: "ETB-240083", flight: "QR1163", location: "Custom Exit Gate 03", threat: "Suspect Bag Detected", status: "ESCALATED", officer: "S. Khalid" },
  { id: "A-7842", time: "08:52:09", tag: "ETB-240077", flight: "EK212", location: "Tagging Station 04", threat: "Movement Alert", status: "ACKNOWLEDGED", officer: "M. Al-Qahtani" },
  { id: "A-7841", time: "08:41:33", tag: "ETB-240072", flight: "TK148", location: "Arrival Hall", threat: "Re-entry", status: "ACKNOWLEDGED", officer: "F. Otaibi" },
  { id: "A-7840", time: "08:30:11", tag: "ETB-240068", flight: "MS667", location: "Custom Exit Gate 01", threat: "Suspect Bag Detected", status: "CLOSED", officer: "S. Khalid" },
  { id: "A-7839", time: "08:12:47", tag: "ETB-240055", flight: "EK783", location: "Lost & Found", threat: "Unknown Tag", status: "CLOSED", officer: "N. Harbi" },
  { id: "A-7838", time: "07:58:02", tag: "ETB-240049", flight: "LH628", location: "Recheck Station 02", threat: "Movement Alert", status: "CLOSED", officer: "A. Zahrani" },
  { id: "A-7837", time: "07:41:18", tag: "ETB-240041", flight: "AF655", location: "Custom Exit Gate 04", threat: "Suspect Bag Detected", status: "CLOSED", officer: "M. Al-Qahtani" },
];

export const TAG_TIMELINE = [
  { time: "08:12", event: "Tagged at Station 04", loc: "Tagging Station 04", icon: "tag" },
  { time: "08:15", event: "Read at Tagging Station 01", loc: "RDR-001 / Tagging Station 01", icon: "scan" },
  { time: "08:23", event: "Read at Recheck Station 01", loc: "RDR-020 / Recheck Station 01", icon: "scan" },
  { time: "08:32", event: "Read at Tagging Station 04", loc: "RDR-004 / Tagging Station 04", icon: "alert" },
  { time: "08:45", event: "Detected at Custom Exit Gate 02", loc: "RDR-011 / Custom Exit Gate 02", icon: "alarm" },
  { time: "09:14", event: "Alarm A-7844 raised", loc: "Customs Hall", icon: "alarm" },
];

export const READERS = [
  { id: "RDR-001", name: "Tagging Station 01", type: "ThingMagic IZAR", floor: "G", zone: "Tagging Station 01", ip: "10.42.7.11", status: "Online", readRate: 98 },
  { id: "RDR-002", name: "Tagging Station 02", type: "ThingMagic IZAR", floor: "G", zone: "Tagging Station 02", ip: "10.42.7.12", status: "Online", readRate: 97 },
  { id: "RDR-003", name: "Tagging Station 03", type: "ThingMagic IZAR", floor: "G", zone: "Tagging Station 03", ip: "10.42.7.13", status: "Online", readRate: 96 },
  { id: "RDR-004", name: "Tagging Station 04", type: "ThingMagic IZAR", floor: "G", zone: "Tagging Station 04", ip: "10.42.7.14", status: "Degraded", readRate: 72 },
  { id: "RDR-005", name: "Tagging Station 05", type: "ThingMagic IZAR", floor: "G", zone: "Tagging Station 05", ip: "10.42.7.15", status: "Online", readRate: 95 },
  { id: "RDR-010", name: "Custom Exit Gate 01", type: "ThingMagic IZAR", floor: "G", zone: "Custom Exit Gate 01", ip: "10.42.7.21", status: "Online", readRate: 99 },
  { id: "RDR-011", name: "Custom Exit Gate 02", type: "ThingMagic IZAR", floor: "G", zone: "Custom Exit Gate 02", ip: "10.42.7.22", status: "Online", readRate: 99 },
  { id: "RDR-012", name: "Custom Exit Gate 03", type: "ThingMagic IZAR", floor: "G", zone: "Custom Exit Gate 03", ip: "10.42.7.23", status: "Online", readRate: 98 },
  { id: "RDR-013", name: "Custom Exit Gate 04", type: "ThingMagic IZAR", floor: "G", zone: "Custom Exit Gate 04", ip: "10.42.7.24", status: "Offline", readRate: 0 },
  { id: "RDR-020", name: "Recheck Station 01", type: "ThingMagic IZAR", floor: "G", zone: "Recheck Station 01", ip: "10.42.7.31", status: "Online", readRate: 97 },
  { id: "RDR-021", name: "Recheck Station 02", type: "ThingMagic IZAR", floor: "G", zone: "Recheck Station 02", ip: "10.42.7.32", status: "Online", readRate: 94 },
];

export const USERS = [
  { name: "Sikandar Hussain", email: "s.khalid@ops.local", role: "Customs Supervisor", status: "Active", last: "09:21 today" },
  { name: "Mohammed Al-Qahtani", email: "m.qahtani@ops.local", role: "Operations Officer", status: "Active", last: "09:18 today" },
  { name: "Fahad Otaibi", email: "f.otaibi@ops.local", role: "Operations Officer", status: "Active", last: "08:42 today" },
  { name: "Noura Harbi", email: "n.harbi@ops.local", role: "Control Center Operator", status: "Active", last: "07:55 today" },
  { name: "Abdullah Zahrani", email: "a.zahrani@ops.local", role: "Operations Officer", status: "On Break", last: "07:12 today" },
  { name: "Lina Bakr", email: "l.bakr@ops.local", role: "Customs Supervisor", status: "Active", last: "06:48 today" },
  { name: "Yousef Mutairi", email: "y.mutairi@ops.local", role: "Airport Administrator", status: "Active", last: "Yesterday 22:14" },
  { name: "Hassan Dosari", email: "h.dosari@ops.local", role: "System Administrator", status: "Active", last: "Yesterday 18:02" },
  { name: "Reem Ghamdi", email: "r.ghamdi@ops.local", role: "Control Center Operator", status: "Active", last: "Yesterday 23:51" },
  { name: "Tariq Shehri", email: "t.shehri@ops.local", role: "Operations Officer", status: "Inactive", last: "3 days ago" },
  { name: "Maha Subaie", email: "m.subaie@ops.local", role: "Operations Officer", status: "Active", last: "08:01 today" },
  { name: "Ibrahim Asiri", email: "i.asiri@ops.local", role: "Customs Supervisor", status: "Active", last: "Yesterday 16:30" },
  { name: "Khalid Rashid", email: "k.rashid@ops.local", role: "Control Center Operator", status: "Active", last: "Yesterday 21:09" },
  { name: "Sara Najjar", email: "s.najjar@ops.local", role: "Operations Officer", status: "Active", last: "07:32 today" },
  { name: "Omar Faisal", email: "o.faisal@ops.local", role: "System Administrator", status: "Active", last: "Yesterday 19:44" },
];

export const ROLES = [
  "Operations Officer",
  "Control Center Operator",
  "Customs Supervisor",
  "Airport Administrator",
  "System Administrator",
];

export const PERMISSIONS = [
  "View Dashboard", "Acknowledge Alarms", "Escalate Alarms", "Close Alarms",
  "Manage Bags", "Run Recheck", "Manage Readers", "View Reports",
  "Manage Users", "Manage Roles", "System Settings",
];

// matrix[role][perm] = boolean
export const ROLE_MATRIX: Record<string, Record<string, boolean>> = {
  "Operations Officer":      { "View Dashboard":1,"Acknowledge Alarms":1,"Escalate Alarms":1,"Close Alarms":0,"Manage Bags":1,"Run Recheck":1,"Manage Readers":0,"View Reports":1,"Manage Users":0,"Manage Roles":0,"System Settings":0 } as any,
  "Customs Supervisor":      { "View Dashboard":1,"Acknowledge Alarms":1,"Escalate Alarms":1,"Close Alarms":1,"Manage Bags":1,"Run Recheck":1,"Manage Readers":0,"View Reports":1,"Manage Users":0,"Manage Roles":0,"System Settings":0 } as any,
  "Control Center Operator": { "View Dashboard":1,"Acknowledge Alarms":1,"Escalate Alarms":1,"Close Alarms":0,"Manage Bags":0,"Run Recheck":0,"Manage Readers":1,"View Reports":1,"Manage Users":0,"Manage Roles":0,"System Settings":0 } as any,
  "Airport Administrator":   { "View Dashboard":1,"Acknowledge Alarms":1,"Escalate Alarms":1,"Close Alarms":1,"Manage Bags":1,"Run Recheck":1,"Manage Readers":1,"View Reports":1,"Manage Users":1,"Manage Roles":1,"System Settings":1 } as any,
  "System Administrator":    { "View Dashboard":1,"Acknowledge Alarms":1,"Escalate Alarms":1,"Close Alarms":1,"Manage Bags":1,"Run Recheck":1,"Manage Readers":1,"View Reports":1,"Manage Users":1,"Manage Roles":1,"System Settings":1 } as any,
};

export const ESCALATIONS = [
  { trigger: "Suspect Bag Detected", role: "Customs Supervisor", method: "Email + SMS", sla: "2 min" },
  { trigger: "Suspect Bag at Exit Gate", role: "Airport Administrator", method: "SMS + Push", sla: "1 min" },
  { trigger: "Movement Alert (Washroom)", role: "Operations Officer", method: "Push", sla: "5 min" },
  { trigger: "Reader Offline > 5 min", role: "Control Center Operator", method: "Email", sla: "10 min" },
  { trigger: "Re-entry After Clearance", role: "Customs Supervisor", method: "SMS", sla: "3 min" },
];

export const MAP_LOCATIONS = [
  { id: "ah", name: "Arrival Hall", x: 50, y: 50, kind: "area" },
  { id: "ts01", name: "Tagging Station 01", x: 18, y: 30, kind: "reader" },
  { id: "ts02", name: "Tagging Station 02", x: 32, y: 30, kind: "reader" },
  { id: "ts03", name: "Tagging Station 03", x: 46, y: 30, kind: "reader" },
  { id: "ts04", name: "Tagging Station 04", x: 26, y: 60, kind: "alarm" },
  { id: "ts05", name: "Tagging Station 05", x: 70, y: 70, kind: "reader" },
  { id: "ce01", name: "Custom Exit Gate 01", x: 55, y: 82, kind: "reader" },
  { id: "ce02", name: "Custom Exit Gate 02", x: 65, y: 86, kind: "alarm" },
  { id: "ce03", name: "Custom Exit Gate 03", x: 75, y: 82, kind: "reader" },
  { id: "ce04", name: "Custom Exit Gate 04", x: 85, y: 78, kind: "reader" },
  { id: "rs01", name: "Recheck Station 01", x: 10, y: 78, kind: "reader" },
  { id: "rs02", name: "Recheck Station 02", x: 90, y: 50, kind: "area" },
];

export const SUSPECT_BAGS_ON_MAP = [
  { tag: "ETB-240091", flight: "SV452", passenger: "Ahmed Al-Harbi", x: 27, y: 58, status: "ALARM" },
  { tag: "ETB-240055", flight: "EK783", passenger: "Ravi Subramanian", x: 50, y: 48, status: "TRACKING" },
  { tag: "ETB-240077", flight: "EK212", passenger: "Maria Gonzalez", x: 70, y: 68, status: "TRACKING" },
  { tag: "ETB-240083", flight: "QR1163", passenger: "Daniel Becker", x: 46, y: 32, status: "ALARM" },
];

export const FLIGHTS = ["SV452", "EK783", "EK212", "QR1163", "TK148", "MS667", "LH628", "AF655"];

export const SEED_ALARMS: Alarm[] = [
  { id: "A-7844", bagId: "b1", zone: "CUSTOMS_EXIT_GATE_2", triggeredAt: "2026-07-07T09:14:22", acknowledgedBy: null, outcome: "OPEN" },
  { id: "A-7843", bagId: "b2", zone: "RECLAIM_BELT_3", triggeredAt: "2026-07-07T09:08:51", acknowledgedBy: "S. Khalid", outcome: "ESCALATED" },
  { id: "A-7842", bagId: "b3", zone: "WASHROOM_NORTH", triggeredAt: "2026-07-07T08:52:09", acknowledgedBy: "M. Al-Qahtani", outcome: "UNDER_INVESTIGATION" },
  { id: "A-7841", bagId: "b4", zone: "ARRIVAL_HALL", triggeredAt: "2026-07-07T08:41:33", acknowledgedBy: "F. Otaibi", outcome: "UNDER_INVESTIGATION" },
  { id: "A-7840", bagId: "b5", zone: "CUSTOMS_EXIT_GATE_1", triggeredAt: "2026-07-07T08:30:11", acknowledgedBy: "S. Khalid", outcome: "CLEARED" },
  { id: "A-7839", bagId: "b6", zone: "LOST_FOUND", triggeredAt: "2026-07-07T08:12:47", acknowledgedBy: "N. Harbi", outcome: "CLEARED" },
  { id: "A-7838", bagId: "b7", zone: "WASHROOM_SOUTH", triggeredAt: "2026-07-07T07:58:02", acknowledgedBy: "A. Zahrani", outcome: "CLEARED" },
  { id: "A-7837", bagId: "b8", zone: "CUSTOMS_EXIT_GATE_3", triggeredAt: "2026-07-07T07:41:18", acknowledgedBy: "M. Al-Qahtani", outcome: "CLEARED" },
];

export const SEED_READERS: Reader[] = [
  { id: "RDR-001", name: "Reclaim Belt 1 Reader", model: "ThingMagic IZAR", zone: "RECLAIM_BELT_1", ip: "10.42.7.11", status: "ONLINE", readRate: 98 },
  { id: "RDR-002", name: "Reclaim Belt 2 Reader", model: "ThingMagic IZAR", zone: "RECLAIM_BELT_2", ip: "10.42.7.12", status: "ONLINE", readRate: 96 },
  { id: "RDR-003", name: "Reclaim Belt 3 Reader", model: "ThingMagic IZAR", zone: "RECLAIM_BELT_3", ip: "10.42.7.13", status: "ONLINE", readRate: 94 },
  { id: "RDR-004", name: "Arrival Hall Portal", model: "ThingMagic IZAR", zone: "ARRIVAL_HALL", ip: "10.42.7.14", status: "ONLINE", readRate: 99 },
  { id: "RDR-007", name: "Employee Entrance", model: "ThingMagic IZAR", zone: "EMPLOYEE_EXIT", ip: "10.42.7.17", status: "DEGRADED", readRate: 71 },
  { id: "RDR-012", name: "Lost & Found Reader", model: "ThingMagic IZAR", zone: "LOST_FOUND", ip: "10.42.7.22", status: "ONLINE", readRate: 95 },
  { id: "RDR-019", name: "Washroom North Reader", model: "ThingMagic IZAR", zone: "WASHROOM_NORTH", ip: "10.42.7.29", status: "DEGRADED", readRate: 68 },
  { id: "RDR-020", name: "Washroom South Reader", model: "ThingMagic IZAR", zone: "WASHROOM_SOUTH", ip: "10.42.7.30", status: "OFFLINE", readRate: 0 },
  { id: "RDR-021", name: "Customs Exit Gate 1", model: "ThingMagic IZAR", zone: "CUSTOMS_EXIT_GATE_1", ip: "10.42.7.31", status: "ONLINE", readRate: 99 },
  { id: "RDR-022", name: "Customs Exit Gate 2", model: "ThingMagic IZAR", zone: "CUSTOMS_EXIT_GATE_2", ip: "10.42.7.32", status: "ONLINE", readRate: 99 },
  { id: "RDR-023", name: "Customs Exit Gate 3", model: "ThingMagic IZAR", zone: "CUSTOMS_EXIT_GATE_3", ip: "10.42.7.33", status: "ONLINE", readRate: 97 },
  { id: "RDR-031", name: "Emergency Exit West", model: "ThingMagic IZAR", zone: "EMERGENCY_DOOR", ip: "10.42.7.41", status: "ONLINE", readRate: 92 },
];

export const SEED_EVENTS: RfidEvent[] = [
  { id: "ev-001", epc: "EPC-240091", readerId: "RDR-TAG-02", zone: "TAGGING_STATION_2", eventType: "TAG_ENCODED", firstSeen: "2026-07-07T08:12:00", lastSeen: "2026-07-07T08:12:00", readCount: 1, rssi: -32 },
  { id: "ev-002", epc: "EPC-240091", readerId: "RDR-001", zone: "RECLAIM_BELT_1", eventType: "RECLAIM_DETECTED", firstSeen: "2026-07-07T08:15:00", lastSeen: "2026-07-07T08:15:04", readCount: 8, rssi: -48 },
  { id: "ev-003", epc: "EPC-240091", readerId: "RDR-004", zone: "ARRIVAL_HALL", eventType: "HALL_DETECTED", firstSeen: "2026-07-07T08:23:00", lastSeen: "2026-07-07T08:23:02", readCount: 5, rssi: -52 },
  { id: "ev-004", epc: "EPC-240091", readerId: "RDR-019", zone: "WASHROOM_NORTH", eventType: "WASHROOM_DETECTED", firstSeen: "2026-07-07T08:32:00", lastSeen: "2026-07-07T08:32:06", readCount: 12, rssi: -55 },
  { id: "ev-005", epc: "EPC-240091", readerId: "RDR-022", zone: "CUSTOMS_EXIT_GATE_2", eventType: "CUSTOMS_EXIT_DETECTED", firstSeen: "2026-07-07T08:45:00", lastSeen: "2026-07-07T08:45:01", readCount: 3, rssi: -41 },
  { id: "ev-006", epc: "EPC-240091", readerId: "RDR-022", zone: "CUSTOMS_EXIT_GATE_2", eventType: "ALARM_TRIGGERED", firstSeen: "2026-07-07T09:14:00", lastSeen: "2026-07-07T09:14:00", readCount: 1, rssi: -40 },
];
