import assert from "node:assert/strict";
import test from "node:test";
import {
  computeGaps,
  computeGapsPct,
  computeGoldStandard,
  computeMetrics,
  findPreviousPeriod,
  type Metrics,
} from "./networksMetrics.ts";

function metrics(overrides: Partial<Metrics>): Metrics {
  return {
    netRevenue: null,
    mcPct: null,
    ebitPct: null,
    ebitdaPct: null,
    netProfitPct: null,
    cashCycle: null,
    nps: null,
    churnPct: null,
    averageTicket: null,
    activeCustomers: null,
    activeCustomersGrowthPct: null,
    ...overrides,
  };
}

test("chooses the lower cash cycle and churn with the minimum two comparable units", () => {
  const gold = computeGoldStandard([
    { companyId: 1, companyName: "Unidade Norte", metrics: metrics({ cashCycle: 25, churnPct: 3 }) },
    { companyId: 2, companyName: "Unidade Sul", metrics: metrics({ cashCycle: 15, churnPct: 1 }) },
  ]);

  assert.deepEqual(gold.cashCycle, { value: 15, companyId: 2, companyName: "Unidade Sul" });
  assert.deepEqual(gold.churnPct, { value: 1, companyId: 2, companyName: "Unidade Sul" });

  const gaps = computeGaps(metrics({ cashCycle: 25, churnPct: 3 }), gold);
  assert.equal(gaps.cashCycle, -10);
  assert.equal(gaps.churnPct, -2);
});

test("ignores missing fields and selects a different winner for every available metric", () => {
  const gold = computeGoldStandard([
    { companyId: 1, companyName: "Comercial", metrics: metrics({ nps: 90, cashCycle: null, averageTicket: 210 }) },
    { companyId: 2, companyName: "Financeira", metrics: metrics({ nps: null, cashCycle: 12, averageTicket: null }) },
    { companyId: 3, companyName: "Operações", metrics: metrics({ nps: 65, cashCycle: 18, averageTicket: 180 }) },
  ]);

  assert.deepEqual(gold.nps, { value: 90, companyId: 1, companyName: "Comercial" });
  assert.deepEqual(gold.cashCycle, { value: 12, companyId: 2, companyName: "Financeira" });
  assert.deepEqual(gold.averageTicket, { value: 210, companyId: 1, companyName: "Comercial" });
  assert.equal(gold.ebitPct, undefined);
});

test("keeps gap percentages safe for zero and negative gold values", () => {
  const gold = {
    nps: { value: 0, companyId: 1, companyName: "Referência zero" },
    cashCycle: { value: -10, companyId: 2, companyName: "Referência negativa" },
  };
  const gaps = computeGaps(metrics({ nps: -5, cashCycle: -5 }), gold);
  const gapsPct = computeGapsPct(gaps, gold);

  assert.equal(gaps.nps, -5);
  assert.equal(gapsPct.nps, null);
  assert.equal(gaps.cashCycle, -5);
  assert.equal(gapsPct.cashCycle, -50);
});

test("returns no active customer growth when there is no usable previous period", () => {
  assert.equal(computeMetrics({ activeCustomers: 120 }).activeCustomersGrowthPct, null);
  assert.equal(computeMetrics({ activeCustomers: 120 }, { activeCustomers: 0 }).activeCustomersGrowthPct, null);
  assert.equal(computeMetrics({ activeCustomers: 120 }, { activeCustomers: 100 }).activeCustomersGrowthPct, 20);
});

test("finds the previous unique chronological period or null for the first period", () => {
  const periods = ["2026-03", "2026-01", "2026-02", "2026-02"];

  assert.equal(findPreviousPeriod(periods, "2026-03"), "2026-02");
  assert.equal(findPreviousPeriod(periods, "2026-01"), null);
  assert.equal(findPreviousPeriod([], "2026-03"), null);
});