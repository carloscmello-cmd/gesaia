import assert from "node:assert/strict";
import test from "node:test";
import { buildTrendAnalysis } from "./calculationsTrend.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal companyData row shape expected by getTrendMetricValue. */
function row(period: string, overrides: Record<string, number | null> = {}) {
  return { period, ...overrides };
}

// Three canonical rows with proportional numbers so deltas come out cleanly:
//   Period A: revenue=100, varCosts=50, fixedCosts=20 → mc=50 (50%), opResult=30, safetyMargin=60%
//   Period B: revenue=200, varCosts=100, fixedCosts=40 → mc=100 (50%), opResult=60, safetyMargin=60%
//   Period C: revenue=300, varCosts=150, fixedCosts=60 → mc=150 (50%), opResult=90, safetyMargin=60%
const ROW_A = row("2025-01", { netRevenue: 100, variableCosts: 50, fixedCosts: 20 });
const ROW_B = row("2025-02", { netRevenue: 200, variableCosts: 100, fixedCosts: 40 });
const ROW_C = row("2025-03", { netRevenue: 300, variableCosts: 150, fixedCosts: 60 });

// ── Happy-path: values and deltas ─────────────────────────────────────────────

test("returns three periods with correct values and period-over-period deltas", () => {
  const result = buildTrendAnalysis("2025-01", "2025-03", [ROW_A, ROW_B, ROW_C]);

  assert.ok(!("error" in result), "Expected no error");
  assert.equal(result.periodStart, "2025-01");
  assert.equal(result.periodEnd, "2025-03");
  assert.equal(result.periods.length, 3);

  // ── Period A (first — deltas must be null) ────────────────────────────────
  const pA = result.periods[0];
  assert.equal(pA.period, "2025-01");

  assert.equal(pA.metrics.netRevenue.value, 100);
  assert.equal(pA.metrics.netRevenue.delta, null);
  assert.equal(pA.metrics.netRevenue.deltaPct, null);

  assert.equal(pA.metrics.contributionMargin.value, 50);
  assert.equal(pA.metrics.contributionMargin.delta, null);

  assert.equal(pA.metrics.contributionMarginPct.value, 50);   // 50/100 * 100
  assert.equal(pA.metrics.contributionMarginPct.delta, null);

  assert.equal(pA.metrics.fixedCosts.value, 20);
  assert.equal(pA.metrics.fixedCosts.delta, null);

  assert.equal(pA.metrics.operatingResult.value, 30);   // mc − fixedCosts = 50 − 20
  assert.equal(pA.metrics.operatingResult.delta, null);

  // safety margin: pe = 20/0.5 = 40, safety = (100−40)/100*100 = 60
  assert.equal(pA.metrics.safetyMargin.value, 60);
  assert.equal(pA.metrics.safetyMargin.delta, null);

  // ── Period B (second — first delta appears) ──────────────────────────────
  const pB = result.periods[1];
  assert.equal(pB.period, "2025-02");

  assert.equal(pB.metrics.netRevenue.value, 200);
  assert.equal(pB.metrics.netRevenue.delta, 100);         // 200 − 100
  assert.equal(pB.metrics.netRevenue.deltaPct, 100);      // 100/100 * 100

  assert.equal(pB.metrics.contributionMargin.value, 100);
  assert.equal(pB.metrics.contributionMargin.delta, 50);
  assert.equal(pB.metrics.contributionMargin.deltaPct, 100);

  assert.equal(pB.metrics.contributionMarginPct.value, 50); // unchanged
  assert.equal(pB.metrics.contributionMarginPct.delta, 0);
  assert.equal(pB.metrics.contributionMarginPct.deltaPct, 0);

  assert.equal(pB.metrics.fixedCosts.value, 40);
  assert.equal(pB.metrics.fixedCosts.delta, 20);
  assert.equal(pB.metrics.fixedCosts.deltaPct, 100);

  assert.equal(pB.metrics.operatingResult.value, 60);     // 100 − 40
  assert.equal(pB.metrics.operatingResult.delta, 30);
  assert.equal(pB.metrics.operatingResult.deltaPct, 100);

  assert.equal(pB.metrics.safetyMargin.value, 60);        // safety unchanged
  assert.equal(pB.metrics.safetyMargin.delta, 0);
  assert.equal(pB.metrics.safetyMargin.deltaPct, 0);

  // ── Period C (third) ─────────────────────────────────────────────────────
  const pC = result.periods[2];
  assert.equal(pC.period, "2025-03");

  assert.equal(pC.metrics.netRevenue.value, 300);
  assert.equal(pC.metrics.netRevenue.delta, 100);         // 300 − 200
  assert.equal(pC.metrics.netRevenue.deltaPct, 50);       // 100/200 * 100

  assert.equal(pC.metrics.contributionMargin.value, 150);
  assert.equal(pC.metrics.contributionMargin.delta, 50);
  assert.equal(pC.metrics.contributionMargin.deltaPct, 50);

  assert.equal(pC.metrics.fixedCosts.value, 60);
  assert.equal(pC.metrics.fixedCosts.delta, 20);
  assert.equal(pC.metrics.fixedCosts.deltaPct, 50);

  assert.equal(pC.metrics.operatingResult.value, 90);
  assert.equal(pC.metrics.operatingResult.delta, 30);
  assert.equal(pC.metrics.operatingResult.deltaPct, 50);

  assert.equal(pC.metrics.safetyMargin.value, 60);
  assert.equal(pC.metrics.safetyMargin.delta, 0);
});

// ── Optional metrics: ebitda, netProfit, activeCustomers, averageTicket, cashCycle ──

test("passes through ebitda, netProfit, activeCustomers, averageTicket, and cashCycle values", () => {
  const rows = [
    row("2025-01", { netRevenue: 100, variableCosts: 50, fixedCosts: 20, ebitda: 25, netProfit: 18, activeCustomers: 10, averageTicket: 10, pmr: 30, pme: 15, pmp: 10 }),
    row("2025-02", { netRevenue: 200, variableCosts: 100, fixedCosts: 40, ebitda: 50, netProfit: 36, activeCustomers: 20, averageTicket: 10, pmr: 30, pme: 15, pmp: 10 }),
    row("2025-03", { netRevenue: 300, variableCosts: 150, fixedCosts: 60, ebitda: 75, netProfit: 54, activeCustomers: 30, averageTicket: 10, pmr: 30, pme: 15, pmp: 10 }),
  ];

  const result = buildTrendAnalysis("2025-01", "2025-03", rows);
  assert.ok(!("error" in result));

  const [pA, pB, pC] = result.periods;

  // ebitda
  assert.equal(pA.metrics.ebitda.value, 25);
  assert.equal(pA.metrics.ebitda.delta, null);
  assert.equal(pB.metrics.ebitda.value, 50);
  assert.equal(pB.metrics.ebitda.delta, 25);
  assert.equal(pC.metrics.ebitda.delta, 25);

  // netProfit
  assert.equal(pA.metrics.netProfit.value, 18);
  assert.equal(pB.metrics.netProfit.delta, 18);

  // activeCustomers
  assert.equal(pA.metrics.activeCustomers.value, 10);
  assert.equal(pB.metrics.activeCustomers.delta, 10);
  assert.equal(pB.metrics.activeCustomers.deltaPct, 100);

  // averageTicket — all 10, so delta=0
  assert.equal(pB.metrics.averageTicket.delta, 0);

  // cashCycle = pmr+pme-pmp = 30+15-10 = 35, unchanged across all periods
  assert.equal(pA.metrics.cashCycle.value, 35);
  assert.equal(pB.metrics.cashCycle.delta, 0);
  assert.equal(pC.metrics.cashCycle.delta, 0);
});

// ── Null propagation when inputs are missing ──────────────────────────────────

test("derived metrics are null when required inputs are absent", () => {
  const rows = [
    row("2025-01", {}),
    row("2025-02", {}),
    row("2025-03", {}),
  ];

  const result = buildTrendAnalysis("2025-01", "2025-03", rows);
  assert.ok(!("error" in result));

  for (const p of result.periods) {
    assert.equal(p.metrics.netRevenue.value, null);
    assert.equal(p.metrics.contributionMargin.value, null);
    assert.equal(p.metrics.contributionMarginPct.value, null);
    assert.equal(p.metrics.fixedCosts.value, null);
    assert.equal(p.metrics.operatingResult.value, null);
    assert.equal(p.metrics.safetyMargin.value, null);
    assert.equal(p.metrics.cashCycle.value, null);
    assert.equal(p.metrics.ebitda.value, null);
    assert.equal(p.metrics.netProfit.value, null);
  }
});

test("identifies whether an unavailable safety margin needs inputs or does not apply", () => {
  const rows = [
    row("2025-01", { netRevenue: 100, fixedCosts: 20 }),
    row("2025-02", { netRevenue: 100, variableCosts: 100, fixedCosts: 20 }),
    row("2025-03", { netRevenue: 100, variableCosts: 50, fixedCosts: 20 }),
  ];

  const result = buildTrendAnalysis("2025-01", "2025-03", rows);
  assert.ok(!("error" in result));

  const [missingVariableCosts, notApplicable, calculated] = result.periods;
  assert.deepEqual(missingVariableCosts.metrics.safetyMargin, {
    value: null,
    delta: null,
    deltaPct: null,
    unavailableReason: "missing_inputs",
    missingInputs: ["variableCosts"],
  });
  assert.deepEqual(notApplicable.metrics.safetyMargin, {
    value: null,
    delta: null,
    deltaPct: null,
    unavailableReason: "not_applicable",
    missingInputs: [],
  });
  assert.equal(calculated.metrics.safetyMargin.value, 60);
  assert.equal(calculated.metrics.safetyMargin.unavailableReason, null);
  assert.deepEqual(calculated.metrics.safetyMargin.missingInputs, []);
});

// ── Intermediate periods included in chronological order ─────────────────────

test("includes every intermediate persisted period in chronological order", () => {
  const rows = [
    // Deliberately supplied out of order to the function
    row("2025-03", { netRevenue: 300, variableCosts: 150, fixedCosts: 60 }),
    row("2025-01", { netRevenue: 100, variableCosts: 50,  fixedCosts: 20 }),
    row("2025-05", { netRevenue: 500, variableCosts: 250, fixedCosts: 100 }),
    row("2025-02", { netRevenue: 200, variableCosts: 100, fixedCosts: 40 }),
    row("2025-04", { netRevenue: 400, variableCosts: 200, fixedCosts: 80 }),
  ];

  const result = buildTrendAnalysis("2025-01", "2025-05", rows);
  assert.ok(!("error" in result));

  assert.equal(result.periods.length, 5);
  assert.deepEqual(
    result.periods.map((p) => p.period),
    ["2025-01", "2025-02", "2025-03", "2025-04", "2025-05"],
  );
});

test("rows outside the selected range are excluded from the result", () => {
  const rows = [
    row("2024-12", { netRevenue: 90,  variableCosts: 45, fixedCosts: 18 }),
    row("2025-01", { netRevenue: 100, variableCosts: 50, fixedCosts: 20 }),
    row("2025-02", { netRevenue: 200, variableCosts: 100, fixedCosts: 40 }),
    row("2025-03", { netRevenue: 300, variableCosts: 150, fixedCosts: 60 }),
    row("2025-04", { netRevenue: 400, variableCosts: 200, fixedCosts: 80 }),
  ];

  const result = buildTrendAnalysis("2025-01", "2025-03", rows);
  assert.ok(!("error" in result));

  assert.equal(result.periods.length, 3);
  assert.deepEqual(
    result.periods.map((p) => p.period),
    ["2025-01", "2025-02", "2025-03"],
  );
});

// ── Error: reversed range ─────────────────────────────────────────────────────

test("rejects a reversed range (periodStart lexically after periodEnd)", () => {
  const result = buildTrendAnalysis("2025-03", "2025-01", [ROW_A, ROW_B, ROW_C]);
  assert.ok("error" in result);
  assert.equal((result as any).status, 400);
  assert.match((result as any).error, /período inicial deve ser anterior/i);
});

// ── Error: identical start and end ───────────────────────────────────────────

test("rejects identical periodStart and periodEnd", () => {
  const result = buildTrendAnalysis("2025-02", "2025-02", [ROW_A, ROW_B, ROW_C]);
  assert.ok("error" in result);
  assert.equal((result as any).status, 400);
  assert.match((result as any).error, /diferentes/i);
});

// ── Error: periodStart not present in rows ────────────────────────────────────

test("returns 404 when periodStart has no persisted data row", () => {
  const rows = [
    row("2025-02", { netRevenue: 200, variableCosts: 100, fixedCosts: 40 }),
    row("2025-03", { netRevenue: 300, variableCosts: 150, fixedCosts: 60 }),
    row("2025-04", { netRevenue: 400, variableCosts: 200, fixedCosts: 80 }),
  ];

  const result = buildTrendAnalysis("2025-01", "2025-04", rows);
  assert.ok("error" in result);
  assert.equal((result as any).status, 404);
  assert.match((result as any).error, /período inicial ou final/i);
});

// ── Error: periodEnd not present in rows ──────────────────────────────────────

test("returns 404 when periodEnd has no persisted data row", () => {
  const rows = [
    row("2025-01", { netRevenue: 100, variableCosts: 50,  fixedCosts: 20 }),
    row("2025-02", { netRevenue: 200, variableCosts: 100, fixedCosts: 40 }),
    row("2025-03", { netRevenue: 300, variableCosts: 150, fixedCosts: 60 }),
  ];

  const result = buildTrendAnalysis("2025-01", "2025-05", rows);
  assert.ok("error" in result);
  assert.equal((result as any).status, 404);
  assert.match((result as any).error, /período inicial ou final/i);
});

test("returns 404 instead of skipping a deleted middle period", () => {
  const rows = [
    row("2025-01", { netRevenue: 100, variableCosts: 50, fixedCosts: 20 }),
    row("2025-02", { netRevenue: 200, variableCosts: 100, fixedCosts: 40 }),
    // 2025-03 was deleted after the consultant saved this range.
    row("2025-04", { netRevenue: 400, variableCosts: 200, fixedCosts: 80 }),
  ];

  const result = buildTrendAnalysis("2025-01", "2025-04", rows);

  assert.ok("error" in result);
  assert.equal((result as any).status, 404);
  assert.match((result as any).error, /intervalo contínuo/i);
});

// ── Error: fewer than three periods in range ──────────────────────────────────

test("rejects a range that yields only two periods", () => {
  const result = buildTrendAnalysis("2025-01", "2025-02", [ROW_A, ROW_B, ROW_C]);
  assert.ok("error" in result);
  assert.equal((result as any).status, 400);
  assert.match((result as any).error, /pelo menos 3 períodos/i);
});

test("rejects a range that yields only one period (start equals end but row exists for both bounds)", () => {
  // Only one data row falls inside the range because there's no intermediate data
  const rows = [
    row("2025-01", { netRevenue: 100, variableCosts: 50, fixedCosts: 20 }),
    row("2025-05", { netRevenue: 500, variableCosts: 250, fixedCosts: 100 }),
  ];
  // Range covers both endpoints but there are only 2 rows → fewer-than-3 error
  const result = buildTrendAnalysis("2025-01", "2025-05", rows);
  assert.ok("error" in result);
  assert.equal((result as any).status, 400);
  assert.match((result as any).error, /pelo menos 3 períodos/i);
});
