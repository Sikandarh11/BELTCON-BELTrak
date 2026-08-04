import { createMockOperation, resetOperations } from "./mockOperation.mjs";

const REPOSITORY_METHODS = Object.freeze({
  bags: [
    "create",
    "findById",
    "findByBhsUid",
    "findByIataCode",
    "findByEpc",
    "update",
    "archive",
    "transition",
  ],
  tagging: ["listPendingTagging", "encodeTagAtomic", "assignRfidTagAtomic"],
  bhs: ["ingestAtomic"],
  screening: ["ingestAtomic"],
  rfid: ["process"],
  recheck: ["queue", "caseForTag", "caseForBag", "beginRecall", "completeRecall", "resolve"],
  audit: ["append", "list"],
});

function createRepository(name, methodNames, overrides = {}) {
  const repository = {};
  for (const methodName of methodNames) {
    const supplied = overrides[methodName];
    repository[methodName] = createMockOperation(
      `${name}.${methodName}`,
      supplied ??
        (() => {
          throw new Error(`Unscripted database mock operation: ${name}.${methodName}`);
        }),
    );
  }
  return repository;
}

export function createDatabaseMock({ initialData = {}, repositories = {} } = {}) {
  const initial = structuredClone(initialData);
  const state = structuredClone(initial);
  const result = { state };

  for (const [name, methods] of Object.entries(REPOSITORY_METHODS)) {
    result[name] = createRepository(name, methods, repositories[name]);
  }

  result.reset = () => {
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, structuredClone(initial));
    for (const name of Object.keys(REPOSITORY_METHODS)) resetOperations(result[name]);
  };
  return result;
}
