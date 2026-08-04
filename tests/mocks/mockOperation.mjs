function cloneForRecord(value) {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

export function createMockOperation(name, implementation = () => undefined) {
  let currentImplementation = implementation;

  function operation(...args) {
    operation.calls.push(args.map(cloneForRecord));
    return currentImplementation(...args);
  }

  operation.operationName = name;
  operation.calls = [];
  operation.reset = () => {
    operation.calls.length = 0;
    currentImplementation = implementation;
  };
  operation.setImplementation = (nextImplementation) => {
    currentImplementation = nextImplementation;
  };
  return operation;
}

export function resetOperations(value) {
  for (const candidate of Object.values(value)) {
    if (typeof candidate?.reset === "function") candidate.reset();
  }
}
