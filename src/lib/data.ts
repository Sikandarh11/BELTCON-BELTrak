// Realistic dummy data for BELTrak prototype

export const KPIS = [
  { label: "Suspect Bags Tagged Today", value: 127, delta: "+12 vs yesterday", tone: "primary" },
  { label: "Active Suspect Bags", value: 34, delta: "+3 last hour", tone: "warning" },
  { label: "Alarms Raised Today", value: 18, delta: "4 unresolved", tone: "danger" },
  { label: "Bags Cleared", value: 109, delta: "85.8% clearance", tone: "success" },
  { label: "Online RFID Readers", value: "42 / 44", delta: "2 offline", tone: "info" },
  { label: "Portal Gates Online", value: "6 / 6", delta: "All operational", tone: "success" },
] as const;

export const ACTIVITY = [
  { time: "09:12", text: "Bag ETB-240091 detected at Washroom North Reader", level: "warn" },
  { time: "09:14", text: "Alarm A-7844 triggered at Customs Exit Gate 2", level: "danger" },
  { time: "09:17", text: "Supervisor S. Khalid acknowledged Alarm A-7844", level: "info" },
  { time: "09:21", text: "Bag ETB-240055 re-read at Reclaim Belt 1 (SV452 → EK783 link)", level: "info" },
  { time: "09:24", text: "Reader RDR-019 (Washroom South) reported low read-rate", level: "warn" },
  { time: "09:28", text: "Bag ETB-240077 cleared after secondary inspection", level: "success" },
  { time: "09:31", text: "Officer M. Al-Qahtani assigned to Recheck Station 2", level: "info" },
  { time: "09:35", text: "RFID antenna A3 on RDR-007 reset successfully", level: "success" },
];

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
  { id: "A-7844", time: "09:14:22", tag: "ETB-240091", flight: "SV452", location: "Customs Exit Gate 2", threat: "Suspect Bag Detected", status: "ACTIVE", officer: "Unassigned" },
  { id: "A-7843", time: "09:08:51", tag: "ETB-240083", flight: "QR1163", location: "Reclaim Belt 3", threat: "Suspect Bag Detected", status: "ESCALATED", officer: "S. Khalid" },
  { id: "A-7842", time: "08:52:09", tag: "ETB-240077", flight: "EK212", location: "Washroom North", threat: "Movement Alert", status: "ACKNOWLEDGED", officer: "M. Al-Qahtani" },
  { id: "A-7841", time: "08:41:33", tag: "ETB-240072", flight: "TK148", location: "Arrival Hall", threat: "Re-entry", status: "ACKNOWLEDGED", officer: "F. Otaibi" },
  { id: "A-7840", time: "08:30:11", tag: "ETB-240068", flight: "MS667", location: "Customs Exit Gate 1", threat: "Suspect Bag Detected", status: "CLOSED", officer: "S. Khalid" },
  { id: "A-7839", time: "08:12:47", tag: "ETB-240055", flight: "EK783", location: "Lost & Found", threat: "Unknown Tag", status: "CLOSED", officer: "N. Harbi" },
  { id: "A-7838", time: "07:58:02", tag: "ETB-240049", flight: "LH628", location: "Washroom South", threat: "Movement Alert", status: "CLOSED", officer: "A. Zahrani" },
  { id: "A-7837", time: "07:41:18", tag: "ETB-240041", flight: "AF655", location: "Customs Exit Gate 3", threat: "Suspect Bag Detected", status: "CLOSED", officer: "M. Al-Qahtani" },
];

export const TAG_TIMELINE = [
  { time: "08:12", event: "Tagged at Station 2", loc: "Suspect Tagging Station 2", icon: "tag" },
  { time: "08:15", event: "Read at Reclaim Belt 1", loc: "RDR-001 / Belt 1", icon: "scan" },
  { time: "08:23", event: "Read at Arrival Hall", loc: "RDR-004 / Hall A", icon: "scan" },
  { time: "08:32", event: "Read at Washroom North", loc: "RDR-019 / WC-N", icon: "alert" },
  { time: "08:45", event: "Detected at Customs Exit Gate 2", loc: "RDR-021 / Gate 2", icon: "alarm" },
  { time: "09:14", event: "Alarm A-7844 raised", loc: "Customs Hall", icon: "alarm" },
];

export const READERS = [
  { id: "RDR-001", name: "Reclaim Belt 1 Reader", type: "Impinj R700", floor: "G", ip: "10.42.7.11", status: "Online", readRate: 98 },
  { id: "RDR-002", name: "Reclaim Belt 2 Reader", type: "Impinj R700", floor: "G", ip: "10.42.7.12", status: "Online", readRate: 96 },
  { id: "RDR-003", name: "Reclaim Belt 3 Reader", type: "Impinj R700", floor: "G", ip: "10.42.7.13", status: "Online", readRate: 94 },
  { id: "RDR-004", name: "Arrival Hall Portal", type: "Zebra FX9600", floor: "G", ip: "10.42.7.14", status: "Online", readRate: 99 },
  { id: "RDR-007", name: "Employee Entrance", type: "Zebra FX9600", floor: "G", ip: "10.42.7.17", status: "Degraded", readRate: 71 },
  { id: "RDR-012", name: "Lost & Found Reader", type: "Impinj R420", floor: "G", ip: "10.42.7.22", status: "Online", readRate: 95 },
  { id: "RDR-019", name: "Washroom North Reader", type: "Impinj R420", floor: "G", ip: "10.42.7.29", status: "Degraded", readRate: 68 },
  { id: "RDR-020", name: "Washroom South Reader", type: "Impinj R420", floor: "G", ip: "10.42.7.30", status: "Offline", readRate: 0 },
  { id: "RDR-021", name: "Customs Exit Gate 1", type: "Zebra ATR7000", floor: "G", ip: "10.42.7.31", status: "Online", readRate: 99 },
  { id: "RDR-022", name: "Customs Exit Gate 2", type: "Zebra ATR7000", floor: "G", ip: "10.42.7.32", status: "Online", readRate: 99 },
  { id: "RDR-023", name: "Customs Exit Gate 3", type: "Zebra ATR7000", floor: "G", ip: "10.42.7.33", status: "Online", readRate: 97 },
  { id: "RDR-031", name: "Emergency Exit West", type: "Impinj R420", floor: "G", ip: "10.42.7.41", status: "Online", readRate: 92 },
];

export const USERS = [
  { name: "Sikandar Hussain", email: "s.khalid@jed-airport.sa", role: "Customs Supervisor", status: "Active", last: "09:21 today" },
  { name: "Mohammed Al-Qahtani", email: "m.qahtani@jed-airport.sa", role: "Operations Officer", status: "Active", last: "09:18 today" },
  { name: "Fahad Otaibi", email: "f.otaibi@jed-airport.sa", role: "Operations Officer", status: "Active", last: "08:42 today" },
  { name: "Noura Harbi", email: "n.harbi@jed-airport.sa", role: "Control Center Operator", status: "Active", last: "07:55 today" },
  { name: "Abdullah Zahrani", email: "a.zahrani@jed-airport.sa", role: "Operations Officer", status: "On Break", last: "07:12 today" },
  { name: "Lina Bakr", email: "l.bakr@jed-airport.sa", role: "Customs Supervisor", status: "Active", last: "06:48 today" },
  { name: "Yousef Mutairi", email: "y.mutairi@jed-airport.sa", role: "Airport Administrator", status: "Active", last: "Yesterday 22:14" },
  { name: "Hassan Dosari", email: "h.dosari@jed-airport.sa", role: "System Administrator", status: "Active", last: "Yesterday 18:02" },
  { name: "Reem Ghamdi", email: "r.ghamdi@jed-airport.sa", role: "Control Center Operator", status: "Active", last: "Yesterday 23:51" },
  { name: "Tariq Shehri", email: "t.shehri@jed-airport.sa", role: "Operations Officer", status: "Inactive", last: "3 days ago" },
  { name: "Maha Subaie", email: "m.subaie@jed-airport.sa", role: "Operations Officer", status: "Active", last: "08:01 today" },
  { name: "Ibrahim Asiri", email: "i.asiri@jed-airport.sa", role: "Customs Supervisor", status: "Active", last: "Yesterday 16:30" },
  { name: "Khalid Rashid", email: "k.rashid@jed-airport.sa", role: "Control Center Operator", status: "Active", last: "Yesterday 21:09" },
  { name: "Sara Najjar", email: "s.najjar@jed-airport.sa", role: "Operations Officer", status: "Active", last: "07:32 today" },
  { name: "Omar Faisal", email: "o.faisal@jed-airport.sa", role: "System Administrator", status: "Active", last: "Yesterday 19:44" },
];

export const ROLES = [
  "Operations Officer",
  "Customs Supervisor",
  "Control Center Operator",
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
  { id: "ah",  name: "Arrival Hall",         x: 50,  y: 50,  kind: "area" },
  { id: "rb1", name: "Reclaim Belt 1",       x: 18,  y: 30,  kind: "reader" },
  { id: "rb2", name: "Reclaim Belt 2",       x: 32,  y: 30,  kind: "reader" },
  { id: "rb3", name: "Reclaim Belt 3",       x: 46,  y: 30,  kind: "reader" },
  { id: "wn",  name: "Washroom North",       x: 26,  y: 60,  kind: "alarm" },
  { id: "ws",  name: "Washroom South",       x: 70,  y: 70,  kind: "reader" },
  { id: "lf",  name: "Lost & Found",         x: 78,  y: 28,  kind: "reader" },
  { id: "ee",  name: "Employee Entrance",    x: 10,  y: 78,  kind: "reader" },
  { id: "ex",  name: "Emergency Exit",       x: 90,  y: 50,  kind: "area" },
  { id: "cg1", name: "Customs Exit Gate 1",  x: 55,  y: 82,  kind: "reader" },
  { id: "cg2", name: "Customs Exit Gate 2",  x: 65,  y: 86,  kind: "alarm" },
  { id: "cg3", name: "Customs Exit Gate 3",  x: 75,  y: 82,  kind: "reader" },
];

export const SUSPECT_BAGS_ON_MAP = [
  { tag: "ETB-240091", flight: "SV452", passenger: "Ahmed Al-Harbi",  x: 27, y: 58, status: "ALARM" },
  { tag: "ETB-240055", flight: "EK783", passenger: "Ravi Subramanian", x: 50, y: 48, status: "TRACKING" },
  { tag: "ETB-240077", flight: "EK212", passenger: "Maria Gonzalez",   x: 70, y: 68, status: "TRACKING" },
  { tag: "ETB-240083", flight: "QR1163", passenger: "Daniel Becker",   x: 46, y: 32, status: "ALARM" },
];

export const FLIGHTS = ["SV452", "EK783", "EK212", "QR1163", "TK148", "MS667", "LH628", "AF655"];
