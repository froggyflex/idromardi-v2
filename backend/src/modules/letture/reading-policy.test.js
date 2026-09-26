const assert = require("node:assert/strict");
const test = require("node:test");
const {
  followsPreviousExceptionalState,
  isBlockedMeterState,
  resolveReadingValue,
} = require("./reading-policy");

test("B reuses the previous reading and ignores a submitted value", () => {
  assert.equal(
    resolveReadingValue({ state: "b", submittedValue: 999, previousValue: 123 }),
    123
  );
  assert.equal(isBlockedMeterState(" B "), true);
});

test("B is rejected when no previous reading is available", () => {
  assert.throws(
    () => resolveReadingValue({ state: "B", submittedValue: 20, previousValue: null }),
    (error) =>
      error.statusCode === 409 &&
      error.code === "BLOCKED_METER_WITHOUT_PREVIOUS_READING"
  );
});

test("Y and B propagate while ordinary states do not", () => {
  assert.equal(followsPreviousExceptionalState("Y"), true);
  assert.equal(followsPreviousExceptionalState("B"), true);
  assert.equal(followsPreviousExceptionalState("K"), false);
});
