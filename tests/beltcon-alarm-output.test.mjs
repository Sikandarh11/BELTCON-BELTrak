import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  root: repositoryRoot,
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../src", import.meta.url)),
    },
  },
});

test.after(async () => {
  await vite.close();
});

const [serviceModule, simulatedModule, unavailableModule] = await Promise.all([
  vite.ssrLoadModule("/src/services/alarms/customsExitAlarmService.server.ts"),
  vite.ssrLoadModule("/src/services/alarms/output/simulatedAlarmOutputAdapter.server.ts"),
  vite.ssrLoadModule("/src/services/alarms/output/unavailablePhysicalAlarmOutputAdapter.server.ts"),
]);

const { createCustomsExitAlarmService } = serviceModule;
const { SimulatedAlarmOutputAdapter } = simulatedModule;
const { UnavailablePhysicalAlarmOutputAdapter } = unavailableModule;

test("ALARM_CREATED triggers simulated output and exact retry stays idempotent", async () => {
  const calls = [];
  const service = createCustomsExitAlarmService({
    repository: {
      processByDetectionId: async () => ({
        outcome: "ALARM_CREATED",
        detectionId: "detection-1",
        bagId: "bag-1",
        alarmId: "alarm-1",
        severity: "HIGH",
        alarmEligible: true,
      }),
    },
    outputAdapter: {
      triggerAlarmOutput: async (input) => {
        calls.push(input);
        return {
          status: calls.length === 1 ? "TRIGGERED" : "ALREADY_TRIGGERED",
          alarmId: input.alarmId,
          bagId: input.bagId,
          severity: input.severity ?? "HIGH",
          readerId: input.readerId ?? null,
          durationMs: input.durationMs ?? 5000,
          visual: true,
          audible: true,
          triggeredAt: "2026-08-05T10:00:00.000Z",
        };
      },
    },
  });

  const first = await service.processForDetection("detection-1");
  const second = await service.processForDetection("detection-1");

  assert.equal(calls.length, 2);
  assert.equal(first.output?.status, "TRIGGERED");
  assert.equal(second.output?.status, "ALREADY_TRIGGERED");
});

test("simulated output adapter records trigger metadata and deduplicates by alarmId", async () => {
  const adapter = new SimulatedAlarmOutputAdapter({ clock: () => new Date("2026-08-05T10:00:00.000Z") });
  const first = await adapter.triggerAlarmOutput({ alarmId: "alarm-1", bagId: "bag-1", durationMs: 9000 });
  const second = await adapter.triggerAlarmOutput({ alarmId: "alarm-1", bagId: "bag-1" });

  assert.equal(first.status, "TRIGGERED");
  assert.equal(first.visual, true);
  assert.equal(first.audible, true);
  assert.equal(first.severity, "HIGH");
  assert.equal(first.durationMs, 9000);
  assert.equal(second.status, "ALREADY_TRIGGERED");
  assert.equal(adapter.getTriggeredAlarm("alarm-1")?.triggeredAt, "2026-08-05T10:00:00.000Z");
});

test("physical adapter returns OUTPUT_UNAVAILABLE", async () => {
  const adapter = new UnavailablePhysicalAlarmOutputAdapter();
  const result = await adapter.triggerAlarmOutput({ alarmId: "alarm-1", bagId: "bag-1" });
  assert.equal(result.status, "OUTPUT_UNAVAILABLE");
  assert.equal(result.visual, false);
  assert.equal(result.audible, false);
});

test("simulator panel shows alarm output result", async () => {
  const source = await readFile(new URL("../src/features/simulator/SimulatorPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /alarm output/i);
  assert.match(source, /TRIGGERED/);
  assert.match(source, /ALREADY_TRIGGERED/);
});
