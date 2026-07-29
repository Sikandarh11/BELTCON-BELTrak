/**
 * @deprecated Browser-owned alarm mutations were removed in Phase 8.  Use
 * the authenticated alarm mutation hooks in services/alarms/alarmClient.
 */
function removed(): never {
  throw new Error("Browser alarm authority was removed. Use an authenticated alarm mutation.");
}

export const alarmService = {
  open: (_input: unknown) => removed(),
  acknowledge: (_alarmId: string, _officerName: string) => removed(),
  escalate: (_alarmId: string) => removed(),
  reassign: (_alarmId: string, _officerName: string) => removed(),
  close: (_alarmId: string, _action: string, _officerName: string) => removed(),
};
