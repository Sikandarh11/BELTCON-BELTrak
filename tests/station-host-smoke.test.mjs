import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { repositoryRoot } from "./helpers/projectModuleLoader.mjs";

function waitForLine(child, eventName) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${eventName}: ${stderr}`)),
      15000,
    );
    child.stderr.setEncoding("utf8");
    child.stdout.setEncoding("utf8");
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
        try {
          const value = JSON.parse(line);
          if (value.event === eventName) {
            clearTimeout(timeout);
            resolve(value);
            return;
          }
        } catch {
          // Vite diagnostics are not part of the station-host protocol.
        }
      }
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code) => {
      if (eventName !== "STATION_HOST_READY") return;
      clearTimeout(timeout);
      reject(new Error(`Station host exited before ready (${code}): ${stderr}`));
    });
  });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

test("P2-DB-028 standalone station host persists across graceful and ungraceful restart", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sbts-station-host-smoke-"));
  const databasePath = path.join(directory, "station-host-smoke.sqlite");
  const server = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"status":"ok"}');
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const centralHealthUrl = `http://127.0.0.1:${address.port}/health`;
  const processScript = path.join(repositoryRoot, "scripts", "station-host-process.mjs");

  const startHost = (extraEnvironment = {}) =>
    spawn(process.execPath, [processScript], {
      cwd: repositoryRoot,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        STATION_HOST_DATA_PATH: databasePath,
        STATION_HOST_CENTRAL_HEALTH_URL: centralHealthUrl,
        ...extraEnvironment,
      },
    });

  try {
    const first = startHost({ STATION_HOST_BOOT_BHS_UID: "0000006101" });
    const firstReady = await waitForLine(first, "STATION_HOST_READY");
    assert.equal(firstReady.centralReachable, true);
    assert.equal(firstReady.queue.position1.bhsUid, "0000006101");
    assert.equal(firstReady.durableDataPath, databasePath);
    const firstExitPromise = waitForExit(first);
    first.stdin.write("shutdown\n");
    assert.equal((await firstExitPromise).code, 0);

    const restored = startHost();
    const restoredReady = await waitForLine(restored, "STATION_HOST_READY");
    assert.equal(restoredReady.queue.position1.bhsUid, "0000006101");
    const restoredExitPromise = waitForExit(restored);
    restored.stdin.write("shutdown\n");
    assert.equal((await restoredExitPromise).code, 0);

    const crashed = startHost({
      STATION_HOST_BOOT_BHS_UID: "0000006102",
      STATION_HOST_EXIT_UNGRACEFULLY: "true",
    });
    const crashedReady = await waitForLine(crashed, "STATION_HOST_READY");
    assert.equal(crashedReady.queue.position2.bhsUid, "0000006102");
    assert.equal((await waitForExit(crashed)).code, 71);

    const recovered = startHost();
    const recoveredReady = await waitForLine(recovered, "STATION_HOST_READY");
    assert.equal(recoveredReady.queue.position1.bhsUid, "0000006101");
    assert.equal(recoveredReady.queue.position2.bhsUid, "0000006102");
    assert.ok(recoveredReady.pid > 0);
    const recoveredExitPromise = waitForExit(recovered);
    recovered.stdin.write("shutdown\n");
    assert.equal((await recoveredExitPromise).code, 0);

    const artifactDirectory = path.join(repositoryRoot, "artifacts", "station-host-smoke");
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(
      path.join(artifactDirectory, "station-host-smoke-report.json"),
      `${JSON.stringify(
        {
          testId: "P2-DB-028",
          result: "VERIFIED BY LOCAL PROCESS TEST",
          centralHealthEndpoint: "local test server",
          durableSQLite: true,
          gracefulRestart: true,
          ungracefulRestart: true,
          airportDeploymentVerified: false,
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
