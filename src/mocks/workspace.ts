import type { AuditEntry } from "@/store/appStore";

const ACTIVITY = [
  {
    action: "ALARM_ACKNOWLEDGED",
    userName: "Mohammed Al-Qahtani",
    detail: "Alarm acknowledged at Customs Exit Gate 2",
  },
  {
    action: "BAG_SENT_TO_RECHECK",
    userName: "Fahad Otaibi",
    detail: "Bag routed to secondary inspection",
  },
  {
    action: "SUPERVISOR_OVERRIDE",
    userName: "Lina Bakr",
    detail: "Manual screening override recorded",
  },
  {
    action: "TAG_ENCODED",
    userName: "Tagging Station",
    detail: "EPC written and verified",
  },
  {
    action: "ALARM_RESOLVED",
    userName: "Sikandar Hussain",
    detail: "Alarm cleared after inspection",
  },
] as const;

export function createMockAuditEntries(count = 72): AuditEntry[] {
  const now = Date.now();

  return Array.from({ length: count }, (_, index) => {
    const activity = ACTIVITY[index % ACTIVITY.length];
    return {
      id: `mock-audit-${index + 1}`,
      action: activity.action,
      userId: `mock-user-${(index % 8) + 1}`,
      userName: activity.userName,
      detail: `${activity.detail} · record ${index + 1}`,
      timestamp: new Date(now - index * 45 * 60 * 1000).toISOString(),
    };
  });
}
