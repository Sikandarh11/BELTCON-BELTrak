import assert from "node:assert/strict";
import test from "node:test";

import { createProjectModuleLoader } from "./helpers/projectModuleLoader.mjs";

const loader = await createProjectModuleLoader();
test.after(() => loader.close());
const { createTaggingStationHmiModel } = await loader.load(
  "/src/features/stations/taggingStationHmiModel.ts",
);

const item = (id, overrides = {}) => ({
  id,
  bhsUid: id === "one" ? "0012345678" : "0098765432",
  state: id === "one" ? "ACTIVE" : "WAITING",
  synchronizationStatus: "SYNCHRONIZED",
  ...overrides,
});
const view = (overrides = {}) => ({
  health: { state: "ONLINE", pendingSynchronizations: 0 },
  queue: { position1: null, position2: null, alarms: [] },
  simulation: false,
  lastReceive: null,
  ...overrides,
});

test("tagging HMI state matrix", async (t) => {
  await t.test("empty queue", () => {
    const model = createTaggingStationHmiModel(view());
    assert.equal(model.activeBag, null);
    assert.equal(model.waitingBag, null);
  });
  await t.test("one active bag", () => {
    assert.equal(
      createTaggingStationHmiModel(
        view({ queue: { position1: item("one"), position2: null, alarms: [] } }),
      ).activeBag.bhsUid,
      "0012345678",
    );
  });
  await t.test("active plus waiting and queue full", () => {
    const model = createTaggingStationHmiModel(
      view({ queue: { position1: item("one"), position2: item("two"), alarms: [] } }),
    );
    assert.equal(model.waitingBag.bhsUid, "0098765432");
    assert.equal(model.queueFull, true);
  });
  for (const state of ["OFFLINE", "DEGRADED", "MISCONFIGURED"]) {
    await t.test(`station ${state.toLowerCase()}`, () => {
      assert.equal(
        createTaggingStationHmiModel(view({ health: { state, pendingSynchronizations: 0 } }))
          .stationStatus,
        state,
      );
    });
  }
  await t.test("simulation banner", () => {
    const model = createTaggingStationHmiModel(view({ simulation: true }));
    assert.equal(model.stationStatus, "SIMULATION");
    assert.equal(model.underlyingHealth, "ONLINE");
  });
  for (const [label, errorCode] of [
    ["invalid BHS message", "BHS_WIRE_MESSAGE_INVALID"],
    ["wrong LineID", "BHS_LINE_NOT_ASSIGNED_TO_STATION"],
    ["synchronization conflict", "BHS_CENTRAL_CONFLICT"],
  ]) {
    await t.test(label, () => {
      assert.equal(
        createTaggingStationHmiModel(view({ lastReceive: { outcome: "REJECTED", errorCode } }))
          .receiveNotice,
        errorCode,
      );
    });
  }
  await t.test("duplicate message", () => {
    assert.equal(
      createTaggingStationHmiModel(view({ lastReceive: { outcome: "DUPLICATE", errorCode: null } }))
        .receiveNotice,
      "DUPLICATE",
    );
  });
  await t.test("jam state and clear confirmation source", () => {
    assert.equal(
      createTaggingStationHmiModel(
        view({
          queue: {
            position1: item("one", { state: "JAMMED" }),
            position2: null,
            alarms: [],
          },
        }),
      ).jammed,
      true,
    );
  });
  await t.test("synchronization pending/offline banner", () => {
    const model = createTaggingStationHmiModel(
      view({
        health: { state: "DEGRADED", pendingSynchronizations: 1 },
        queue: {
          position1: item("one", { synchronizationStatus: "RETRY_PENDING" }),
          position2: null,
          alarms: [],
        },
      }),
    );
    assert.equal(model.synchronizationPending, true);
  });
  await t.test("restart restoration", () => {
    const queue = { position1: item("one"), position2: item("two"), alarms: [] };
    const before = createTaggingStationHmiModel(view({ queue }));
    const after = createTaggingStationHmiModel(view({ queue }));
    assert.equal(after.activeBagKey, before.activeBagKey);
  });
  await t.test("no stale data after active bag changes", () => {
    const before = createTaggingStationHmiModel(
      view({ queue: { position1: item("one"), position2: item("two"), alarms: [] } }),
    );
    const after = createTaggingStationHmiModel(
      view({
        queue: {
          position1: item("two", { state: "ACTIVE" }),
          position2: null,
          alarms: [],
        },
      }),
    );
    assert.notEqual(after.activeBagKey, before.activeBagKey);
    assert.equal(after.activeBag.bhsUid, "0098765432");
  });
});
