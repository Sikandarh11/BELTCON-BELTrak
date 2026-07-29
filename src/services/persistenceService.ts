/**
 * @deprecated Phase 8 removed browser-side operational persistence.  Use a
 * typed BELTCON domain client and its authenticated server API instead.
 */
function removed(): never {
  throw new Error("Browser operational persistence was removed. Use an authenticated server API.");
}

export const persistenceService = {
  loadAll: async () => removed(),
  upsertBag: async (_input: unknown) => removed(),
  updateBag: async (_id: string, _input: unknown) => removed(),
  insertAlarm: async (_input: unknown) => removed(),
  updateAlarm: async (_id: string, _input: unknown) => removed(),
  insertEvent: async (_input: unknown) => removed(),
  updateEvent: async (_id: string, _input: unknown) => removed(),
  insertResolution: async (_input: unknown) => removed(),
  updateReader: async (_id: string, _input: unknown) => removed(),
  resetAll: async () => removed(),
};
