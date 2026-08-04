import process from "node:process";

import { createProjectModuleLoader } from "../tests/helpers/projectModuleLoader.mjs";

const databasePath = process.env.STATION_HOST_DATA_PATH?.trim();
const centralHealthUrl = process.env.STATION_HOST_CENTRAL_HEALTH_URL?.trim();
if (!databasePath || !/(station-host-smoke|station-host-test)/i.test(databasePath)) {
  throw new Error("A dedicated station-host smoke-test data path is required");
}
if (!centralHealthUrl) throw new Error("STATION_HOST_CENTRAL_HEALTH_URL is required");
const centralUrl = new URL(centralHealthUrl);
if (!["127.0.0.1", "localhost", "::1"].includes(centralUrl.hostname)) {
  throw new Error("Station-host smoke test requires a local central health endpoint");
}

const centralResponse = await fetch(centralUrl, { signal: AbortSignal.timeout(3000) });
if (!centralResponse.ok) throw new Error(`Central health check failed (${centralResponse.status})`);

const loader = await createProjectModuleLoader();
const { SoftwareFatHarness } = await loader.load(
  "/src/services/stations/softwareFatHarness.server.ts",
);
const harness = await SoftwareFatHarness.create(databasePath);

const bootUid = process.env.STATION_HOST_BOOT_BHS_UID?.trim();
if (bootUid) {
  await harness.execute({
    action: "BHS_SEND",
    message: { messageType: 2001, trigger: 1, lineId: "01", bhsUid: bootUid, evaluation: "R" },
    repeat: 1,
  });
}

const snapshot = await harness.snapshot();
process.stdout.write(
  `${JSON.stringify({
    event: "STATION_HOST_READY",
    pid: process.pid,
    centralReachable: true,
    durableDataPath: databasePath,
    bhsHealth: snapshot.bhs.health,
    queue: snapshot.bhs.queue,
  })}\n`,
);

if (process.env.STATION_HOST_EXIT_UNGRACEFULLY === "true") process.exit(71);

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  await harness.shutdown();
  await loader.close();
  process.stdout.write(`${JSON.stringify({ event: "STATION_HOST_STOPPED", signal })}\n`);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.stdin.setEncoding("utf8");
process.stdin.on("data", (value) => {
  if (value.trim().toLowerCase() === "shutdown") void shutdown("STDIN");
});
process.stdin.resume();
