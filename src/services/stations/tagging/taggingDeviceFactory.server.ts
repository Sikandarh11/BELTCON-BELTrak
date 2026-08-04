import "@tanstack/react-start/server-only";

import type { TaggingStationConfig } from "../stationConfig";
import {
  FileUploadBagCameraAdapter,
  SimulatedBagCameraAdapter,
  UnavailablePhysicalBagCameraAdapter,
  type BagCameraAdapter,
} from "./bagCameraAdapter";
import {
  SimulatedBagPhotoStorage,
  UnavailableBagPhotoStorage,
  type BagPhotoStorage,
} from "./bagPhotoStorage";
import {
  SimulatedRfidEncoderAdapter,
  UnavailablePhysicalRfidEncoderAdapter,
  type RfidEncoderAdapter,
} from "./rfidEncoderAdapter";
import {
  KeyboardWedgeRfidTagInputAdapter,
  SimulatedRfidTagInputAdapter,
  PhysicalBarcodeScannerAdapter,
  type RfidTagInputAdapter,
} from "./rfidTagInputAdapter";
import {
  SimulatedRfidVerificationAdapter,
  UnavailablePhysicalRfidVerificationAdapter,
  type RfidVerificationAdapter,
} from "./rfidVerificationAdapter";

export interface TaggingDeviceSuite {
  tagInput: RfidTagInputAdapter;
  encoder: RfidEncoderAdapter;
  verifier: RfidVerificationAdapter;
  camera: BagCameraAdapter;
  photoStorage: BagPhotoStorage;
  simulated: boolean;
}

function assertSimulationAllowed(config: TaggingStationConfig, adapter: string) {
  if (!config.taggingSimulationEnabled) {
    throw new Error(`TAGGING_SIMULATOR_DISABLED:${adapter}`);
  }
}

/** Adapter selection is exclusively derived from validated process configuration. */
export function createTaggingDeviceSuite(config: TaggingStationConfig): TaggingDeviceSuite {
  const simulatedSelections = [
    config.rfidTagInputAdapter,
    config.rfidEncoderAdapter,
    config.rfidVerificationAdapter,
    config.bagCameraAdapter,
    config.bagPhotoStorageAdapter,
  ].filter((value) => value === "SIMULATED");
  if (simulatedSelections.length > 0) assertSimulationAllowed(config, "TRUSTED_CONFIGURATION");

  const tagInput =
    config.rfidTagInputAdapter === "SIMULATED"
      ? new SimulatedRfidTagInputAdapter()
      : config.rfidTagInputAdapter === "KEYBOARD_WEDGE"
        ? new KeyboardWedgeRfidTagInputAdapter()
        : new PhysicalBarcodeScannerAdapter();
  const encoder =
    config.rfidEncoderAdapter === "SIMULATED"
      ? new SimulatedRfidEncoderAdapter(config.rfidEncoderLogicalDeviceId)
      : new UnavailablePhysicalRfidEncoderAdapter(config.rfidEncoderLogicalDeviceId);
  const verifier =
    config.rfidVerificationAdapter === "SIMULATED"
      ? new SimulatedRfidVerificationAdapter(config.rfidVerifierLogicalDeviceId)
      : new UnavailablePhysicalRfidVerificationAdapter(config.rfidVerifierLogicalDeviceId);
  const camera =
    config.bagCameraAdapter === "SIMULATED"
      ? new SimulatedBagCameraAdapter(config.bagCameraLogicalDeviceId)
      : config.bagCameraAdapter === "DEVELOPMENT_FILE_UPLOAD"
        ? new FileUploadBagCameraAdapter(
            config.taggingSimulationEnabled,
            config.bagCameraLogicalDeviceId,
          )
        : new UnavailablePhysicalBagCameraAdapter(config.bagCameraLogicalDeviceId);
  const photoStorage =
    config.bagPhotoStorageAdapter === "SIMULATED"
      ? new SimulatedBagPhotoStorage()
      : new UnavailableBagPhotoStorage();

  return {
    tagInput,
    encoder,
    verifier,
    camera,
    photoStorage,
    simulated: simulatedSelections.length > 0,
  };
}
