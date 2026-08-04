import type { HbssRecallStatus } from "./recheckTypes";

const recallStatuses = new Set<HbssRecallStatus>([
  "PENDING",
  "REQUEST_SENT",
  "SIMULATED",
  "UNAVAILABLE",
  "FAILED",
  "TIMED_OUT",
  "CANCELLED",
]);

export function isHbssRecallStatus(value: unknown): value is HbssRecallStatus {
  return typeof value === "string" && recallStatuses.has(value as HbssRecallStatus);
}

export type HbssRecallPresentation = {
  stage:
    | "RECALL_PENDING"
    | "RECALL_REQUEST_SENT"
    | "RECALL_SIMULATED"
    | "RECALL_UNAVAILABLE"
    | "RECALL_TIMED_OUT"
    | "RECALL_CANCELLED"
    | "RECALL_FAILED";
  tone: "info" | "success" | "warning" | "danger";
  message: string;
};

export function getHbssRecallPresentation(status: HbssRecallStatus): HbssRecallPresentation {
  switch (status) {
    case "PENDING":
      return {
        stage: "RECALL_PENDING",
        tone: "info",
        message: "The HBSS recall request is pending. X-ray image availability is unchanged.",
      };
    case "REQUEST_SENT":
      return {
        stage: "RECALL_REQUEST_SENT",
        tone: "info",
        message:
          "The HBSS recall request bytes were sent. No acknowledgement or image retrieval is assumed.",
      };
    case "SIMULATED":
      return {
        stage: "RECALL_SIMULATED",
        tone: "info",
        message: "Simulated HBSS recall completed; no physical HBSS workstation was contacted.",
      };
    case "UNAVAILABLE":
      return {
        stage: "RECALL_UNAVAILABLE",
        tone: "warning",
        message:
          "HBSS recall is unavailable. Continue with the approved manual-inspection procedure.",
      };
    case "TIMED_OUT":
      return {
        stage: "RECALL_TIMED_OUT",
        tone: "warning",
        message: "HBSS recall timed out. No image retrieval is assumed.",
      };
    case "CANCELLED":
      return {
        stage: "RECALL_CANCELLED",
        tone: "warning",
        message: "HBSS recall was cancelled. No image retrieval is assumed.",
      };
    case "FAILED":
      return {
        stage: "RECALL_FAILED",
        tone: "danger",
        message: "HBSS recall failed. Continue with the approved manual-inspection procedure.",
      };
  }
}
