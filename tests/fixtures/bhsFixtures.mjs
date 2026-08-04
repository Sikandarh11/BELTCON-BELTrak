export const BHS_BASE_MESSAGE = Object.freeze({
  messageType: 2001,
  trigger: 1,
  lineId: "01",
  bhsUid: "1234567890",
  evaluation: "R",
});

export function createBhsMessage(overrides = {}) {
  return { ...BHS_BASE_MESSAGE, ...overrides };
}

export const validBhsMessages = Object.freeze({
  accept: Object.freeze(createBhsMessage({ evaluation: "A" })),
  reject: Object.freeze(createBhsMessage({ evaluation: "R" })),
  timeout: Object.freeze(createBhsMessage({ evaluation: "T" })),
  noDecision: Object.freeze(createBhsMessage({ evaluation: "N" })),
  mistrack: Object.freeze(createBhsMessage({ evaluation: "?" })),
  line01: Object.freeze(createBhsMessage({ lineId: "01" })),
  differentLine: Object.freeze(createBhsMessage({ lineId: "02" })),
  leadingZeros: Object.freeze(createBhsMessage({ bhsUid: "0012345678" })),
  uppercase: Object.freeze(createBhsMessage({ bhsUid: "ABC1234567" })),
  lowercase: Object.freeze(createBhsMessage({ bhsUid: "abc1234567" })),
  exactDuplicate: Object.freeze(createBhsMessage()),
});

function without(field) {
  const message = createBhsMessage();
  delete message[field];
  return message;
}

function invalid(id, reason, message) {
  return Object.freeze({ id, reason, message });
}

export const invalidBhsMessages = Object.freeze([
  invalid("missing-message-type", "messageType is required", without("messageType")),
  invalid(
    "unsupported-message-type",
    "only semantic message 2001 is supported",
    createBhsMessage({ messageType: 2999 }),
  ),
  invalid("missing-trigger", "trigger is required", without("trigger")),
  invalid("invalid-trigger", "only trigger 1 is supported", createBhsMessage({ trigger: 2 })),
  invalid("missing-line", "lineId is required", without("lineId")),
  invalid("short-line", "lineId must contain two characters", createBhsMessage({ lineId: "0" })),
  invalid("long-line", "lineId must contain two characters", createBhsMessage({ lineId: "001" })),
  invalid("missing-bhs-uid", "bhsUid is required", without("bhsUid")),
  invalid(
    "short-bhs-uid",
    "bhsUid must contain ten characters",
    createBhsMessage({ bhsUid: "123456789" }),
  ),
  invalid(
    "long-bhs-uid",
    "bhsUid must contain ten characters",
    createBhsMessage({ bhsUid: "12345678901" }),
  ),
  invalid(
    "control-character",
    "control characters are forbidden",
    createBhsMessage({ bhsUid: "12345\n7890" }),
  ),
  invalid(
    "internal-etb-id",
    "internal ETB identities are forbidden",
    createBhsMessage({ bhsUid: "ETB-123456" }),
  ),
  invalid("missing-evaluation", "evaluation is required", without("evaluation")),
  invalid(
    "unsupported-evaluation",
    "evaluation is not in the semantic vocabulary",
    createBhsMessage({ evaluation: "X" }),
  ),
  invalid("unexpected-field", "the message object is strict", {
    ...createBhsMessage(),
    unexpected: true,
  }),
  invalid(
    "null-message-type",
    "null messageType is invalid",
    createBhsMessage({ messageType: null }),
  ),
  invalid("null-trigger", "null trigger is invalid", createBhsMessage({ trigger: null })),
  invalid("null-line", "null lineId is invalid", createBhsMessage({ lineId: null })),
  invalid("null-bhs-uid", "null bhsUid is invalid", createBhsMessage({ bhsUid: null })),
  invalid("null-evaluation", "null evaluation is invalid", createBhsMessage({ evaluation: null })),
  invalid("empty-line", "empty lineId is invalid", createBhsMessage({ lineId: "" })),
  invalid("empty-bhs-uid", "empty bhsUid is invalid", createBhsMessage({ bhsUid: "" })),
  invalid("empty-evaluation", "empty evaluation is invalid", createBhsMessage({ evaluation: "" })),
  invalid(
    "whitespace-line",
    "lineId transport padding is forbidden",
    createBhsMessage({ lineId: "  " }),
  ),
  invalid(
    "whitespace-bhs-uid",
    "whitespace bhsUid is invalid",
    createBhsMessage({ bhsUid: "          " }),
  ),
  invalid(
    "nested-line",
    "nested message fields are invalid",
    createBhsMessage({ lineId: { value: "01" } }),
  ),
  invalid(
    "prototype-pollution-proto",
    "prototype-pollution keys are unexpected",
    JSON.parse(
      '{"messageType":2001,"trigger":1,"lineId":"01","bhsUid":"1234567890","evaluation":"R","__proto__":{"polluted":true}}',
    ),
  ),
  invalid(
    "prototype-pollution-constructor",
    "constructor keys are unexpected",
    JSON.parse(
      '{"messageType":2001,"trigger":1,"lineId":"01","bhsUid":"1234567890","evaluation":"R","constructor":{"prototype":{"polluted":true}}}',
    ),
  ),
]);

export function createOversizedBhsBody(byteCount = 256 * 1024 + 1) {
  return "x".repeat(byteCount);
}
