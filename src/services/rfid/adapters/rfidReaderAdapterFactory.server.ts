import "@tanstack/react-start/server-only";

import type {
  RfidAdapterType,
  RfidReaderAdapter,
} from "../rfidReaderAdapter";
import { SimulatedRfidReaderAdapter } from "./simulatedRfidReaderAdapter.server";
import { UnavailablePhysicalRfidReaderAdapter } from "./unavailablePhysicalRfidReaderAdapter.server";

export interface ReaderAdapterConfiguration {
  readerId: string;
  adapterType: RfidAdapterType;
  enabled: boolean;
}

export interface ReaderAdapterFactoryOptions {
  simulatorEnabled: boolean;
  clock?: () => Date;
  idFactory?: () => string;
}

export function createRfidReaderAdapter(
  configuration: ReaderAdapterConfiguration,
  options: ReaderAdapterFactoryOptions,
): RfidReaderAdapter {
  if (!configuration.enabled) {
    return new UnavailablePhysicalRfidReaderAdapter({
      readerId: configuration.readerId,
      adapterType:
        configuration.adapterType === "SIMULATED"
          ? "UNAVAILABLE_PHYSICAL"
          : configuration.adapterType,
      disabled: true,
    });
  }

  if (configuration.adapterType === "SIMULATED") {
    if (!options.simulatorEnabled) {
      return new UnavailablePhysicalRfidReaderAdapter({
        readerId: configuration.readerId,
        adapterType: "UNAVAILABLE_PHYSICAL",
        reason: "RFID_SIMULATOR_DISABLED",
      });
    }

    return new SimulatedRfidReaderAdapter({
      readerId: configuration.readerId,
      clock: options.clock,
      idFactory: options.idFactory,
    });
  }

  return new UnavailablePhysicalRfidReaderAdapter({
    readerId: configuration.readerId,
    adapterType: configuration.adapterType,
  });
}