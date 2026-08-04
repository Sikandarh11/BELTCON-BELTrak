import { createMockAuthenticatedSession, createTestUser } from "../fixtures/userFixtures.mjs";

export function createAuthenticatedRequest(
  url = "http://localhost/api/test",
  { method = "GET", body, headers = {}, token = "p1-test-access-token" } = {},
) {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("cookie", `etb_auth_token=${encodeURIComponent(token)}`);
  requestHeaders.set("x-request-id", requestHeaders.get("x-request-id") ?? "request-p1-001");
  if (body !== undefined && !requestHeaders.has("content-type")) {
    requestHeaders.set("content-type", "application/json");
  }

  return new Request(url, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

export function createMockSessionLookup(user = createTestUser(), sessionOverrides = {}) {
  const session = createMockAuthenticatedSession(user, sessionOverrides);
  const lookup = async () => structuredClone(session);
  lookup.session = session;
  return lookup;
}
