import "@tanstack/react-start/server-only";
import { getSessionFromRequest } from "@/services/authRepository.server";
import {
  PermissionAuthorizationError,
  requirePermission,
} from "@/services/authorization/permissionAuthorization.server";
import { listReaderAntennaMap } from "./readerAntennaRepository.server";
const headers = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };
export async function handleReaderAntennaMapRequest(request: Request) {
  let session;
  try {
    session = await getSessionFromRequest(request);
  } catch {
    return new Response(
      JSON.stringify({ error: "Unable to verify session", code: "READER_MAP_SESSION_ERROR" }),
      { status: 500, headers },
    );
  }
  if (!session)
    return new Response(
      JSON.stringify({
        error: "An authenticated session is required",
        code: "READER_MAP_UNAUTHORIZED",
      }),
      { status: 401, headers },
    );
  try {
    await requirePermission(session, "reader.view");
    const mappings = await listReaderAntennaMap();
    return new Response(JSON.stringify({ mappings }), { headers });
  } catch (error) {
    const status = error instanceof PermissionAuthorizationError ? error.status : 500;
    return new Response(
      JSON.stringify({
        error:
          status === 403 ? "Permission reader.view is required" : "Unable to load reader mappings",
        code: status === 403 ? "READER_MAP_FORBIDDEN" : "READER_MAP_FAILED",
      }),
      { status, headers },
    );
  }
}
