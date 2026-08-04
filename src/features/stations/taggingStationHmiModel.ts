export type StationHmiInput = {
  health: { state: string; pendingSynchronizations: number };
  queue: {
    position1: { id: string; bhsUid: string; state: string; synchronizationStatus: string } | null;
    position2: { id: string; bhsUid: string; state: string; synchronizationStatus: string } | null;
    alarms: Array<{ code: string }>;
  };
  simulation: boolean;
  lastReceive?: { outcome: string; errorCode: string | null } | null;
};

export function createTaggingStationHmiModel(input: StationHmiInput) {
  const queueFull =
    Boolean(input.queue.position1 && input.queue.position2) ||
    input.queue.alarms.some((alarm) => alarm.code === "QUEUE_CAPACITY_REACHED");
  const jammed = input.queue.position1?.state === "JAMMED";
  const synchronizationPending =
    input.health.pendingSynchronizations > 0 ||
    [input.queue.position1, input.queue.position2].some((item) =>
      item
        ? ["NOT_STARTED", "PENDING", "IN_PROGRESS", "RETRY_PENDING"].includes(
            item.synchronizationStatus,
          )
        : false,
    );
  return {
    stationStatus: input.simulation ? "SIMULATION" : input.health.state,
    underlyingHealth: input.health.state,
    activeBag: input.queue.position1,
    waitingBag: input.queue.position2,
    activeBagKey: input.queue.position1
      ? `${input.queue.position1.id}:${input.queue.position1.bhsUid}`
      : null,
    queueFull,
    jammed,
    synchronizationPending,
    receiveNotice:
      input.lastReceive?.errorCode ??
      (input.lastReceive?.outcome === "DUPLICATE" ? "DUPLICATE" : null),
  };
}
