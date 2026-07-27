import "@tanstack/react-start/server-only";

import type { HbssAdapter } from "@/services/integrations/hbss/hbssAdapter";
import { createHbssAdapter } from "@/services/integrations/hbss/hbssAdapterFactory.server";
import {
  HbssConfigurationError,
  HbssPayloadValidationError,
} from "@/services/integrations/hbss/hbssErrors";
import { parseHbssIngestionPayload } from "@/services/integrations/hbss/hbssSchemas";
import type { HbssIngestionPayload, XrayScan, XrayScanSelection } from "@/types/xray";
import { recordXrayAudit, type XrayAuditEvent } from "./xrayAudit.server";
import {
  xrayBagRepository,
  type XrayBagReference,
  type XrayBagRepository,
} from "./xrayBagRepository.server";
import {
  XrayAdapterError,
  XrayNotFoundError,
  XrayPersistenceError,
  XrayServiceError,
  XrayValidationError,
} from "./xrayErrors";
import { xrayRepository, type XrayRepository } from "./xrayRepository.server";
import { scanForDisplay } from "./xrayScanSelection";

export interface XrayService {
  getScanSelectionForBag(bagId: string): Promise<XrayScanSelection>;
  getScanForBag(bagId: string): Promise<XrayScan | null>;
  refreshScanForBag(bagId: string): Promise<XrayScan>;
  ingestScan(payload: HbssIngestionPayload): Promise<XrayScan>;
  getAdapterHealth(): Promise<{
    adapter: string;
    healthy: boolean;
    status: "CONNECTED" | "SIMULATED" | "UNAVAILABLE";
    lastChecked: string;
    message: string;
  }>;
}

export interface XrayServiceDependencies {
  repository: XrayRepository;
  bagRepository: XrayBagRepository;
  adapterFactory: () => HbssAdapter;
  audit: (event: XrayAuditEvent) => void;
}

const defaultDependencies: XrayServiceDependencies = {
  repository: xrayRepository,
  bagRepository: xrayBagRepository,
  adapterFactory: createHbssAdapter,
  audit: recordXrayAudit,
};

function normalizeBagId(bagId: string) {
  const normalized = bagId.trim();
  if (!normalized || normalized.length > 128) {
    throw new XrayValidationError("A valid bag ID is required");
  }
  return normalized;
}

async function requireBagById(
  bagId: string,
  bagRepository: XrayBagRepository,
): Promise<XrayBagReference> {
  const bag = await bagRepository.findById(normalizeBagId(bagId));
  if (!bag) {
    throw new XrayNotFoundError("Bag not found");
  }
  return bag;
}

function adapterFailure(error: unknown) {
  if (error instanceof XrayServiceError) {
    return error;
  }

  if (error instanceof HbssConfigurationError) {
    return new XrayAdapterError("HBSS adapter is not configured", { cause: error });
  }

  if (error instanceof HbssPayloadValidationError) {
    return new XrayAdapterError("HBSS returned an invalid scan response", {
      cause: error,
    });
  }

  return new XrayAdapterError("Unable to retrieve the X-ray scan", { cause: error });
}

function configuredAdapterLabel() {
  const configured = process.env.HBSS_ADAPTER?.trim().toLowerCase();
  if (configured === "mock") {
    return "Mock";
  }
  if (configured === "smiths") {
    return "Smiths";
  }
  return "Unknown";
}

async function persistFailureWhenPractical(
  repository: XrayRepository,
  audit: XrayServiceDependencies["audit"],
  bag: XrayBagReference,
  bhsUid: string,
  error: unknown,
) {
  try {
    await repository.saveFailure(bag.id, bhsUid, error);
  } catch {
    audit({
      action: "XRAY_SCAN_RETRIEVAL_FAILED",
      bagId: bag.id,
      bhsUid,
      errorCode: "XRAY_FAILURE_PERSIST_FAILED",
    });
  }
}

export function createXrayService(overrides: Partial<XrayServiceDependencies> = {}): XrayService {
  const dependencies: XrayServiceDependencies = {
    ...defaultDependencies,
    ...overrides,
  };

  return {
    async getScanSelectionForBag(bagId) {
      const bag = await requireBagById(bagId, dependencies.bagRepository);
      return dependencies.repository.findSelectionByBagId(bag.id);
    },

    async getScanForBag(bagId) {
      const bag = await requireBagById(bagId, dependencies.bagRepository);
      return scanForDisplay(await dependencies.repository.findSelectionByBagId(bag.id));
    },

    async refreshScanForBag(bagId) {
      const bag = await requireBagById(bagId, dependencies.bagRepository);
      const bhsUid = bag.bhsUid?.trim();

      if (!bhsUid) {
        dependencies.audit({
          action: "XRAY_SCAN_RETRIEVAL_FAILED",
          bagId: bag.id,
          errorCode: "BAG_BHS_UID_MISSING",
        });
        throw new XrayValidationError("Bag has no BHS UID");
      }

      dependencies.audit({
        action: "XRAY_REFRESH_REQUESTED",
        bagId: bag.id,
        bhsUid,
      });

      let adapter: HbssAdapter;
      try {
        adapter = dependencies.adapterFactory();
      } catch (error) {
        const safeError = adapterFailure(error);
        await persistFailureWhenPractical(
          dependencies.repository,
          dependencies.audit,
          bag,
          bhsUid,
          safeError,
        );
        dependencies.audit({
          action: "XRAY_SCAN_RETRIEVAL_FAILED",
          bagId: bag.id,
          bhsUid,
          errorCode: safeError.code,
        });
        throw safeError;
      }

      let result;
      try {
        result = await adapter.getScanByBhsUid(bhsUid);
      } catch (error) {
        const safeError = adapterFailure(error);
        await persistFailureWhenPractical(
          dependencies.repository,
          dependencies.audit,
          bag,
          bhsUid,
          safeError,
        );
        dependencies.audit({
          action: "XRAY_SCAN_RETRIEVAL_FAILED",
          bagId: bag.id,
          bhsUid,
          errorCode: safeError.code,
        });
        throw safeError;
      }

      if (!result) {
        const safeError = new XrayAdapterError("HBSS returned no scan result");
        await persistFailureWhenPractical(
          dependencies.repository,
          dependencies.audit,
          bag,
          bhsUid,
          safeError,
        );
        dependencies.audit({
          action: "XRAY_SCAN_RETRIEVAL_FAILED",
          bagId: bag.id,
          bhsUid,
          errorCode: "HBSS_EMPTY_RESULT",
        });
        throw safeError;
      }

      let scan: XrayScan;
      try {
        scan = await dependencies.repository.upsertFromAdapterResult(bag.id, result);
      } catch (error) {
        const safeError =
          error instanceof XrayServiceError
            ? error
            : new XrayPersistenceError("Unable to store the X-ray scan", {
                cause: error,
              });
        await persistFailureWhenPractical(
          dependencies.repository,
          dependencies.audit,
          bag,
          bhsUid,
          safeError,
        );
        dependencies.audit({
          action: "XRAY_SCAN_RETRIEVAL_FAILED",
          bagId: bag.id,
          bhsUid,
          errorCode: safeError.code,
        });
        throw safeError;
      }

      dependencies.audit({
        action: "XRAY_SCAN_RECEIVED",
        bagId: bag.id,
        bhsUid,
        sourceSystem: scan.sourceSystem,
        status: scan.status,
      });

      if (scan.status === "NOT_FOUND") {
        const error = new XrayNotFoundError("No X-ray scan was found for this bag");
        dependencies.audit({
          action: "XRAY_SCAN_RETRIEVAL_FAILED",
          bagId: bag.id,
          bhsUid,
          errorCode: error.code,
        });
        throw error;
      }

      if (scan.status === "FAILED") {
        const error = new XrayAdapterError("HBSS reported a scan retrieval failure");
        dependencies.audit({
          action: "XRAY_SCAN_RETRIEVAL_FAILED",
          bagId: bag.id,
          bhsUid,
          errorCode: error.code,
        });
        throw error;
      }

      return scan;
    },

    async ingestScan(payload) {
      let validated: HbssIngestionPayload;
      try {
        validated = parseHbssIngestionPayload(payload);
      } catch (error) {
        throw new XrayValidationError("Invalid HBSS ingestion payload", {
          cause: error,
        });
      }

      const bag = await dependencies.bagRepository.findByBhsUid(validated.bhsUid);
      if (!bag) {
        throw new XrayNotFoundError("No bag matches the supplied BHS UID");
      }

      const scan = await dependencies.repository.upsertFromAdapterResult(bag.id, validated);
      dependencies.audit({
        action: "XRAY_SCAN_RECEIVED",
        bagId: bag.id,
        bhsUid: validated.bhsUid,
        sourceSystem: scan.sourceSystem,
        status: scan.status,
      });
      return scan;
    },

    async getAdapterHealth() {
      const fallbackAdapter = configuredAdapterLabel();
      const lastChecked = new Date().toISOString();
      let adapter: HbssAdapter;

      try {
        adapter = dependencies.adapterFactory();
      } catch {
        return {
          adapter: fallbackAdapter,
          healthy: false,
          status: "UNAVAILABLE",
          lastChecked,
          message: "HBSS adapter is not configured",
        };
      }

      try {
        const health = await adapter.healthCheck();
        const simulated = adapter.name === "MOCK_HBSS";
        return {
          adapter: simulated ? "Mock" : fallbackAdapter,
          healthy: health.healthy,
          status: health.healthy ? (simulated ? "SIMULATED" : "CONNECTED") : "UNAVAILABLE",
          lastChecked,
          message: simulated
            ? "Mock HBSS adapter is ready; responses use static user-provided images"
            : health.healthy
              ? "HBSS adapter is connected"
              : "HBSS adapter is unavailable",
        };
      } catch {
        return {
          adapter: fallbackAdapter,
          healthy: false,
          status: "UNAVAILABLE",
          lastChecked,
          message: "HBSS adapter is unavailable",
        };
      }
    },
  };
}

export const xrayService = createXrayService();

export const getScanSelectionForBag = xrayService.getScanSelectionForBag;
export const getScanForBag = xrayService.getScanForBag;
export const refreshScanForBag = xrayService.refreshScanForBag;
export const ingestScan = xrayService.ingestScan;
export const getAdapterHealth = xrayService.getAdapterHealth;
