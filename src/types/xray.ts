export type XrayScanStatus = "PENDING" | "AVAILABLE" | "FAILED" | "NOT_FOUND" | "ARCHIVED";

export interface XrayImageView {
  id: string;
  label: string;
  url: string;
  mimeType: string;
}

export interface XrayScan {
  id: string;
  bagId: string | null;
  bhsUid: string;
  externalScanId: string | null;
  sourceSystem: string;
  status: XrayScanStatus;
  images: XrayImageView[];
  threatLevel: number | null;
  threatType: string | null;
  capturedAt: string | null;
  receivedAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface XrayScanSelection {
  displayScan: XrayScan | null;
  latestAttempt: XrayScan | null;
}

export interface HbssScanResult {
  externalScanId: string;
  bhsUid: string;
  sourceSystem: string;
  status: "AVAILABLE" | "PENDING" | "FAILED" | "NOT_FOUND";
  images: XrayImageView[];
  threatLevel?: number;
  threatType?: string;
  capturedAt?: string;
  metadata?: Record<string, unknown>;
}

export type HbssIngestionPayload = HbssScanResult;
