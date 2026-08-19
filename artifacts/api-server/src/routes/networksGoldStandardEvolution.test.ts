/**
 * Tests for the Padrão Ouro (Gold Standard) evolution logic across multiple periods.
 *
 * These tests exercise the pure calculation functions used by the gap-history
 * endpoint to make sure a future change to the gold-selection rule cannot
 * silently distort historical evolution charts.
 *
 * Rules under test:
 *   - The unit that defines the gold standard for a given indicator in a given
 *     period must have a 0% gap for that indicator in that period.
 *   - Other units must have the correct signed percentage gap relative to the
 *     period-specific gold value.
 *   - When an indicator value is missing for a unit or when the gold value
 *     itself cannot be established, the gap must be null (not zero, not NaN).
 *   - Each period computes its own independent gold standard, so a unit can
 *     be the gold holder in period A and not in period B.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  computeGaps,
  computeGapsPct,
  computeGoldStandard,
  type Metrics,
} from "./networksMetrics.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

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

type UnitEntry = { companyId: number; companyName: string; metrics: Metrics };

/**
 * Simulates the per-period pass performed by the gap-history endpoint:
 * computes the gold standard from the provided units then returns the gapsPct
 * map for every unit.
 */
function computePeriodGapsPct(units: UnitEntry[]): Map<number, Record<string, number | null>> {
  const gold = computeGoldStandard(units);
  const result = new Map<number, Record<string, number | null>>();
  for (const unit of units) {
    const gaps = computeGaps(unit.metrics, gold);
    result.set(unit.companyId, computeGapsPct(gaps, gold));
  }
  return result;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("gold-defining unit always has 0 % gap for the indicator it leads", () => {
  // Unit A leads on mcPct; Unit B leads on nps.
  const units: UnitEntry[] = [
    { companyId: 1, companyName: "Unidade A", metrics: metrics({ mcPct: 45, nps: 60 }) },
    { companyId: 2, companyName: "Unidade B", metrics: metrics({ mcPct: 30, nps: 80 }) },
  ];

  const gapsPct = computePeriodGapsPct(units);

  // Unit A defines the gold for mcPct → its mcPct gap must be 0 %
  assert.equal(gapsPct.get(1)!.mcPct, 0);
  // Unit B defines the gold for nps → its nps gap must be 0 %
  assert.equal(gapsPct.get(2)!.nps, 0);
});

test("non-gold unit receives the correct signed percentage gap", () => {
  // Unit A: nps=80 (gold); Unit B: nps=60 → gap = 60-80 = -20; gapsPct = -20/80*100 = -25 %
  const units: UnitEntry[] = [
    { companyId: 1, companyName: "Loja Central", metrics: metrics({ nps: 80 }) },
    { companyId: 2, companyName: "Loja Norte",   metrics: metrics({ nps: 60 }) },
  ];

  const gapsPct = computePeriodGapsPct(units);

  assert.equal(gapsPct.get(1)!.nps, 0);           // gold holder
  assert.equal(gapsPct.get(2)!.nps, -25);          // -20 / 80 * 100
});

test("cash cycle uses lower-is-better direction: gold holder gets 0 %, laggard gets negative gap", () => {
  // Unit A: cashCycle=15 (gold – lower is better); Unit B: cashCycle=30
  // gap = goldValue - metricValue = 15 - 30 = -15; gapsPct = -15/15*100 = -100 %
  const units: UnitEntry[] = [
    { companyId: 1, companyName: "Operações Alfa", metrics: metrics({ cashCycle: 15 }) },
    { companyId: 2, companyName: "Operações Beta", metrics: metrics({ cashCycle: 30 }) },
  ];

  const gapsPct = computePeriodGapsPct(units);

  assert.equal(gapsPct.get(1)!.cashCycle, 0);      // gold holder
  assert.equal(gapsPct.get(2)!.cashCycle, -100);   // -15 / |15| * 100
});

test("gold leader changes between periods and each period returns 0 % for its own leader", () => {
  // Period 2025-06: Unit A leads on mcPct, Unit B leads on nps.
  // Period 2025-12: Unit B leads on mcPct, Unit A leads on nps.
  // The two periods are computed independently — no cross-contamination.

  const periodA: UnitEntry[] = [
    { companyId: 1, companyName: "Franquia A", metrics: metrics({ mcPct: 50, nps: 70 }) },
    { companyId: 2, companyName: "Franquia B", metrics: metrics({ mcPct: 35, nps: 90 }) },
  ];
  const periodB: UnitEntry[] = [
    { companyId: 1, companyName: "Franquia A", metrics: metrics({ mcPct: 38, nps: 95 }) },
    { companyId: 2, companyName: "Franquia B", metrics: metrics({ mcPct: 55, nps: 60 }) },
  ];

  const gapsPctA = computePeriodGapsPct(periodA);
  const gapsPctB = computePeriodGapsPct(periodB);

  // Period A: Franquia A holds gold for mcPct
  assert.equal(gapsPctA.get(1)!.mcPct, 0,  "Period A – Franquia A should have 0 % gap for mcPct");
  // Period A: Franquia B holds gold for nps
  assert.equal(gapsPctA.get(2)!.nps,   0,  "Period A – Franquia B should have 0 % gap for nps");

  // Period B: Franquia B holds gold for mcPct
  assert.equal(gapsPctB.get(2)!.mcPct, 0,  "Period B – Franquia B should have 0 % gap for mcPct");
  // Period B: Franquia A holds gold for nps
  assert.equal(gapsPctB.get(1)!.nps,   0,  "Period B – Franquia A should have 0 % gap for nps");
});

test("gap is null for the unit that defines the gold when that same unit has a null value", () => {
  // A unit has null for a metric it does not define, so no gold exists for that metric.
  // Both units should receive null gapsPct for that indicator.
  const units: UnitEntry[] = [
    { companyId: 1, companyName: "Unidade X", metrics: metrics({ mcPct: 40, ebitPct: null }) },
    { companyId: 2, companyName: "Unidade Y", metrics: metrics({ mcPct: null, ebitPct: null }) },
  ];

  const gapsPct = computePeriodGapsPct(units);

  // No gold for ebitPct — both gaps must be null, not 0
  assert.equal(gapsPct.get(1)!.ebitPct, null, "ebitPct gap must be null when no gold exists");
  assert.equal(gapsPct.get(2)!.ebitPct, null, "ebitPct gap must be null when no gold exists");
  // Unit X still holds gold for mcPct even though Unit Y has no mcPct data
  assert.equal(gapsPct.get(1)!.mcPct, 0);
  assert.equal(gapsPct.get(2)!.mcPct, null, "mcPct gap must be null when the unit has no data");
});

test("indicator gap is preserved as null across periods when one period is missing data", () => {
  // Period 1: both units have nps data.
  // Period 2: only one unit has nps data → still a valid gold, other unit gap is null.
  // Period 3: no unit has nps data → gold absent, all gaps null.

  const period1: UnitEntry[] = [
    { companyId: 1, companyName: "Alfa", metrics: metrics({ nps: 80 }) },
    { companyId: 2, companyName: "Beta", metrics: metrics({ nps: 60 }) },
  ];
  const period2: UnitEntry[] = [
    { companyId: 1, companyName: "Alfa", metrics: metrics({ nps: 85 }) },
    { companyId: 2, companyName: "Beta", metrics: metrics({ nps: null }) },
  ];
  const period3: UnitEntry[] = [
    { companyId: 1, companyName: "Alfa", metrics: metrics({ nps: null }) },
    { companyId: 2, companyName: "Beta", metrics: metrics({ nps: null }) },
  ];

  const gaps1 = computePeriodGapsPct(period1);
  const gaps2 = computePeriodGapsPct(period2);
  const gaps3 = computePeriodGapsPct(period3);

  // Period 1: both have data — gold holder is Alfa (80), Beta is -25 %
  assert.equal(gaps1.get(1)!.nps, 0);
  assert.equal(gaps1.get(2)!.nps, -25);

  // Period 2: only Alfa has data — Alfa gap is 0, Beta gap is null
  assert.equal(gaps2.get(1)!.nps, 0,    "Period 2 – Alfa should be gold (0 %)");
  assert.equal(gaps2.get(2)!.nps, null, "Period 2 – Beta should have null gap (no data)");

  // Period 3: no data at all — both null
  assert.equal(gaps3.get(1)!.nps, null, "Period 3 – Alfa gap must be null (no gold exists)");
  assert.equal(gaps3.get(2)!.nps, null, "Period 3 – Beta gap must be null (no gold exists)");
});

test("three units across two periods: per-period gold selection is independent for each metric", () => {
  // Period 2025-01: Unit C leads averageTicket, Unit A leads mcPct, Unit B leads nps.
  // Period 2025-02: Unit A leads averageTicket and mcPct, Unit C leads nps.
  // Verify each metric, each period, each unit independently.

  const p1: UnitEntry[] = [
    { companyId: 1, companyName: "Unidade A", metrics: metrics({ mcPct: 48, nps: 70, averageTicket: 200 }) },
    { companyId: 2, companyName: "Unidade B", metrics: metrics({ mcPct: 40, nps: 85, averageTicket: 180 }) },
    { companyId: 3, companyName: "Unidade C", metrics: metrics({ mcPct: 35, nps: 55, averageTicket: 250 }) },
  ];
  const p2: UnitEntry[] = [
    { companyId: 1, companyName: "Unidade A", metrics: metrics({ mcPct: 52, nps: 72, averageTicket: 300 }) },
    { companyId: 2, companyName: "Unidade B", metrics: metrics({ mcPct: 44, nps: 68, averageTicket: 260 }) },
    { companyId: 3, companyName: "Unidade C", metrics: metrics({ mcPct: 39, nps: 90, averageTicket: 210 }) },
  ];

  const g1 = computePeriodGapsPct(p1);
  const g2 = computePeriodGapsPct(p2);

  // Period 1 gold holders
  assert.equal(g1.get(1)!.mcPct,         0, "P1 – A leads mcPct");
  assert.equal(g1.get(2)!.nps,           0, "P1 – B leads nps");
  assert.equal(g1.get(3)!.averageTicket, 0, "P1 – C leads averageTicket");

  // Period 1 non-gold gaps (spot-check one per metric)
  // mcPct: B gap = (40-48)/48*100 ≈ -16.67 %
  assert.ok(Math.abs(g1.get(2)!.mcPct! - (-100 * 8 / 48)) < 0.01, "P1 – B mcPct gap");
  // averageTicket: A gap = (200-250)/250*100 = -20 %
  assert.equal(g1.get(1)!.averageTicket, -20, "P1 – A averageTicket gap");

  // Period 2: all three gold holders changed for nps and averageTicket
  assert.equal(g2.get(1)!.mcPct,         0, "P2 – A leads mcPct");
  assert.equal(g2.get(3)!.nps,           0, "P2 – C leads nps");
  assert.equal(g2.get(1)!.averageTicket, 0, "P2 – A leads averageTicket");

  // Period 2 non-gold gaps (spot-check)
  // nps: A gap = (72-90)/90*100 = -20 %
  assert.equal(g2.get(1)!.nps, -20, "P2 – A nps gap");
  // averageTicket: C gap = (210-300)/300*100 = -30 %
  assert.equal(g2.get(3)!.averageTicket, -30, "P2 – C averageTicket gap");
});
