import "@tanstack/react-start/server-only";

import { resolve } from "node:path";
import { z } from "zod";

import { BhsBagMessageV1Schema } from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.schemas";
import { sanitizeScenarioExport } from "./integrationHarnessSecurity";
import {
  taggingStationConfigSchema,
  recheckStationConfigSchema,
  HBSS_SERIAL_SETTINGS,
} from "./stationConfig";
import { BhsPlcSimulator } from "./bhs/bhsPlcSimulator";
import { SimulatedBhsStationTransport } from "./bhs/bhsStationTransport";
import {
  SqliteStationInboxRepository,
  type StationInboxRepository,
} from "./bhs/stationInboxRepository.server";
import { DefaultTaggingStationAgent } from "./bhs/taggingStationAgent.server";
import { SimulatedBarcodeInputAdapter } from "./hbss/barcodeInputAdapter";
import { VirtualHbssSerialAdapter } from "./hbss/hbssSerialAdapter";
import { RecheckStationAgent } from "./hbss/recheckStationAgent.server";
import { SqliteRecheckStationRepository } from "./hbss/recheckStationRepository.server";

export const softwareFatActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("BHS_SEND"),
      message: BhsBagMessageV1Schema,
      repeat: z.number().int().min(1).max(100).default(1),
    })
    .strict(),
  z.object({ action: z.literal("BHS_DISCONNECT") }).strict(),
  z.object({ action: z.literal("BHS_RECONNECT") }).strict(),
  z.object({ action: z.literal("BHS_FAIL_ACK"), enabled: z.boolean() }).strict(),
  z
    .object({ action: z.literal("BHS_ACK_DELAY"), delayMs: z.number().int().min(0).max(5000) })
    .strict(),
  z
    .object({
      action: z.literal("BHS_CENTRAL_FAULT"),
      fault: z.enum([
        "NONE",
        "UNAVAILABLE",
        "AUTHENTICATION",
        "RESPONSE_LOST_AFTER_COMMIT",
        "SLOW_RESPONSE",
      ]),
    })
    .strict(),
  z.object({ action: z.literal("BHS_DATABASE_FAULT"), enabled: z.boolean() }).strict(),
  z.object({ action: z.literal("BHS_RESTART") }).strict(),
  z.object({ action: z.literal("BHS_RETRY_SYNC") }).strict(),
  z
    .object({ action: z.literal("BHS_JAM_ACTIVE"), reason: z.string().trim().min(3).max(128) })
    .strict(),
  z
    .object({
      action: z.literal("BHS_CLEAR_JAM"),
      reason: z.string().trim().min(3).max(128),
      actorId: z.string().trim().min(1).max(128),
    })
    .strict(),
  z
    .object({
      action: z.literal("HBSS_SCAN"),
      requestId: z.string().min(1).max(128),
      barcode: z.string().min(1).max(128),
      bhsUid: z.string().length(10),
      expectedBhsUid: z.string().length(10).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("HBSS_FAULT"),
      fault: z.enum(["NONE", "PORT_UNAVAILABLE", "PARTIAL_WRITE", "TIMEOUT", "CORRUPTED_BYTES"]),
    })
    .strict(),
  z.object({ action: z.literal("HBSS_RESTART") }).strict(),
  z.object({ action: z.literal("RESET") }).strict(),
]);
export type SoftwareFatAction = z.infer<typeof softwareFatActionSchema>;

type CentralFault =
  | "NONE"
  | "UNAVAILABLE"
  | "AUTHENTICATION"
  | "RESPONSE_LOST_AFTER_COMMIT"
  | "SLOW_RESPONSE";

export class SoftwareFatHarness {
  private bhsRepository!: SqliteStationInboxRepository;
  private bhsTransport!: SimulatedBhsStationTransport;
  private bhsAgent!: DefaultTaggingStationAgent;
  private bhsSimulator!: BhsPlcSimulator;
  private recheckRepository!: SqliteRecheckStationRepository;
  private serial!: VirtualHbssSerialAdapter;
  private barcode!: SimulatedBarcodeInputAdapter;
  private recheckAgent!: RecheckStationAgent;
  private centralFault: CentralFault = "NONE";
  private databaseUnavailable = false;
  private readonly centralFingerprints = new Set<string>();
  private lookup = { barcode: "RFID-SIM-0001", bhsUid: "0012345678" };

  private constructor(private readonly databasePath: string) {}

  static async create(databasePath: string) {
    const resolvedPath = resolve(databasePath);
    if (!/(simulation|software-fat|station-fat|station-host-smoke)/i.test(resolvedPath)) {
      throw new Error("SIMULATION_DATA_PATH_REQUIRED");
    }
    const harness = new SoftwareFatHarness(resolvedPath);
    await harness.startBhs();
    await harness.startHbss();
    return harness;
  }

  private async startBhs() {
    const config = taggingStationConfigSchema.parse({
      stationId: "SIM-TAG-STATION-01",
      siteId: "ALWAJH",
      allowedLineIds: ["01"],
      centralServerUrl: "http://simulation.invalid",
      centralSourceSystem: "SOFTWARE_FAT_BHS",
      transportType: "SIMULATED",
      acknowledgementEnabled: true,
      acknowledgementReceivedValue: 1,
      acknowledgementMappingStatus: "PENDING_VENDOR_CONFIRMATION",
      acknowledgeQueueCapacityReached: false,
      physicalMappingStatus: "SIMULATED",
      localPersistencePath: this.databasePath,
      retentionDays: 90,
    });
    this.bhsRepository = new SqliteStationInboxRepository(
      this.databasePath,
      config.stationId,
      config.siteId,
    );
    const repository = new Proxy(this.bhsRepository, {
      get: (target, property) => {
        if (property === "saveInboundMessage" && this.databaseUnavailable) {
          return async () => {
            throw new Error("SIMULATED_DATABASE_UNAVAILABLE");
          };
        }
        const candidate = Reflect.get(target, property);
        return typeof candidate === "function" ? candidate.bind(target) : candidate;
      },
    }) as StationInboxRepository;
    this.bhsTransport = new SimulatedBhsStationTransport();
    this.bhsAgent = new DefaultTaggingStationAgent({
      config,
      transport: this.bhsTransport,
      repository,
      centralClient: {
        ingest: async (message) => {
          const fingerprint = `${message.lineId}:${message.bhsUid}:${message.evaluation}`;
          if (this.centralFault === "UNAVAILABLE") throw new Error("SIMULATED_CENTRAL_UNAVAILABLE");
          if (this.centralFault === "AUTHENTICATION")
            throw new Error("SIMULATED_CENTRAL_AUTHENTICATION_FAILURE");
          if (this.centralFault === "SLOW_RESPONSE") {
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 1500));
          }
          if (this.centralFingerprints.has(fingerprint))
            return { outcome: "DUPLICATE", bagId: `SIM-${message.bhsUid}` };
          this.centralFingerprints.add(fingerprint);
          if (this.centralFault === "RESPONSE_LOST_AFTER_COMMIT")
            throw new Error("SIMULATED_RESPONSE_LOST_AFTER_COMMIT");
          return { outcome: "ACCEPTED", bagId: `SIM-${message.bhsUid}` };
        },
      },
    });
    this.bhsSimulator = new BhsPlcSimulator(this.bhsTransport);
    await this.bhsAgent.start();
  }

  private async startHbss() {
    const config = recheckStationConfigSchema.parse({
      stationId: "SIM-RECHECK-STATION-01",
      siteId: "ALWAJH",
      serialBinding: "VIRTUAL-HBSS-FAT",
      serialAdapterType: "VIRTUAL",
      framingProfile: "STX_BAGID_CRLF",
      framingMappingStatus: "PENDING_VENDOR_CONFIRMATION",
      localPersistencePath: this.databasePath,
      errorDialogTimeoutMs: 5000,
      duplicateScanDebounceMs: 0,
      serialSettings: HBSS_SERIAL_SETTINGS,
    });
    this.recheckRepository = new SqliteRecheckStationRepository(
      this.databasePath,
      config.stationId,
      config.siteId,
    );
    this.serial = new VirtualHbssSerialAdapter({
      binding: config.serialBinding,
      ...config.serialSettings,
    });
    this.barcode = new SimulatedBarcodeInputAdapter();
    this.recheckAgent = new RecheckStationAgent({
      config,
      serialAdapter: this.serial,
      barcodeAdapter: this.barcode,
      repository: this.recheckRepository,
      centralClient: {
        findByExactTag: async (barcode) =>
          barcode === this.lookup.barcode
            ? {
                bagId: `SIM-${this.lookup.bhsUid}`,
                bhsUid: this.lookup.bhsUid,
                rfidTagBarcode: barcode,
                status: "AT_RECHECK",
                assignedRecheckStationId: config.stationId,
              }
            : null,
      },
    });
    await this.recheckAgent.start();
  }

  async execute(actionInput: SoftwareFatAction) {
    const action = softwareFatActionSchema.parse(actionInput);
    if (action.action === "BHS_SEND") {
      await this.bhsSimulator.send(action.message, { burstCount: action.repeat });
    } else if (action.action === "BHS_DISCONNECT") {
      this.bhsSimulator.disconnect();
      await this.bhsRepository.recordSimulationFault(
        action.action,
        "Simulated BHS transport disconnect",
      );
    } else if (action.action === "BHS_RECONNECT") {
      this.bhsSimulator.reconnect();
      await this.bhsAgent.retryAcknowledgements();
      await this.bhsRepository.recordSimulationFault(
        action.action,
        "Simulated BHS transport reconnect",
      );
    } else if (action.action === "BHS_FAIL_ACK") {
      this.bhsSimulator.failAcknowledgements(action.enabled);
      await this.bhsRepository.recordSimulationFault(action.action, `enabled=${action.enabled}`);
    } else if (action.action === "BHS_ACK_DELAY") {
      this.bhsTransport.faults.acknowledgementDelayMs = action.delayMs;
      await this.bhsRepository.recordSimulationFault(action.action, `delayMs=${action.delayMs}`);
    } else if (action.action === "BHS_CENTRAL_FAULT") {
      this.centralFault = action.fault;
      await this.bhsRepository.recordSimulationFault(action.action, action.fault);
    } else if (action.action === "BHS_DATABASE_FAULT") {
      this.databaseUnavailable = action.enabled;
      await this.bhsRepository.recordSimulationFault(action.action, `enabled=${action.enabled}`);
    } else if (action.action === "BHS_RESTART") {
      await this.bhsAgent.stop();
      this.bhsRepository.close();
      await this.startBhs();
      await this.bhsRepository.recordSimulationFault(
        action.action,
        "Tagging station agent restarted",
      );
    } else if (action.action === "BHS_RETRY_SYNC") {
      await this.bhsAgent.retrySynchronization(null, {
        id: "SOFTWARE_FAT",
        permissions: new Set(["station.sync.retry"]),
      });
    } else if (action.action === "BHS_JAM_ACTIVE") {
      const active = (await this.bhsAgent.getQueue()).position1;
      if (!active) throw new Error("SIMULATION_ACTIVE_BAG_REQUIRED");
      await this.bhsRepository.jamActive(active.id, action.reason);
      await this.bhsRepository.recordSimulationFault(action.action, action.reason);
    } else if (action.action === "BHS_CLEAR_JAM") {
      const active = (await this.bhsAgent.getQueue()).position1;
      if (!active) throw new Error("SIMULATION_ACTIVE_BAG_REQUIRED");
      await this.bhsAgent.clearJammedBag(active.id, action.reason, {
        id: action.actorId,
        permissions: new Set(["station.jam.clear"]),
      });
      await this.bhsRepository.recordSimulationFault(action.action, action.reason);
    } else if (action.action === "HBSS_SCAN") {
      if (action.expectedBhsUid && action.expectedBhsUid !== action.bhsUid) {
        await this.bhsRepository.recordSimulationFault(
          "HBSS_WRONG_EXPECTED_BAGID",
          `expected=${action.expectedBhsUid};actual=${action.bhsUid}`,
        );
        throw new Error("HBSS_EXPECTED_BAGID_MISMATCH");
      }
      this.lookup = { barcode: action.barcode, bhsUid: action.bhsUid };
      await this.recheckAgent.requestRecall({
        requestId: action.requestId,
        barcode: action.barcode,
        actor: { id: "SOFTWARE_FAT", permissions: new Set(["bag.recheck"]) },
      });
    } else if (action.action === "HBSS_FAULT") {
      this.serial.reset();
      this.serial.faults.portUnavailable = action.fault === "PORT_UNAVAILABLE";
      this.serial.faults.partialWriteBytes = action.fault === "PARTIAL_WRITE" ? 4 : null;
      this.serial.faults.writeNeverCompletes = action.fault === "TIMEOUT";
      this.serial.faults.corruptBytes = action.fault === "CORRUPTED_BYTES";
      await this.bhsRepository.recordSimulationFault(action.action, action.fault);
    } else if (action.action === "HBSS_RESTART") {
      await this.recheckAgent.stop();
      this.recheckRepository.close();
      await this.startHbss();
      await this.bhsRepository.recordSimulationFault(
        action.action,
        "Recheck station agent restarted",
      );
    } else {
      this.serial.reset();
      this.bhsTransport.faults.acknowledgementWriteFails = false;
      this.bhsTransport.faults.acknowledgementDelayMs = 0;
      this.centralFault = "NONE";
      this.databaseUnavailable = false;
      this.centralFingerprints.clear();
      await this.bhsRepository.resetSimulationData();
      await this.recheckRepository.resetSimulationData();
    }
    return this.snapshot();
  }

  async snapshot() {
    const [bhsHealth, queue, hbssHealth, faults] = await Promise.all([
      this.bhsAgent.getHealth(),
      this.bhsAgent.getQueue(),
      this.recheckAgent.getHealth(),
      this.bhsRepository.listSimulationFaults(),
    ]);
    return sanitizeScenarioExport({
      simulation: true,
      generatedAt: new Date().toISOString(),
      bhs: { health: bhsHealth, queue },
      hbss: {
        health: hbssHealth,
        transmittedBytesHex: this.serial.sink.map((bytes) => Buffer.from(bytes).toString("hex")),
      },
      injectedFaults: faults,
    });
  }

  async shutdown() {
    await this.bhsAgent.stop();
    await this.recheckAgent.stop();
    this.bhsRepository.close();
    this.recheckRepository.close();
  }
}

const harnessState = globalThis as typeof globalThis & {
  __sbtsSoftwareFatHarness?: Promise<SoftwareFatHarness>;
};

export function getSoftwareFatHarness() {
  harnessState.__sbtsSoftwareFatHarness ??= SoftwareFatHarness.create(
    process.env.STATION_FAULT_CONSOLE_DB_PATH ?? "./var/simulation/station-fat.sqlite",
  );
  return harnessState.__sbtsSoftwareFatHarness;
}
