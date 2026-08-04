import "@tanstack/react-start/server-only";

import { getSessionFromRequest } from "@/services/authRepository.server";
import { requirePermission } from "@/services/authorization/permissionAuthorization.server";
import { isSoftwareSimulatorEnabled } from "./integrationHarnessSecurity";
import {
  getSoftwareFatHarness,
  softwareFatActionSchema,
  type SoftwareFatHarness,
} from "./softwareFatHarness.server";

type SessionLookup = typeof getSessionFromRequest;
export interface StationFaultConsoleApiOptions {
  environment?: "development" | "test" | "production";
  enabled?: boolean;
  getSession?: SessionLookup;
  requirePermission?: typeof requirePermission;
  getHarness?: () => Promise<SoftwareFatHarness>;
}
const headers = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

export async function handleStationFaultConsoleRequest(
  request: Request,
  options: StationFaultConsoleApiOptions = {},
) {
  const environment =
    options.environment ??
    (process.env.NODE_ENV === "production"
      ? "production"
      : process.env.NODE_ENV === "test"
        ? "test"
        : "development");
  const enabled =
    options.enabled ?? process.env.FEATURE_STATION_FAULT_CONSOLE?.trim().toLowerCase() === "true";
  if (!isSoftwareSimulatorEnabled(environment, enabled)) {
    return json(
      { error: "Software FAT console is unavailable", code: "STATION_FAULT_CONSOLE_DISABLED" },
      403,
    );
  }
  const session = await (options.getSession ?? getSessionFromRequest)(request);
  if (!session)
    return json(
      { error: "Authentication required", code: "STATION_FAULT_CONSOLE_UNAUTHENTICATED" },
      401,
    );
  try {
    const enforce = options.requirePermission ?? requirePermission;
    await enforce(session, "developer.access");
    await enforce(session, "simulator.use");
  } catch {
    return json(
      {
        error: "Developer simulator permission is required",
        code: "STATION_FAULT_CONSOLE_FORBIDDEN",
      },
      403,
    );
  }
  try {
    const harness = await (options.getHarness ?? getSoftwareFatHarness)();
    if (request.method === "GET") return json(await harness.snapshot());
    if (request.method !== "POST")
      return json(
        { error: "Method not allowed", code: "STATION_FAULT_CONSOLE_METHOD_NOT_ALLOWED" },
        405,
      );
    const parsed = softwareFatActionSchema.safeParse(await request.json());
    if (!parsed.success)
      return json(
        { error: "Invalid software FAT action", code: "STATION_FAULT_ACTION_INVALID" },
        400,
      );
    return json(await harness.execute(parsed.data));
  } catch {
    return json({ error: "Software FAT action failed", code: "STATION_FAULT_ACTION_FAILED" }, 500);
  }
}
