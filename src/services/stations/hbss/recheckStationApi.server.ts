import "@tanstack/react-start/server-only";

import { z } from "zod";

import type { PermissionCode } from "@/services/admin/roles/roleSchemas";
import { getSessionFromRequest } from "@/services/authRepository.server";
import {
  PermissionAuthorizationError,
  requirePermission,
} from "@/services/authorization/permissionAuthorization.server";
import { sanitizeIntegrationError } from "../integrationHarnessSecurity";
import {
  getRecheckStationRuntime,
  type RecheckStationRuntime,
} from "./recheckStationRuntime.server";

const actionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("REQUEST_RECALL"),
      requestId: z.string().uuid(),
      barcode: z.string().min(1).max(128),
    })
    .strict(),
  z.object({ action: z.literal("RETRY"), requestId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("CANCEL"), requestId: z.string().uuid() }).strict(),
]);

export interface RecheckStationApiOptions {
  getSession?: typeof getSessionFromRequest;
  requirePermission?: typeof requirePermission;
  getRuntime?: () => Promise<RecheckStationRuntime>;
}

const headers = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

async function authorize(
  request: Request,
  options: RecheckStationApiOptions,
  permission: PermissionCode,
) {
  const session = await (options.getSession ?? getSessionFromRequest)(request);
  if (!session) return { session: null, response: json({ error: "Authentication required" }, 401) };
  try {
    await (options.requirePermission ?? requirePermission)(session, permission);
    return { session, response: null };
  } catch (error) {
    const status = error instanceof PermissionAuthorizationError ? error.status : 500;
    return {
      session: null,
      response: json(
        {
          error:
            status === 403 ? `Permission ${permission} is required` : "Permission check failed",
        },
        status,
      ),
    };
  }
}

async function view(runtime: RecheckStationRuntime) {
  return {
    health: await runtime.agent.getHealth(),
    simulation: runtime.simulation,
    transmittedFramesHex: runtime
      .transmittedFrames()
      .map((frame) => Buffer.from(frame).toString("hex")),
  };
}

export async function handleRecheckStationAgentRequest(
  request: Request,
  options: RecheckStationApiOptions = {},
) {
  const authorization = await authorize(request, options, "bag.recheck");
  if (authorization.response || !authorization.session) return authorization.response;
  try {
    const runtime = await (options.getRuntime ?? getRecheckStationRuntime)();
    if (request.method === "GET") return json(await view(runtime));
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) return json({ error: "Invalid Recheck-station action" }, 400);
    const actorId = authorization.session.user.id;
    if (parsed.data.action === "REQUEST_RECALL") {
      await runtime.agent.requestRecall({
        requestId: parsed.data.requestId,
        barcode: parsed.data.barcode,
        rawBarcode: parsed.data.barcode,
        actor: { id: actorId, permissions: new Set(["bag.recheck"]) },
      });
    } else if (parsed.data.action === "CANCEL") {
      await runtime.agent.cancel(parsed.data.requestId, {
        id: actorId,
        permissions: new Set(["bag.recheck"]),
      });
    } else {
      const elevated = await authorize(request, options, "bag.manage");
      if (elevated.response) return elevated.response;
      await runtime.agent.retry(parsed.data.requestId, {
        id: actorId,
        permissions: new Set(["station.recall.retry"]),
      });
    }
    return json(await view(runtime));
  } catch (error) {
    return json(
      { error: "Recheck-station agent request failed", code: sanitizeIntegrationError(error) },
      503,
    );
  }
}
