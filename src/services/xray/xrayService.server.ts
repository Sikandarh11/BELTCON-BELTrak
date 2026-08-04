import "@tanstack/react-start/server-only";

import type { HbssAdapter } from "@/services/integrations/hbss/hbssAdapter";
import { createHbssAdapter } from "@/services/integrations/hbss/hbssAdapterFactory.server";
import {
  HbssConfigurationError,
  HbssPayloadValidationError,
} from "@/services/integrations/hbss/hbssErrors";
import {
  parseBhsUid,
  parseHbssIngestionPayload,
  parseHbssScanResult,
} from "@/services/integrations/hbss/hbssSchemas";
import type { HbssIngestionPayload, XrayScan, XrayScanSelection } from "@/types/xray";
import { recordXrayAudit, type XrayAuditEvent } from "./xrayAudit.server";
import {
  xrayBagRepository,
  type XrayBagReference,
  type XrayBagRepository,
} from "./xrayBagRepository.server";
import {
  BhsUidRequiredError,
  HbssBhsUidMismatchError,
  HbssRequestTimedOutError,
  XrayAdapterError,
  XrayConflictError,
  XrayNotFoundError,
  XrayPersistenceError,
  XrayServiceError,
  XrayValidationError,
  XrayRequestCancelledError,
} from "./xrayErrors";
import { xrayRepository, type XrayRepository } from "./xrayRepository.server";
import { scanForDisplay } from "./xrayScanSelection";

export interface XrayService {
  getScanSelectionForBag(bagId: string): Promise<XrayScanSelection>;
  getScanForBag(bagId: string): Promise<XrayScan | null>;
  refreshScanForBag(bagId: string, options?: { signal?: AbortSignal }): Promise<XrayScan>;
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
  audit: (event: XrayAuditEvent) => void | Promise<void>;
  requestTimeoutMs: () => number;
}

const defaultDependencies: XrayServiceDependencies = {
  repository: xrayRepository,
  bagRepository: xrayBagRepository,
  adapterFactory: createHbssAdapter,
  audit: recordXrayAudit,
  requestTimeoutMs: resolveHbssRequestTimeoutMs,
};

const DEFAULT_HBSS_REQUEST_TIMEOUT_MS = 10_000;
const MIN_HBSS_REQUEST_TIMEOUT_MS = 100;
const MAX_HBSS_REQUEST_TIMEOUT_MS = 120_000;

export function resolveHbssRequestTimeoutMs(
  configured = process.env.HBSS_REQUEST_TIMEOUT_MS,
): number {
  if (configured === undefined || configured.trim() === "") {
    return DEFAULT_HBSS_REQUEST_TIMEOUT_MS;
  }
  if (!/^\d+$/.test(configured.trim())) {
    throw new HbssConfigurationError("HBSS request timeout is invalid");
  }
  const timeoutMs = Number(configured);
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < MIN_HBSS_REQUEST_TIMEOUT_MS ||
    timeoutMs > MAX_HBSS_REQUEST_TIMEOUT_MS
  ) {
    throw new HbssConfigurationError("HBSS request timeout is outside the supported range");
  }
  return timeoutMs;
}

async function getScanWithTimeout(
  adapter: HbssAdapter,
  bhsUid: string,
  timeoutMs: number,
  requestSignal?: AbortSignal,
) {
  if (requestSignal?.aborted) {
    throw new XrayRequestCancelledError();
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let removeCancellationListener: (() => void) | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new HbssRequestTimedOutError();
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  const cancellation = new Promise<never>((_resolve, reject) => {
    if (!requestSignal) return;
    const cancel = () => {
      const error = new XrayRequestCancelledError();
      controller.abort(error);
      reject(error);
    };
    requestSignal.addEventListener("abort", cancel, { once: true });
    removeCancellationListener = () => requestSignal.removeEventListener("abort", cancel);
  });

  try {
    return await Promise.race([
      adapter.getScanByBhsUid(bhsUid, { signal: controller.signal }),
      timeout,
      cancellation,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    removeCancellationListener?.();
  }
}

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
  if (
    error instanceof HbssBhsUidMismatchError ||
    error instanceof HbssRequestTimedOutError ||
    error instanceof XrayRequestCancelledError ||
    error instanceof XrayConflictError
  ) {
    return;
  }
  try {
    await repository.saveFailure(bag.id, bhsUid, error);
  } catch {
    await audit({
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

    async refreshScanForBag(bagId, options) {
      const bag = await requireBagById(bagId, dependencies.bagRepository);
      let bhsUid: string;

      try {
        bhsUid = parseBhsUid(bag.bhsUid);
      } catch {
        await dependencies.audit({
          action: "XRAY_SCAN_RETRIEVAL_FAILED",
          bagId: bag.id,
          errorCode: "BAG_BHS_UID_MISSING",
        });
        throw new BhsUidRequiredError();
      }

      await dependencies.audit({
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
        await dependencies.audit({
          action: "XRAY_SCAN_RETRIEVAL_FAILED",
          bagId: bag.id,
          bhsUid,
          errorCode: safeError.code,
        });
        throw safeError;
      }

      let result;
      try {
        const timeoutMs = dependencies.requestTimeoutMs();
        const untrustedResult = await getScanWithTimeout(
          adapter,
          bhsUid,
          timeoutMs,
          options?.signal,
        );
        if (
          untrustedResult !== null &&
          (typeof untrustedResult !== "object" ||
            !("bhsUid" in untrustedResult) ||
            untrustedResult.bhsUid !== bhsUid)
        ) {
          throw new HbssBhsUidMismatchError();
        }
        result = untrustedResult === null ? null : parseHbssScanResult(untrustedResult);
      } catch (error) {
        const safeError = adapterFailure(error);
        await persistFailureWhenPractical(
          dependencies.repository,
          dependencies.audit,
          bag,
          bhsUid,
          safeError,
        );
        await dependencies.audit({
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
        await dependencies.audit({
          action: "XRAY_SCAN_RETRIEVAL_FAILED",
          bagId: bag.id,
          bhsUid,
          errorCode: "HBSS_EMPTY_RESULT",
        });
        throw safeError;
      }

      let scan: XrayScan;
      let duplicate = false;
      try {
        const persisted = await dependencies.repository.upsertFromAdapterResult(
          bag.id,
          bhsUid,
          result,
        );
        scan = persisted.scan;
        duplicate = persisted.disposition === "DUPLICATE";
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
        await dependencies.audit({
          action: "XRAY_SCAN_RETRIEVAL_FAILED",
          bagId: bag.id,
          bhsUid,
          errorCode: safeError.code,
        });
        throw safeError;
      }

      if (!duplicate) {
        await dependencies.audit({
          action: "XRAY_SCAN_RECEIVED",
          bagId: bag.id,
          bhsUid,
          sourceSystem: scan.sourceSystem,
          status: scan.status,
        });
      }

      if (scan.status === "NOT_FOUND") {
        const error = new XrayNotFoundError("No X-ray scan was found for this bag");
        await dependencies.audit({
          action: "XRAY_SCAN_RETRIEVAL_FAILED",
          bagId: bag.id,
          bhsUid,
          errorCode: error.code,
        });
        throw error;
      }

      if (scan.status === "FAILED") {
        const error = new XrayAdapterError("HBSS reported a scan retrieval failure");
        await dependencies.audit({
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

      let persisted;
      try {
        persisted = await dependencies.repository.upsertFromAdapterResult(
          bag.id,
          validated.bhsUid,
          validated,
        );
      } catch (error) {
        const safeError =
          error instanceof XrayServiceError
            ? error
            : new XrayPersistenceError("Unable to store the X-ray scan", { cause: error });
        await dependencies.audit({
          action: "XRAY_SCAN_RETRIEVAL_FAILED",
          bagId: bag.id,
          bhsUid: validated.bhsUid,
          errorCode: safeError.code,
        });
        throw safeError;
      }
      const scan = persisted.scan;
      if (persisted.disposition === "DUPLICATE") {
        return scan;
      }
      await dependencies.audit({
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
        dependencies.requestTimeoutMs();
      } catch {
        return {
          adapter: fallbackAdapter,
          healthy: false,
          status: "UNAVAILABLE",
          lastChecked,
          message: "HBSS request timeout configuration is invalid",
        };
      }

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
