"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { roundPayableToTenth } = require("./accounting-rounding");

test("rounds normally when the result remains above the minimum payable", () => {
  assert.equal(roundPayableToTenth(12.64, 8.65), 12.6);
  assert.equal(roundPayableToTenth(12.65, 8.65), 12.7);
});

test("never rounds a minimum-capped row below its payable floor", () => {
  assert.equal(roundPayableToTenth(8.65, 8.65), 8.7);
  assert.equal(roundPayableToTenth(6.485, 6.49), 6.5);
});
