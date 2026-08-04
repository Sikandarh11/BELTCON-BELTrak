export const DEFAULT_CLOCK_TIME = "2026-07-30T10:00:00.000Z";

export function createDeterministicClock(start = DEFAULT_CLOCK_TIME) {
  let current = new Date(start).getTime();
  if (!Number.isFinite(current))
    throw new TypeError("The deterministic clock requires an ISO time");

  return {
    now: () => current,
    nowIso: () => new Date(current).toISOString(),
    date: () => new Date(current),
    set(value) {
      const next = typeof value === "number" ? value : new Date(value).getTime();
      if (!Number.isFinite(next))
        throw new TypeError("The deterministic clock requires a valid time");
      current = next;
      return this.nowIso();
    },
    advance(milliseconds) {
      if (!Number.isFinite(milliseconds)) throw new TypeError("Clock advancement must be finite");
      current += milliseconds;
      return this.nowIso();
    },
    reset() {
      current = new Date(start).getTime();
    },
  };
}

export function installFakeTimers(testContext, start = DEFAULT_CLOCK_TIME) {
  testContext.mock.timers.enable({ apis: ["Date"], now: new Date(start) });
  return {
    tick: (milliseconds) => testContext.mock.timers.tick(milliseconds),
    reset: () => testContext.mock.timers.reset(),
  };
}
