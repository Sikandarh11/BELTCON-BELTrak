/** Shared freshness and retry policy for BELTCON SBTS operational queries. */
export const BELTCON_QUERY_STALE_TIME = {
  session: 15_000,
  activeOperationalQueue: 5_000,
  rfidEvents: 15_000,
  readerHealth: 15_000,
  readerConfiguration: 60_000,
  audit: 45_000,
  reports: 120_000,
} as const;

export const BELTCON_QUERY_REFETCH_INTERVAL = {
  activeOperationalQueue: 15_000,
  rfidEvents: 30_000,
  readerHealth: 30_000,
} as const;

export const BELTCON_QUERY_RETRY = {
  read: 2,
  mutation: 0,
} as const;
