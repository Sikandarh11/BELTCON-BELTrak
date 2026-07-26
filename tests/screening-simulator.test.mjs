import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createServer } from "vite";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  root: repositoryRoot,
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true },
  resolve: {
    alias: {
      "@": path.join(repositoryRoot, "src"),
    },
  },
});

test.after(async () => {
  await vite.close();
});

const [schemaModule, imageSetModule, apiModule, serviceModule] = await Promise.all([
  vite.ssrLoadModule("/src/services/integrations/screening/screeningSchemas.ts"),
  vite.ssrLoadModule("/src/features/simulator/mockXraySets.ts"),
  vite.ssrLoadModule("/src/services/screening/screeningSimulatorApi.server.ts"),
  vite.ssrLoadModule("/src/services/screening/screeningIngestionService.server.ts"),
]);

const { screeningSimulatorInputSchema } = schemaModule;
const { MOCK_XRAY_SETS } = imageSetModule;
const { handleScreeningSimulatorRequest } = apiModule;
const { createScreeningIngestionService } = serviceModule;

const validSimulatorPayload = {
  eventId: "00000000-0000-4000-8000-000000000701",
  bhsUid: "BHS-SIM-000701",
  iataCode: "0123456701",
  iataOrigin: "RUH",
  flightNo: "SV701",
  passengerName: "Simulator Passenger",
  threatType: "ORGANIC_DENSITY",
  threatLevel: 4,
  screeningStation: "HBSS-SIM-01",
  screeningTimestamp: "2026-07-26T12:00:00.000Z",
  externalScanId: "SCAN-SIM-000701",
  scanStatus: "AVAILABLE",
  imageSetId: MOCK_XRAY_SETS[0]?.id ?? null,
  images: MOCK_XRAY_SETS[0]?.images.map((image) => ({ ...image })) ?? [],
};

function requestFor(payload) {
  return new Request("http://localhost/api/dev/simulator/suspect-events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": "simulator-test-request",
      "x-workspace-mode": "Developer",
    },
    body: JSON.stringify(payload),
  });
}

function sessionLookupFor(role) {
  return async () => ({
    token: "test-session-token",
    expiresAt: "2026-07-26T13:00:00.000Z",
    user: {
      id: "user-701",
      firstName: "Test",
      lastName: "User",
      email: "test@example.com",
      role,
      createdAt: "2026-07-26T10:00:00.000Z",
      lastLogin: null,
    },
  });
}

test("simulator form contract validates all required fields", () => {
  assert.equal(screeningSimulatorInputSchema.safeParse(validSimulatorPayload).success, true);

  const invalid = {
    ...validSimulatorPayload,
    bhsUid: "",
    iataCode: "123",
    flightNo: "",
    threatLevel: 6,
  };
  const result = screeningSimulatorInputSchema.safeParse(invalid);
  assert.equal(result.success, false);
  assert.deepEqual(
    new Set(result.error.issues.map((issue) => issue.path[0])),
    new Set(["bhsUid", "iataCode", "flightNo", "threatLevel"]),
  );
});

test("AVAILABLE is rejected without an image set and images", () => {
  const result = screeningSimulatorInputSchema.safeParse({
    ...validSimulatorPayload,
    imageSetId: null,
    images: [],
  });

  assert.equal(result.success, false);
  assert.equal(
    result.error.issues.some((issue) => issue.path[0] === "imageSetId"),
    true,
  );
  assert.equal(
    result.error.issues.some((issue) => issue.path[0] === "images"),
    true,
  );
});

test("PENDING is accepted without an image set or images", () => {
  const result = screeningSimulatorInputSchema.safeParse({
    ...validSimulatorPayload,
    scanStatus: "PENDING",
    imageSetId: null,
    images: [],
  });

  assert.equal(result.success, true);
});

test("registered user image sets map only to existing JPG or PNG files", () => {
  assert.ok(MOCK_XRAY_SETS.length > 0);

  for (const imageSet of MOCK_XRAY_SETS) {
    assert.match(imageSet.id, /^user-set-/);
    assert.ok(imageSet.images.length > 0);
    for (const image of imageSet.images) {
      assert.match(image.imageRef, /^\/mock-xray\/user\/.+\.(?:jpe?g|png)$/i);
      assert.ok(["image/jpeg", "image/png"].includes(image.mimeType));
      assert.equal(
        existsSync(path.join(repositoryRoot, "public", image.imageRef.replace(/^\//, ""))),
        true,
        `${image.imageRef} must exist`,
      );
    }
  }
});

test("canonical System Administrator can submit and the mock adapter keeps supplied values", async () => {
  let normalizedEvent;
  const service = {
    async ingestSuspectEvent(event) {
      normalizedEvent = event;
      return {
        status: "ACCEPTED",
        eventId: event.eventId,
        bagId: "ETB-SIM-701",
        scanId: "00000000-0000-4000-8000-000000000801",
        scanStatus: event.scan.status,
      };
    },
  };

  const response = await handleScreeningSimulatorRequest(requestFor(validSimulatorPayload), {
    getSession: sessionLookupFor("System Administrator"),
    service,
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.status, "ACCEPTED");
  assert.equal(body.bhsUid, validSimulatorPayload.bhsUid);
  assert.equal(normalizedEvent.eventId, validSimulatorPayload.eventId);
  assert.equal(normalizedEvent.sourceSystem, "SIMULATED_HBSS");
  assert.deepEqual(normalizedEvent.scan.images, validSimulatorPayload.images);
});

test("Operations Officer selecting Developer workspace cannot submit", async () => {
  let serviceCalled = false;
  const response = await handleScreeningSimulatorRequest(requestFor(validSimulatorPayload), {
    getSession: sessionLookupFor("Operations Officer"),
    service: {
      async ingestSuspectEvent() {
        serviceCalled = true;
        throw new Error("must not be reached");
      },
    },
  });
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.code, "SCREENING_FORBIDDEN");
  assert.equal(serviceCalled, false);
});

test("exact simulator resend is DUPLICATE and changed resend conflicts", async () => {
  const events = new Map();
  const service = createScreeningIngestionService({
    repository: {
      async ingestAtomic(command) {
        const existing = events.get(command.event.eventId);
        if (existing) {
          if (existing.payloadHash !== command.payloadHash) {
            return {
              status: "CONFLICT",
              eventId: command.event.eventId,
              bagId: existing.bagId,
              scanId: existing.scanId,
              scanStatus: null,
              errorCode: "EVENT_ID_PAYLOAD_CONFLICT",
              errorMessage: "Event ID was already used with a different payload",
            };
          }
          return {
            status: "DUPLICATE",
            eventId: command.event.eventId,
            bagId: existing.bagId,
            scanId: existing.scanId,
            scanStatus: existing.scanStatus,
            errorCode: null,
            errorMessage: null,
          };
        }

        const stored = {
          payloadHash: command.payloadHash,
          bagId: "ETB-SIM-702",
          scanId: "00000000-0000-4000-8000-000000000802",
          scanStatus: command.event.scan.status,
        };
        events.set(command.event.eventId, stored);
        return {
          status: "ACCEPTED",
          eventId: command.event.eventId,
          bagId: stored.bagId,
          scanId: stored.scanId,
          scanStatus: stored.scanStatus,
          errorCode: null,
          errorMessage: null,
        };
      },
    },
  });
  const options = {
    getSession: sessionLookupFor("System Administrator"),
    service,
  };

  const accepted = await handleScreeningSimulatorRequest(
    requestFor(validSimulatorPayload),
    options,
  );
  const duplicate = await handleScreeningSimulatorRequest(
    requestFor(validSimulatorPayload),
    options,
  );
  const conflict = await handleScreeningSimulatorRequest(
    requestFor({ ...validSimulatorPayload, threatLevel: 5 }),
    options,
  );

  assert.equal(accepted.status, 201);
  assert.equal((await duplicate.json()).status, "DUPLICATE");
  assert.equal(duplicate.status, 200);
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).conflictCode, "EVENT_ID_PAYLOAD_CONFLICT");
});

test("simulator browser code has no direct suspect creation or integration secret", () => {
  const browserFiles = [
    "src/features/simulator/ScreeningHbssSimulator.tsx",
    "src/features/simulator/SimulatorPanel.tsx",
    "src/features/simulator/mockXraySets.ts",
    "src/routes/dev.simulator.tsx",
  ];
  const browserSource = browserFiles
    .map((file) => readFileSync(path.join(repositoryRoot, file), "utf8"))
    .join("\n");

  assert.doesNotMatch(browserSource, /bagService\.flagSuspect/);
  assert.doesNotMatch(browserSource, /SCREENING_INTEGRATION_KEY/);
  assert.doesNotMatch(browserSource, /x-screening-integration-key/i);
  assert.doesNotMatch(browserSource, /data:image|;base64/i);
});
