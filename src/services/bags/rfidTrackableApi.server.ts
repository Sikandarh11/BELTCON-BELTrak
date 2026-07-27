import "@tanstack/react-start/server-only";

import { getSessionFromRequest } from "@/services/authRepository.server";
import { roleIsAtLeast } from "@/services/roles";
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

  if (!roleIsAtLeast(session.user.role, MINIMUM_RFID_SIMULATOR_ROLE)) {
    return jsonResponse(
      {
        error: "Canonical Operations Officer role or higher is required",
        code: "RFID_BAGS_FORBIDDEN",
      },
      403,
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
