import assert from "node:assert/strict";
import test from "node:test";

import {
  STALE_TREND_RANGE_ERROR,
  getExpectedTrendPeriods,
  isTrendRangeNotFound,
  validateTrendPeriodCoverage,
} from "./trendRange.ts";

test("rejects a trend response when a deleted middle month is missing", () => {
  const validationError = validateTrendPeriodCoverage(
    "2025-01",
    "2025-04",
    [{ period: "2025-01" }, { period: "2025-02" }, { period: "2025-04" }],
  );

  assert.equal(validationError, STALE_TREND_RANGE_ERROR);
});

test("accepts a contiguous response covering the selected monthly range", () => {
  assert.deepEqual(getExpectedTrendPeriods("2025-11", "2026-01"), [
    "2025-11",
    "2025-12",
    "2026-01",
  ]);
  assert.equal(
    validateTrendPeriodCoverage(
      "2025-11",
      "2026-01",
      [{ period: "2025-11" }, { period: "2025-12" }, { period: "2026-01" }],
    ),
    null,
  );
});

test("accepts a selected subrange when the company has additional saved periods", () => {
  const validationError = validateTrendPeriodCoverage(
    "2025-02",
    "2025-04",
    [
      { period: "2025-01" },
      { period: "2025-02" },
      { period: "2025-03" },
      { period: "2025-04" },
      { period: "2025-05" },
    ],
    { allowPeriodsOutsideRange: true },
  );

  assert.equal(validationError, null);
});

test("recognizes a 404 trend request as a stale selected range", () => {
  assert.equal(isTrendRangeNotFound({ status: 404 }), true);
  assert.equal(isTrendRangeNotFound({ status: 400 }), false);
});