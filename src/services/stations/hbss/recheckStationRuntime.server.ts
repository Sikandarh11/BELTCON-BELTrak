import "@tanstack/react-start/server-only";

import { recheckService } from "@/services/recheck/recheckService.server";
import { readRecheckStationConfig } from "../stationConfig";
import { SimulatedBarcodeInputAdapter } from "./barcodeInputAdapter";
import {
  LoopbackHbssSerialAdapter,
  PhysicalRs232Adapter,
  VirtualHbssSerialAdapter,
  type HbssSerialAdapter,
} from "./hbssSerialAdapter";
import { RecheckStationAgent } from "./recheckStationAgent.server";
import { SqliteRecheckStationRepository } from "./recheckStationRepository.server";

export class RecheckStationRuntimeError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export interface RecheckStationRuntime {
  agent: RecheckStationAgent;
  serialAdapter: HbssSerialAdapter;
  simulation: boolean;
  transmittedFrames(): Uint8Array[];
  shutdown(): Promise<void>;
}

function serialAdapterFor(
  type: "VIRTUAL" | "LOOPBACK" | "RS232",
  configuration: ConstructorParameters<typeof VirtualHbssSerialAdapter>[0],
) {
  if (type === "VIRTUAL") return new VirtualHbssSerialAdapter(configuration);
  if (type === "LOOPBACK") return new LoopbackHbssSerialAdapter(configuration);
  return new PhysicalRs232Adapter(configuration.binding);
}

export async function createRecheckStationRuntime(
  environment: Record<string, string | undefined> = process.env,
): Promise<RecheckStationRuntime> {
  if (environment.HBSS_RECHECK_STATION_ENABLED?.trim().toLowerCase() !== "true") {
    throw new RecheckStationRuntimeError(
      "The Recheck-station agent is disabled",
      "HBSS_RECHECK_STATION_AGENT_DISABLED",
    );
  }
  const config = readRecheckStationConfig(environment);
  const repository = new SqliteRecheckStationRepository(
    config.localPersistencePath,
    config.stationId,
    config.siteId,
  );
  const serialAdapter = serialAdapterFor(config.serialAdapterType, {
    binding: config.serialBinding,
    ...config.serialSettings,
  });
  const barcodeAdapter = new SimulatedBarcodeInputAdapter();
  const agent = new RecheckStationAgent({
    config,
    serialAdapter,
    barcodeAdapter,
    repository,
    centralClient: {
      async findByExactTag(barcode) {
        const recheckCase = await recheckService.caseByTag(barcode);
        return {
          bagId: recheckCase.bag.id,
          bhsUid: recheckCase.bag.bhsUid,
          rfidTagBarcode: recheckCase.bag.rfidTagBarcode,
          status: recheckCase.bag.status,
        };
      },
    },
  });
  try {
    await agent.start();
  } catch (error) {
    repository.close();
    throw error;
  }
  return {
    agent,
    serialAdapter,
    simulation: serialAdapter instanceof VirtualHbssSerialAdapter,
    transmittedFrames() {
      return serialAdapter instanceof VirtualHbssSerialAdapter
        ? serialAdapter.sink.map((frame) => Uint8Array.from(frame))
        : [];
    },
    async shutdown() {
      await agent.stop();
      repository.close();
    },
  };
}

const runtimeState = globalThis as typeof globalThis & {
  __sbtsRecheckStationRuntime?: Promise<RecheckStationRuntime>;
};

export function getRecheckStationRuntime() {
  runtimeState.__sbtsRecheckStationRuntime ??= createRecheckStationRuntime();
  return runtimeState.__sbtsRecheckStationRuntime;
}
