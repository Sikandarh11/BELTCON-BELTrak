import "@tanstack/react-start/server-only";

import { z } from "zod";

import type { PermissionCode } from "@/services/admin/roles/roleSchemas";
import { getSessionFromRequest } from "@/services/authRepository.server";
import {
  PermissionAuthorizationError,
  requirePermission,
} from "@/services/authorization/permissionAuthorization.server";
import { taggingService, type TaggingService } from "@/services/bags/taggingService.server";
import { sanitizeIntegrationError } from "../integrationHarnessSecurity";
import {
  getTaggingStationRuntime,
  type TaggingStationRuntime,
} from "./taggingStationRuntime.server";

const requestId = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const sessionMutation = {
  sessionId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  requestId,
};
const actionSchema = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("START_SESSION"), queueItemId: z.string().uuid(), requestId })
    .strict(),
  z.object({ action: z.literal("RESUME_SESSION"), sessionId: z.string().uuid() }).strict(),
  z
    .object({
      action: z.literal("CAPTURE_TAG"),
      ...sessionMutation,
      barcode: z.string().max(256),
      expectedEpc: z.string().max(256).nullable().optional(),
      inputKind: z.enum(["SCANNER", "MANUAL"]),
      reason: z.string().trim().min(3).max(512).nullable().optional(),
    })
    .strict(),
  z.object({ action: z.literal("RESERVE_EPC"), ...sessionMutation }).strict(),
  z
    .object({
      action: z.literal("ENCODE"),
      ...sessionMutation,
      labelTemplateId: z.string().trim().min(1).max(64).nullable().optional(),
    })
    .strict(),
  z.object({ action: z.literal("VERIFY"), ...sessionMutation }).strict(),
  z
    .object({
      action: z.literal("UPDATE_LPC"),
      ...sessionMutation,
      iataLpc: z.string().max(32).nullable().optional(),
    })
    .strict(),
  z.object({ action: z.literal("CAPTURE_PHOTO"), ...sessionMutation }).strict(),
  z
    .object({
      action: z.literal("REPLACE_PHOTO"),
      ...sessionMutation,
      reason: z.string().trim().min(3).max(512),
    })
    .strict(),
  z
    .object({
      action: z.literal("OVERRIDE_PHOTO"),
      ...sessionMutation,
      reason: z.string().trim().min(3).max(512),
    })
    .strict(),
  z
    .object({ action: z.literal("COMMIT"), ...sessionMutation, queueItemId: z.string().uuid() })
    .strict(),
  z
    .object({
      action: z.literal("CANCEL_SESSION"),
      ...sessionMutation,
      reason: z.string().trim().min(3).max(512),
    })
    .strict(),
  z
    .object({
      action: z.literal("RETRY_SESSION"),
      ...sessionMutation,
      reason: z.string().trim().min(3).max(512),
    })
    .strict(),
  z
    .object({
      action: z.literal("REQUEST_REPLACEMENT"),
      assignmentId: z.string().uuid(),
      reason: z.string().trim().min(3).max(512),
      requestId,
    })
    .strict(),
  z.object({ action: z.literal("DEVICE_HEALTH") }).strict(),
  z
    .object({
      action: z.literal("CLEAR_JAM"),
      queueItemId: z.string().uuid(),
      reason: z.string().trim().min(3).max(256),
    })
    .strict(),
  z.object({ action: z.literal("RETRY_SYNCHRONIZATION") }).strict(),
]);

type StationAction = z.infer<typeof actionSchema>;
type SessionLookup = typeof getSessionFromRequest;
export interface TaggingStationApiOptions {
  getSession?: SessionLookup;
  requirePermission?: typeof requirePermission;
  getRuntime?: () => Promise<TaggingStationRuntime>;
  service?: TaggingService;
}

const headers = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

async function authorize(
  request: Request,
  options: TaggingStationApiOptions,
  permission: PermissionCode,
) {
  const session = await (options.getSession ?? getSessionFromRequest)(request);
  if (!session) {
    return {
      session: null,
      response: json({ error: "Authentication required", code: "STATION_UNAUTHENTICATED" }, 401),
    };
  }
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
          code: status === 403 ? "STATION_UNAUTHORIZED" : "STATION_AUTHORIZATION_FAILED",
        },
        status,
      ),
    };
  }
}

const permissionForAction: Record<StationAction["action"], PermissionCode> = {
  START_SESSION: "tagging.session.start",
  RESUME_SESSION: "tagging.view.history",
  CAPTURE_TAG: "tagging.tag.capture",
  RESERVE_EPC: "tagging.encode",
  ENCODE: "tagging.encode",
  VERIFY: "tagging.verify",
  UPDATE_LPC: "tagging.tag.capture",
  CAPTURE_PHOTO: "tagging.photo.capture",
  REPLACE_PHOTO: "tagging.override.photo",
  OVERRIDE_PHOTO: "tagging.override.photo",
  COMMIT: "tagging.commit",
  CANCEL_SESSION: "tagging.cancel",
  RETRY_SESSION: "tagging.tag.capture",
  REQUEST_REPLACEMENT: "tagging.replace",
  DEVICE_HEALTH: "tagging.view.history",
  CLEAR_JAM: "bag.manage",
  RETRY_SYNCHRONIZATION: "bag.manage",
};

async function view(runtime: TaggingStationRuntime, service: TaggingService, actorId: string) {
  const [health, queue, devices] = await Promise.all([
    runtime.agent.getHealth(),
    runtime.agent.getQueue(),
    service.getDeviceHealth(),
  ]);
  const centralSessionId = queue.position1?.centralTaggingSessionId ?? null;
  const workflow = centralSessionId
    ? await service.getSession({ sessionId: centralSessionId, actorId })
    : null;
  return { health, queue, simulation: runtime.simulation, devices, workflow };
}

function stationActor(id: string, elevated = false) {
  return {
    id,
    permissions: new Set([
      "bag.tag" as const,
      ...(elevated ? (["station.jam.clear", "station.sync.retry"] as const) : []),
    ]),
  };
}

async function parseAction(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 65_536)
    return {
      response: json({ error: "Request body is too large", code: "STATION_BODY_TOO_LARGE" }, 413),
    };
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return {
      response: json({ error: "Invalid request body", code: "STATION_ACTION_INVALID" }, 400),
    };
  }
  if (raw.length > 65_536)
    return {
      response: json({ error: "Request body is too large", code: "STATION_BODY_TOO_LARGE" }, 413),
    };
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return {
      response: json({ error: "Invalid station action", code: "STATION_ACTION_INVALID" }, 400),
    };
  }
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success)
    return {
      response: json({ error: "Invalid station action", code: "STATION_ACTION_INVALID" }, 400),
    };
  return { action: parsed.data, response: null };
}

export async function handleTaggingStationAgentRequest(
  request: Request,
  options: TaggingStationApiOptions = {},
) {
  const readAuthorization = await authorize(request, options, "bag.tag");
  if (readAuthorization.response || !readAuthorization.session) return readAuthorization.response;
  try {
    const runtime = await (options.getRuntime ?? getTaggingStationRuntime)();
    const service = options.service ?? taggingService;
    const user = readAuthorization.session.user;
    if (request.method === "GET") return json(await view(runtime, service, user.id));
    if (request.method !== "POST")
      return json({ error: "Method not allowed", code: "STATION_METHOD_NOT_ALLOWED" }, 405);
    const parsed = await parseAction(request);
    if (parsed.response || !parsed.action) return parsed.response;
    const action = parsed.action;
    const authorization = await authorize(request, options, permissionForAction[action.action]);
    if (authorization.response) return authorization.response;
    const actor = stationActor(
      user.id,
      action.action === "CLEAR_JAM" || action.action === "RETRY_SYNCHRONIZATION",
    );

    let result: unknown = null;
    if (action.action === "START_SESSION") {
      const before = await runtime.agent.getQueue();
      const item = before.position1;
      if (!item || item.id !== action.queueItemId) throw new Error("QUEUE_ITEM_NOT_ACTIVE");
      if (!["SYNCHRONIZED", "DUPLICATE_CONFIRMED"].includes(item.synchronizationStatus))
        throw new Error("OFFLINE_TAGGING_DISABLED");
      if (item.state === "ACTIVE") await runtime.agent.startTagging(item.id, actor);
      else if (item.state !== "TAGGING_IN_PROGRESS") throw new Error("QUEUE_ITEM_NOT_ACTIVE");
      const configured = await service.configureWorkflow(
        user.id,
        `${action.requestId}:configuration`,
      );
      if (configured.status !== "CONFIGURED") return json({ result: configured }, 409);
      const synchronized = await service.syncQueueItem({
        queueItemId: item.id,
        bhsUid: item.bhsUid,
        lineId: item.lineId,
        evaluation: item.evaluation as "R" | "T" | "N" | "?",
        position: 1,
        state: "TAGGING_IN_PROGRESS",
        localVersion: 1,
        receivedAt: item.receivedAt,
        requestId: `${action.requestId}:queue`,
      });
      if (synchronized.status !== "SYNCHRONIZED") return json({ result: synchronized }, 409);
      result = await service.createSession({
        queueItemId: item.id,
        actorId: user.id,
        actorRole: user.role,
        requestId: action.requestId,
      });
      const session = (result as Awaited<ReturnType<TaggingService["createSession"]>>).session;
      if (session) await runtime.agent.bindTaggingSession(item.id, session.id, actor);
    } else if (action.action === "RESUME_SESSION") {
      result = await service.getSession({ sessionId: action.sessionId, actorId: user.id });
    } else if (action.action === "CAPTURE_TAG") {
      if (action.inputKind === "MANUAL") {
        const manual = await authorize(request, options, "tagging.manual-entry");
        if (manual.response) return manual.response;
      }
      result = await service.captureIdentity({ ...action, actorId: user.id });
    } else if (action.action === "RESERVE_EPC") {
      result = await service.reserveEpc({ ...action, actorId: user.id });
    } else if (action.action === "ENCODE") {
      result = await service.encode({ ...action, actorId: user.id });
    } else if (action.action === "VERIFY") {
      result = await service.verify({ ...action, actorId: user.id });
    } else if (action.action === "UPDATE_LPC") {
      result = await service.updateIataLpc({ ...action, actorId: user.id });
    } else if (action.action === "CAPTURE_PHOTO") {
      result = await service.capturePhoto({ ...action, actorId: user.id, actorRole: user.role });
    } else if (action.action === "REPLACE_PHOTO") {
      result = await service.capturePhoto({
        ...action,
        actorId: user.id,
        actorRole: user.role,
        replacementReason: action.reason,
      });
    } else if (action.action === "OVERRIDE_PHOTO") {
      result = await service.overridePhoto({ ...action, actorId: user.id, actorRole: user.role });
    } else if (action.action === "COMMIT") {
      result = await service.commitSession({ ...action, actorId: user.id, actorRole: user.role });
      const committed = result as Awaited<ReturnType<TaggingService["commitSession"]>>;
      if (
        ["COMMITTED", "DUPLICATE"].includes(committed.status) &&
        committed.session &&
        committed.assignment
      ) {
        await runtime.agent.completeTagging(
          action.queueItemId,
          committed.session.id,
          committed.assignment.id,
          actor,
        );
      }
    } else if (action.action === "CANCEL_SESSION") {
      result = await service.cancelSession({ ...action, actorId: user.id });
    } else if (action.action === "RETRY_SESSION") {
      result = await service.retrySession({ ...action, actorId: user.id });
    } else if (action.action === "REQUEST_REPLACEMENT") {
      result = await service.requestReplacement({
        ...action,
        actorId: user.id,
        actorRole: user.role,
      });
    } else if (action.action === "DEVICE_HEALTH") {
      result = await service.getDeviceHealth();
    } else if (action.action === "CLEAR_JAM") {
      await runtime.agent.clearJammedBag(action.queueItemId, action.reason, actor);
    } else {
      await runtime.agent.retrySynchronization(null, actor);
    }
    return json({ result, ...(await view(runtime, service, user.id)) });
  } catch (error) {
    const code = sanitizeIntegrationError(error);
    const conflict = /(CONFLICT|NOT_ACTIVE|NOT_READY|VERSION|DISABLED|REQUIRED)/.test(code);
    return json({ error: "Tagging-station request failed", code }, conflict ? 409 : 503);
  }
}
