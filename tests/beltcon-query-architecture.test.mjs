import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServer } from "vite";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  root: repositoryRoot,
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true },
  resolve: { alias: { "@": path.join(repositoryRoot, "src") } },
});
test.after(async () => vite.close());
const { alarmKeys, rfidKeys, taggingKeys } = await vite.ssrLoadModule("/src/lib/queryKeys.ts");

test("operational query keys are deterministic and never retain undefined or functions", () => {
  const first = taggingKeys.queue({
    status: ["OPEN", "ACKNOWLEDGED"],
    page: 1,
    omitted: undefined,
    ignored: () => undefined,
  });
  const equivalent = taggingKeys.queue({ page: 1, status: ["ACKNOWLEDGED", "OPEN"] });
  const changed = taggingKeys.queue({ page: 2, status: ["ACKNOWLEDGED", "OPEN"] });

  assert.deepEqual(first, equivalent);
  assert.notDeepEqual(first, changed);
  assert.doesNotMatch(JSON.stringify(first), /omitted|ignored/);
  assert.deepEqual(
    alarmKeys.list({ page: 1, statuses: [] }),
    alarmKeys.list({ statuses: [], page: 1 }),
  );
  assert.deepEqual(rfidKeys.trackableBags(), rfidKeys.trackableBags({}));
});

test("BELTCON Query Architecture exposes every operational key domain", () => {
  const keys = source("src/lib/queryKeys.ts");
  for (const domain of [
    "authKeys",
    "userKeys",
    "roleKeys",
    "permissionKeys",
    "bagKeys",
    "taggingKeys",
    "rfidKeys",
    "readerKeys",
    "alarmKeys",
    "recheckKeys",
    "hbssKeys",
    "resolutionKeys",
    "auditKeys",
    "reportKeys",
    "integrationKeys",
  ]) {
    assert.match(keys, new RegExp(`export const ${domain}`));
  }
  assert.match(keys, /filter\(\(\[, value\]\) => value !== undefined\)/);
  assert.match(keys, /sort\(\(\[left\], \[right\]\) => left\.localeCompare\(right\)\)/);
  assert.match(keys, /JSON\.stringify\(left\)\.localeCompare/);
});

test("Zustand only owns BELTCON UI preferences", () => {
  const store = source("src/store/appStore.ts");
  for (const removedRecord of [
    "bags:",
    "alarms:",
    "events:",
    "readers:",
    "resolutions:",
    "auditLog:",
    "hydrate:",
    "updateBag:",
    "addAlarm:",
    "addEvent:",
    "updateReader:",
  ]) {
    assert.doesNotMatch(store, new RegExp(removedRecord));
  }
  assert.match(store, /sidebarCollapsed/);
  assert.match(store, /tableDensity/);
  assert.match(store, /simulatorPlaybackSpeed/);
});

test("operational pages do not import legacy browser authority", () => {
  for (const path of [
    "src/routes/tagging.tsx",
    "src/routes/alarms.tsx",
    "src/routes/recheck.tsx",
    "src/routes/ops.scan.tsx",
    "src/routes/supervisor.overview.tsx",
    "src/features/simulator/SimulatorPanel.tsx",
    "src/features/simulator/ScreeningHbssSimulator.tsx",
  ]) {
    const page = source(path);
    assert.doesNotMatch(page, /@\/store\/appStore/);
    assert.doesNotMatch(
      page,
      /@\/services\/(bagService|alarmService|eventService|persistenceService)/,
    );
  }
});

test("legacy browser persistence cannot write Supabase operational tables", () => {
  for (const path of [
    "src/services/persistenceService.ts",
    "src/services/bagService.ts",
    "src/services/alarmService.ts",
    "src/services/eventService.ts",
    "src/services/realtimeService.ts",
  ]) {
    const implementation = source(path);
    assert.doesNotMatch(implementation, /supabase\.from\(/);
    assert.doesNotMatch(implementation, /useAppStore/);
  }
});

test("migrated operational clients use centralized query keys", () => {
  for (const path of [
    "src/services/bags/taggingClient.ts",
    "src/services/bags/rfidTrackableClient.ts",
    "src/services/rfid/rfidClient.ts",
    "src/services/alarms/alarmClient.ts",
    "src/services/recheck/recheckClient.ts",
  ]) {
    assert.match(source(path), /@\/lib\/queryKeys/);
  }
});
