export const TAGGING_SESSION_STATES = [
  "CREATED",
  "VALIDATING_BAG",
  "READY_FOR_INPUT",
  "TAG_CAPTURED",
  "ENCODE_PENDING",
  "ENCODING",
  "ENCODED",
  "VERIFY_PENDING",
  "VERIFYING",
  "VERIFIED",
  "PHOTO_PENDING",
  "PHOTO_CAPTURED",
  "READY_TO_COMMIT",
  "COMMITTING",
  "COMMITTED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const;

export type TaggingSessionState = (typeof TAGGING_SESSION_STATES)[number];
export type TaggingProvisioningMode = "PRE_ENCODED_TAG" | "PRINT_AND_ENCODE";
export type BagPhotoPolicy = "REQUIRED" | "OPTIONAL" | "DISABLED";
export type TagInputKind = "SCANNER" | "MANUAL" | "SIMULATED";
export type TagVerificationResult =
  | "VERIFIED"
  | "NO_TAG"
  | "EPC_MISMATCH"
  | "MULTIPLE_TAGS"
  | "UNSTABLE_READ"
  | "DEVICE_UNAVAILABLE"
  | "TIMED_OUT"
  | "CANCELLED";

export interface TaggingSession {
  id: string;
  siteId: string;
  stationId: string;
  queueItemId: string;
  bagId: string;
  bhsUid: string;
  lineId: string;
  operatorId: string;
  operatorRole: string;
  state: TaggingSessionState;
  provisioningMode: TaggingProvisioningMode;
  configurationVersion: number;
  rfidTagBarcode: string | null;
  expectedEpc: string | null;
  verifiedEpc: string | null;
  iataLpc: string | null;
  photoPolicy: BagPhotoPolicy;
  photoStatus: "NOT_CAPTURED" | "STAGED" | "CAPTURED" | "MISSING_OVERRIDE" | "FAILED";
  photoOverrideReason: string | null;
  verificationRequired: boolean;
  requiredStableReadCount: number;
  failureCode: string | null;
  failureDetail: string | null;
  replacementOfAssignmentId: string | null;
  version: number;
  simulated: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  committedAt: string | null;
  cancelledAt: string | null;
}

export interface EpcReservation {
  id: string;
  sessionId: string;
  epc: string;
  status:
    | "RESERVED"
    | "ENCODING"
    | "ENCODED"
    | "VERIFIED"
    | "ASSIGNED"
    | "RELEASED"
    | "EXPIRED"
    | "FAILED"
    | "VOIDED";
  expiresAt: string;
  failureCode: string | null;
}

export interface TagProvisioningJob {
  id: string;
  sessionId: string;
  reservationId: string;
  logicalDeviceId: string;
  epc: string;
  status: "PENDING" | "ENCODING" | "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "CANCELLED" | "AMBIGUOUS";
  failureCode: string | null;
  retryCount: number;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface TagVerificationAttempt {
  id: string;
  sessionId: string;
  expectedEpc: string;
  observedEpcs: string[];
  stableReadCount: number;
  result: TagVerificationResult;
  failureCode: string | null;
  simulated: boolean;
  startedAt: string;
  completedAt: string;
}

export interface BagPhotoMetadata {
  id: string;
  bagId: string;
  bhsUid: string;
  taggingSessionId: string;
  siteId: string;
  stationId: string;
  capturedBy: string;
  capturedAt: string;
  originalMimeType: "image/jpeg" | "image/png";
  storedMimeType: "image/jpeg" | "image/png";
  width: number;
  height: number;
  fileSize: number;
  checksumSha256: string;
  status: "STAGED" | "ACTIVE" | "REPLACED" | "ABANDONED" | "FAILED";
  version: number;
  simulated: boolean;
}

export interface BagTagAssignment {
  id: string;
  bagId: string;
  tagId: string;
  assignmentVersion: number;
  assignmentStatus: "ACTIVE" | "REPLACED" | "ENDED";
  assignedAt: string;
  assignedBy: string;
  siteId: string;
  stationId: string;
  taggingSessionId: string | null;
  replacedAssignmentId: string | null;
  endedAt: string | null;
  endReason: string | null;
}

export interface TaggingWorkflowResult {
  status: string;
  errorCode?: string | null;
  session?: TaggingSession;
  reservation?: EpcReservation;
  job?: TagProvisioningJob;
  attempt?: TagVerificationAttempt;
  photo?: BagPhotoMetadata;
  assignment?: BagTagAssignment;
  bag?: unknown;
}

export interface TaggingDeviceHealth {
  state: "READY" | "STOPPED" | "DEGRADED" | "UNAVAILABLE" | "MISCONFIGURED";
  code: string | null;
  logicalDeviceId: string;
  simulated: boolean;
  detail?: string;
}
