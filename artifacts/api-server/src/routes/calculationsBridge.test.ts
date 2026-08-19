import assert from "node:assert/strict";
import test from "node:test";
import { buildBridgeAnalysis, validateBridgePeriodOrder } from "./calculationsBridge.ts";

function assertContainsOnlyFiniteNumbers(value: unknown): void {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `Expected a finite number, received ${value}`);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach(assertContainsOnlyFiniteNumbers);
    return;
  }

  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(assertContainsOnlyFiniteNumbers);
  }
}

test("accepts chronological regular and AI bridge narrative period selections, including equal periods", () => {
  assert.equal(validateBridgePeriodOrder("2025-01", "2025-02"), null);
  assert.equal(validateBridgePeriodOrder("2025-02", "2025-02"), null);
});

test("rejects regular and AI bridge narrative selections whose base period is later than the comparison period", () => {
  assert.equal(
    validateBridgePeriodOrder("2025-10", "2025-02"),
    "periodBase cannot be later than periodComp",
  );
});

test("decomposes a normal two-period operating-result change into balanced bridge effects", () => {
  const result = buildBridgeAnalysis(
    "2025-01",
    "2025-02",
    { netRevenue: 1_000, variableCosts: 600, fixedCosts: 200 },
    { netRevenue: 1_200, variableCosts: 660, fixedCosts: 220 },
  );

  assert.deepEqual(
    result.bridge.map(({ value }) => value),
    [80, 60, -20],
  );
  assert.equal(result.summary.operatingResult.delta, 120);
  assert.equal(
    result.bridge.reduce((sum, effect) => sum + effect.value, 0),
    result.summary.operatingResult.delta,
  );
  assert.equal(result.bridgeCheckOk, true);
});

test("handles zero revenue and null costs without emitting NaN values", () => {
  const result = buildBridgeAnalysis(
    "2025-01",
    "2025-02",
    { netRevenue: 0, variableCosts: null, fixedCosts: null },
    { netRevenue: 100, variableCosts: null, fixedCosts: null },
  );

  assert.equal(result.summary.netRevenue.deltaPct, null);
  assert.equal(result.summary.operatingResult.delta, 100);
  assert.deepEqual(
    result.bridge.map(({ value }) => value),
    [0, 100, 0],
  );
  assert.equal(result.bridgeCheckOk, true);
  assertContainsOnlyFiniteNumbers(result);
});

test("flags a bridge decomposition that does not balance", () => {
  const result = buildBridgeAnalysis(
    "2025-01",
    "2025-02",
    { netRevenue: 0, variableCosts: 250, fixedCosts: 0 },
    { netRevenue: 1_000, variableCosts: 500, fixedCosts: 0 },
  );

  assert.equal(result.summary.operatingResult.delta, 750);
  assert.deepEqual(
    result.bridge.map(({ value }) => value),
    [0, 500, 0],
  );
  assert.equal(result.bridgeCheckOk, false);
});