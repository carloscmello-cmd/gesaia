import assert from "node:assert/strict";
import test from "node:test";

import { resolveStaleComparisonPeriod } from "./stalePeriod.ts";

test("flags a URL comparison period that was deleted", () => {
  const stalePeriod = resolveStaleComparisonPeriod({
    periodBase: "2025-01",
    periodComp: "2025-02",
    periods: [{ period: "2025-02" }, { period: "2025-03" }],
    periodsSuccess: true,
    userChangedPeriods: false,
  });

  assert.deepEqual(stalePeriod, { base: "2025-01", comp: undefined });
});

test("clears the stale banner after the user picks a valid pair", () => {
  const initialStalePeriod = resolveStaleComparisonPeriod({
    periodBase: "2025-01",
    periodComp: "2025-02",
    periods: [{ period: "2025-02" }, { period: "2025-03" }],
    periodsSuccess: true,
  });
  assert.notEqual(initialStalePeriod, null);

  const stalePeriod = resolveStaleComparisonPeriod({
    periodBase: "2025-02",
    periodComp: "2025-03",
    periods: [{ period: "2025-02" }, { period: "2025-03" }],
    periodsSuccess: true,
  });

  assert.equal(stalePeriod, null);
});

test("does not flag URL periods while a successful periods list is empty", () => {
  const stalePeriod = resolveStaleComparisonPeriod({
    periodBase: "2025-01",
    periodComp: "2025-02",
    periods: [],
    periodsSuccess: true,
  });

  assert.equal(stalePeriod, null);
});