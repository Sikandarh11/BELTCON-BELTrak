import type { XrayScan } from "@/types/xray";

export type XrayDisplayStatus =
  | "Available"
  | "Pending"
  | "Missing"
  | "Failed"
  | "Archived"
  | "Not requested";

export function getXrayDisplayStatus(scan: XrayScan | null): XrayDisplayStatus {
  switch (scan?.status) {
    case "AVAILABLE":
      return "Available";
    case "PENDING":
      return "Pending";
    case "NOT_FOUND":
      return "Missing";
    case "FAILED":
      return "Failed";
    case "ARCHIVED":
      return "Archived";
    case undefined:
      return "Not requested";
  }
}
