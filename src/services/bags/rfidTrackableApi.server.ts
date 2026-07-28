import "@tanstack/react-start/server-only";

import { roleIsAtLeast } from "@/auth/canonicalRoles";
import { getSessionFromRequest } from "@/services/authRepository.server";
import {
  PermissionAuthorizationError,
  requirePermission,
} from "@/services/authorization/permissionAuthorization.server";
import { listRfidTrackableBags } from "./rfidTrackableRepository.server";

const MINIMUM_RFID_SIMULATOR_ROLE = "Operations Officer";
const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

type SessionLookup = typeof getSessionFromRequest;
type BagLoader = typeof listRfidTrackableBags;

export interface RfidTrackableApiOptions {
  getSession?: SessionLookup;
  loadBags?: BagLoader;
  requirePermission?: typeof requirePermission;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

export async function handleRfidTrackableBagsRequest(
  request: Request,
  options: RfidTrackableApiOptions = {},
) {
  let session: Awaited<ReturnType<SessionLookup>>;
  try {
    session = await (options.getSession ?? getSessionFromRequest)(request);
  } catch {
    return jsonResponse(
      {
        error: "Unable to verify the authenticated session",
        code: "RFID_BAGS_INTERNAL_ERROR",
      },
      500,
    );
  }

  if (!session) {
    return jsonResponse(
      {
        error: "An authenticated session is required",
        code: "RFID_BAGS_UNAUTHORIZED",
      },
      401,
    );
  }

  try {
    if (options.requirePermission) {
      await options.requirePermission(session, "developer.access");
    } else if (options.getSession) {
      if (!roleIsAtLeast(session.user.role, MINIMUM_RFID_SIMULATOR_ROLE)) {
        throw new PermissionAuthorizationError("Permission denied", "PERMISSION_DENIED", 403);
      }
    } else {
      await requirePermission(session, "developer.access");
    }
  } catch (error) {
    const status = error instanceof PermissionAuthorizationError ? error.status : 500;
    return jsonResponse(
      {
        error:
          status === 403 ? "Permission developer.access is required" : "Permission check failed",
        code: status === 403 ? "RFID_BAGS_FORBIDDEN" : "RFID_BAGS_INTERNAL_ERROR",
      },
      status,
    );
  }

  try {
    const bags = await (options.loadBags ?? listRfidTrackableBags)();
    return jsonResponse({ bags });
  } catch {
    return jsonResponse(
      {
        error: "Unable to load RFID-trackable bags",
        code: "RFID_BAGS_INTERNAL_ERROR",
      },
      500,
    );
  }
}
