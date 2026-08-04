import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => new URL(`../${relativePath}`, import.meta.url);

test("operational browser authority is limited to Query clients and UI-only Zustand preferences", async () => {
  const [store, taggingRoute, taggingPanel, alarms, recheck] = await Promise.all([
    readFile(source("src/store/appStore.ts"), "utf8"),
    readFile(source("src/routes/tagging.tsx"), "utf8"),
    readFile(source("src/features/stations/TaggingStationAgentPanel.tsx"), "utf8"),
    readFile(source("src/routes/alarms.tsx"), "utf8"),
    readFile(source("src/routes/recheck.tsx"), "utf8"),
  ]);

  assert.doesNotMatch(store, /\b(bags|alarms|rfidEvents|readers|resolutions|auditEvents)\s*:/);
  assert.doesNotMatch(
    `${taggingRoute}\n${taggingPanel}\n${alarms}\n${recheck}`,
    /useAppStore|persistenceService/,
  );
  assert.match(taggingRoute, /TaggingStationAgentPanel/);
  assert.match(taggingPanel, /fetch\("\/api\/stations\/tagging"/);
  assert.match(taggingPanel, /queue\.position1/);
  assert.match(alarms, /useAlarms/);
  assert.match(recheck, /useRecheckQueue/);
});

test("equipment integrations remain credentialed server boundaries and physical adapters remain disabled", async () => {
  const [bhs, rfid, adapters, featureFlags, simulatorRoute] = await Promise.all([
    readFile(source("src/services/bhs/bhsMessageApi.server.ts"), "utf8"),
    readFile(source("src/services/rfid/rfidReadApi.server.ts"), "utf8"),
    readFile(source("src/domain/beltcon-sbts-baseline/beltconSbtsBaseline.adapters.ts"), "utf8"),
    readFile(
      source("src/domain/beltcon-sbts-baseline/beltconSbtsBaseline.featureFlags.ts"),
      "utf8",
    ),
    readFile(source("src/routes/dev.simulator.tsx"), "utf8"),
  ]);

  assert.match(bhs, /x-bhs-integration-key/);
  assert.match(rfid, /x-rfid-integration-key/);
  assert.doesNotMatch(`${bhs}\n${rfid}`, /useAppStore|workspaceMode/);
  assert.match(adapters, /no workstation or serial device was contacted/);
  assert.doesNotMatch(adapters, /serialport|COM\d|\/dev\//i);
  assert.match(featureFlags, /FEATURE_BHS_PROFINET_ADAPTER: false/);
  assert.match(featureFlags, /FEATURE_HBSS_RS232_ADAPTER: false/);
  assert.match(simulatorRoute, /<TabsContent value="bhs"/);
  assert.match(simulatorRoute, /<BeltconBhsSimulator \/>/);
});

test("Recheck separates inspection permission from final-resolution permission", async () => {
  const [api, page, authorization] = await Promise.all([
    readFile(source("src/services/recheck/recheckApi.server.ts"), "utf8"),
    readFile(source("src/routes/recheck.tsx"), "utf8"),
    readFile(source("src/services/authorization/permissionAuthorization.server.ts"), "utf8"),
  ]);

  assert.match(api, /authorize\(request, options, "bag\.resolve"\)/);
  assert.match(page, /hasPermission\(user\.permissions, "bag\.resolve"\)/);
  assert.match(authorization, /ACCOUNT_(?:PROFILE_MISSING|INACTIVE|SUSPENDED|LOCKED|DEACTIVATED)/);
  assert.doesNotMatch(authorization, /workspaceMode/);
});
