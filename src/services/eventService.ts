/**
 * @deprecated RFID reads must be ingested by the server-side RFID endpoint.
 * Browser-local deduplication and lifecycle changes are not authoritative.
 */
function removed(): never {
  throw new Error("Browser RFID event authority was removed. Use the RFID ingestion API.");
}

export const eventService = {
  ingestRead: async (_epc: string, _readerId: string, _zone: string) => removed(),
  clearCache: () => undefined,
};
