/**
 * BELTCON Query Architecture
 *
 * Every key used for server-owned data is declared here.  Filters are copied,
 * stripped of undefined values and sorted so equivalent requests share one
 * cache entry regardless of object construction order.
 */

type QueryFilterValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly QueryFilterValue[]
  | { readonly [key: string]: QueryFilterValue };

export type QueryFilters = Readonly<Record<string, QueryFilterValue>>;

function normalizeValue(value: unknown): QueryFilterValue {
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map(normalizeValue)
      .filter((item): item is Exclude<QueryFilterValue, undefined> => item !== undefined)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }

  if (value !== null && typeof value === "object") {
    return normalizeQueryFilters(value as QueryFilters);
  }

  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? value
    : undefined;
}

/** Creates a stable, serializable snapshot for a TanStack Query key. */
export function normalizeQueryFilters(
  filters?: object,
): Readonly<Record<string, QueryFilterValue>> {
  if (!filters) return {};

  return Object.fromEntries(
    Object.entries(filters)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, normalizeValue(value)] as const)
      .filter(([, value]) => value !== undefined),
  );
}

export const authKeys = {
  all: ["auth"] as const,
  session: () => ["auth", "session"] as const,
  sessionAtPath: (pathname: string) => ["auth", "session", pathname] as const,
} as const;

export const userKeys = {
  all: ["admin", "users"] as const,
  lists: () => ["admin", "users", "list"] as const,
  list: (filters: object) => ["admin", "users", "list", normalizeQueryFilters(filters)] as const,
  detail: (userId: string) => ["admin", "users", "detail", userId] as const,
} as const;

export const roleKeys = {
  all: ["admin", "roles"] as const,
  permissions: () => ["admin", "roles", "permissions"] as const,
  detail: (roleId: string) => ["admin", "roles", "detail", roleId] as const,
} as const;

export const permissionKeys = {
  all: ["admin", "permissions"] as const,
  catalog: () => ["admin", "permissions", "catalog"] as const,
} as const;

export const bagKeys = {
  all: ["bags"] as const,
  lists: () => ["bags", "list"] as const,
  list: (filters: object) => ["bags", "list", normalizeQueryFilters(filters)] as const,
  detail: (bagId: string) => ["bags", "detail", bagId] as const,
} as const;

export const taggingKeys = {
  all: ["bags", "tagging"] as const,
  queue: (filters: object = {}) =>
    ["bags", "tagging", "queue", normalizeQueryFilters(filters)] as const,
  recent: (limit: number) => ["bags", "tagging", "recent", limit] as const,
  bag: (bagId: string) => ["bags", "tagging", "bag", bagId] as const,
} as const;

export const rfidKeys = {
  all: ["rfid"] as const,
  events: (filters: object = {}) => ["rfid", "events", normalizeQueryFilters(filters)] as const,
  event: (eventId: string) => ["rfid", "event", eventId] as const,
  trackableBags: (filters: object = {}) =>
    ["bags", "rfid-trackable", normalizeQueryFilters(filters)] as const,
} as const;

export const readerKeys = {
  all: ["readers"] as const,
  list: (filters: object = {}) => ["readers", "list", normalizeQueryFilters(filters)] as const,
  detail: (readerId: string) => ["readers", "detail", readerId] as const,
  antennaMap: () => ["readers", "antenna-map"] as const,
  health: (filters: object = {}) => ["readers", "health", normalizeQueryFilters(filters)] as const,
} as const;

export const alarmKeys = {
  all: ["alarms"] as const,
  lists: () => ["alarms", "list"] as const,
  list: (filters: object) => ["alarms", "list", normalizeQueryFilters(filters)] as const,
  detail: (alarmId: string) => ["alarms", "detail", alarmId] as const,
  actions: (alarmId: string) => ["alarms", "actions", alarmId] as const,
} as const;

export const recheckKeys = {
  all: ["recheck"] as const,
  queue: (filters: object) => ["recheck", "queue", normalizeQueryFilters(filters)] as const,
  caseByTag: (tag: string) => ["recheck", "tag", tag] as const,
  caseByBag: (bagId: string) => ["recheck", "case", bagId] as const,
  recallHistory: (bagId: string) => ["recheck", "recalls", bagId] as const,
} as const;

export const hbssKeys = {
  all: ["hbss"] as const,
  health: () => ["hbss", "health"] as const,
  recalls: (bagId: string) => ["hbss", "recalls", bagId] as const,
  xraySelection: (bagId: string) => ["hbss", "xray-selection", bagId] as const,
} as const;

export const resolutionKeys = {
  all: ["resolutions"] as const,
  byBag: (bagId: string) => ["resolutions", "bag", bagId] as const,
  byAlarm: (alarmId: string) => ["resolutions", "alarm", alarmId] as const,
} as const;

export const auditKeys = {
  all: ["audit-events"] as const,
  list: (filters: object = {}) => ["audit-events", "list", normalizeQueryFilters(filters)] as const,
  detail: (auditId: string) => ["audit-events", "detail", auditId] as const,
} as const;

export const reportKeys = {
  all: ["reports"] as const,
  operational: (filters: object = {}) =>
    ["reports", "operational", normalizeQueryFilters(filters)] as const,
  bagLifecycle: (filters: object = {}) =>
    ["reports", "bag-lifecycle", normalizeQueryFilters(filters)] as const,
  tagging: (filters: object = {}) =>
    ["reports", "tagging", normalizeQueryFilters(filters)] as const,
  rfid: (filters: object = {}) => ["reports", "rfid", normalizeQueryFilters(filters)] as const,
  alarms: (filters: object = {}) => ["reports", "alarms", normalizeQueryFilters(filters)] as const,
  recheck: (filters: object = {}) =>
    ["reports", "recheck", normalizeQueryFilters(filters)] as const,
  readers: (filters: object = {}) =>
    ["reports", "readers", normalizeQueryFilters(filters)] as const,
  integrations: (filters: object = {}) =>
    ["reports", "integrations", normalizeQueryFilters(filters)] as const,
} as const;

export const integrationKeys = {
  all: ["integrations"] as const,
  bhsEvents: (filters: object = {}) =>
    ["integrations", "bhs-events", normalizeQueryFilters(filters)] as const,
  rfidEvents: (filters: object = {}) =>
    ["integrations", "rfid-events", normalizeQueryFilters(filters)] as const,
} as const;

export const bhsKeys = {
  all: ["bhs"] as const,
  pendingConfirmations: () => ["bhs", "pending-confirmations"] as const,
} as const;
