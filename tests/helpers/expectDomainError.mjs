import assert from "node:assert/strict";

export async function expectDomainError(action, expected = {}) {
  let caught;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof Error, "Expected a domain error to be thrown");
  if (expected.name) assert.equal(caught.name, expected.name);
  if (expected.code) assert.equal(caught.code, expected.code);
  if (expected.message) assert.match(caught.message, expected.message);
  return caught;
}
