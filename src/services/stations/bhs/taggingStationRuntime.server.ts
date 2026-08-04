import "@tanstack/react-start/server-only";

import { readTaggingStationConfig } from "../stationConfig";
import { BhsPlcSimulator } from "./bhsPlcSimulator";
import {
  LoopbackBhsStationTransport,
  ProfinetBhsStationTransport,
  SimulatedBhsStationTransport,
  type BhsStationTransport,
} from "./bhsStationTransport";
import { SqliteStationInboxRepository } from "./stationInboxRepository.server";
import { DefaultTaggingStationAgent, HttpBhsCentralClient } from "./taggingStationAgent.server";

export class TaggingStationRuntimeError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export interface TaggingStationRuntime {
  agent: DefaultTaggingStationAgent;
  transport: BhsStationTransport;
  simulator: BhsPlcSimulator | null;
  simulation: boolean;
  shutdown(): Promise<void>;
}

function transportFor(type: "SIMULATED" | "LOOPBACK" | "PROFINET") {
  if (type === "SIMULATED") return new SimulatedBhsStationTransport();
  if (type === "LOOPBACK") return new LoopbackBhsStationTransport();
  return new ProfinetBhsStationTransport();
}

export async function createTaggingStationRuntime(
  environment: Record<string, string | undefined> = process.env,
): Promise<TaggingStationRuntime> {
  if (environment.BHS_STATION_ENABLED?.trim().toLowerCase() !== "true") {
    throw new TaggingStationRuntimeError(
      "The tagging-station agent is disabled",
      "BHS_STATION_AGENT_DISABLED",
    );
  }
  const config = readTaggingStationConfig(environment);
  const transport = transportFor(config.transportType);
  const repository = new SqliteStationInboxRepository(
    config.localPersistencePath,
    config.stationId,
    config.siteId,
  );
  const central = new HttpBhsCentralClient(
    config.centralServerUrl,
    environment.BHS_STATION_CENTRAL_KEY?.trim() ?? "",
  );
  const agent = new DefaultTaggingStationAgent({
    config,
    transport,
    repository,
    centralClient: central,
  });
  try {
    await agent.start();
  } catch (error) {
    repository.close();
    throw error;
  }
  const simulatedTransport = transport instanceof SimulatedBhsStationTransport ? transport : null;
  return {
    agent,
    transport,
    simulator: simulatedTransport ? new BhsPlcSimulator(simulatedTransport) : null,
    simulation: Boolean(simulatedTransport),
    async shutdown() {
      await agent.stop();
      repository.close();
    },
  };
}

const runtimeState = globalThis as typeof globalThis & {
  __sbtsTaggingStationRuntime?: Promise<TaggingStationRuntime>;
};

export function getTaggingStationRuntime() {
  runtimeState.__sbtsTaggingStationRuntime ??= createTaggingStationRuntime();
  return runtimeState.__sbtsTaggingStationRuntime;
}

export async function restartTaggingStationRuntime() {
  const current = runtimeState.__sbtsTaggingStationRuntime;
  runtimeState.__sbtsTaggingStationRuntime = undefined;
  if (current) await (await current).shutdown();
  return getTaggingStationRuntime();
}
