import assert from "node:assert/strict";
import test from "node:test";
import {
  BASE_THRESHOLDS,
  buildChecklist,
  buildScorecard,
  classify,
  INDICATOR_DEFS,
} from "./fullReportMetrics.ts";
import { validateReportSettingsThresholds } from "./reportSettingsThresholds.ts";

test("classify respects exact higher-is-better threshold boundaries", () => {
  const threshold = { bounds: [0, 10, 20, 35] as [number, number, number, number], direction: "higher" as const };

  assert.equal(classify(-0.01, threshold), 0);
  assert.equal(classify(0, threshold), 1);
  assert.equal(classify(10, threshold), 2);
  assert.equal(classify(20, threshold), 3);
  assert.equal(classify(35, threshold), 4);
});

test("classify respects exact lower-is-better threshold boundaries", () => {
  const threshold = { bounds: [60, 30, 15, 0] as [number, number, number, number], direction: "lower" as const };

  assert.equal(classify(60.01, threshold), 0);
  assert.equal(classify(60, threshold), 1);
  assert.equal(classify(30, threshold), 2);
  assert.equal(classify(15, threshold), 3);
  assert.equal(classify(0, threshold), 4);
  assert.equal(classify(null, threshold), null);
});

test("buildChecklist marks null and undefined values as missing while keeping zero filled", () => {
  const checklist = buildChecklist({
    grossRevenue: 0,
    netRevenue: null,
    cogs: undefined,
  });
  const dre = checklist.find((group) => group.group === "DRE (Resultado)");

  assert.deepEqual(
    dre?.fields.slice(0, 3).map((field) => [field.key, field.filled]),
    [
      ["grossRevenue", true],
      ["netRevenue", false],
      ["cogs", false],
    ],
  );
  assert.ok(buildChecklist(null).every((group) => group.fields.every((field) => !field.filled)));
});

test("buildScorecard leaves absent indicators and no-data engines unclassified", () => {
  const scorecard = buildScorecard(
    { churnRate: 5 },
    {
      financial: { safetyMargin: 10 },
      marketing: { status: "no_data", score: 80 },
      commercial: { score: "85" },
    },
    BASE_THRESHOLDS,
  );

  const safetyMargin = scorecard.indicators.find((indicator) => indicator.key === "safetyMargin");
  const churnRate = scorecard.indicators.find((indicator) => indicator.key === "churnRate");
  const nps = scorecard.indicators.find((indicator) => indicator.key === "nps");
  const marketing = scorecard.engines.find((engine) => engine.key === "marketing");
  const commercial = scorecard.engines.find((engine) => engine.key === "commercial");

  assert.equal(safetyMargin?.level, 2);
  assert.equal(churnRate?.level, 2);
  assert.equal(nps?.level, null);
  assert.equal(nps?.levelLabel, "Dados não informados");
  assert.equal(marketing?.level, null);
  assert.equal(commercial?.level, 4);
});

test("scorecard exposes the seven expanded indicators with their base thresholds", () => {
  const expandedIndicators = [
    "markupOnCogs",
    "ltvCacRatio",
    "roas",
    "oeeIndex",
    "capacityUtilization",
    "turnoverCostRevenuePct",
    "trainingRoi",
  ];

  assert.equal(INDICATOR_DEFS.length, 15);
  assert.deepEqual(
    Object.fromEntries(INDICATOR_DEFS.map((indicator) => [indicator.key, indicator.engine])),
    {
      safetyMargin: "financial",
      ebitdaMargin: "financial",
      mcPct: "financial",
      cashCycle: "financial",
      markupOnCogs: "financial",
      churnRate: "commercial",
      conversionRate: "commercial",
      ltvCacRatio: "commercial",
      nps: "marketing",
      defaultRate: "marketing",
      roas: "marketing",
      oeeIndex: "operations",
      capacityUtilization: "operations",
      turnoverCostRevenuePct: "hr",
      trainingRoi: "hr",
    },
  );
  assert.deepEqual(
    expandedIndicators.map((key) => INDICATOR_DEFS.find((indicator) => indicator.key === key)?.key),
    expandedIndicators,
  );
  assert.deepEqual(
    Object.fromEntries(expandedIndicators.map((key) => [key, BASE_THRESHOLDS[key]])),
    {
      markupOnCogs: { bounds: [30, 50, 80, 120], direction: "higher" },
      ltvCacRatio: { bounds: [1, 1.5, 3, 5], direction: "higher" },
      roas: { bounds: [1, 2, 4, 8], direction: "higher" },
      oeeIndex: { bounds: [40, 55, 65, 85], direction: "higher" },
      capacityUtilization: { bounds: [30, 50, 70, 85], direction: "higher" },
      turnoverCostRevenuePct: { bounds: [20, 10, 5, 2], direction: "lower" },
      trainingRoi: { bounds: [0, 0.5, 1, 2], direction: "higher" },
    },
  );
});

test("buildScorecard carries each indicator's engine grouping metadata", () => {
  const scorecard = buildScorecard({}, {}, BASE_THRESHOLDS);

  assert.equal(scorecard.indicators.find((item) => item.key === "safetyMargin")?.engine, "financial");
  assert.equal(scorecard.indicators.find((item) => item.key === "trainingRoi")?.engine, "hr");
});

test("buildScorecard applies company overrides for every expanded indicator", () => {
  const overrides = {
    markupOnCogs: { bounds: [100, 110, 120, 130] as [number, number, number, number], direction: "higher" as const },
    ltvCacRatio: { bounds: [5, 6, 7, 8] as [number, number, number, number], direction: "higher" as const },
    roas: { bounds: [6, 7, 8, 9] as [number, number, number, number], direction: "higher" as const },
    oeeIndex: { bounds: [80, 85, 90, 95] as [number, number, number, number], direction: "higher" as const },
    capacityUtilization: { bounds: [80, 85, 90, 95] as [number, number, number, number], direction: "higher" as const },
    turnoverCostRevenuePct: { bounds: [8, 6, 4, 2] as [number, number, number, number], direction: "lower" as const },
    trainingRoi: { bounds: [1.5, 2, 3, 4] as [number, number, number, number], direction: "higher" as const },
  };
  const scorecard = buildScorecard(
    {},
    {
      financial: { markupOnCogs: 90 },
      commercial: { ltvCacRatio: 4 },
      marketing: { roas: 5 },
      operations: { oeeIndex: 75, capacityUtilization: 75 },
      hr: { turnoverCostRevenuePercent: 7, trainingRoi: 1.2 },
    },
    { ...BASE_THRESHOLDS, ...overrides },
  );

  for (const [key, threshold] of Object.entries(overrides)) {
    const indicator = scorecard.indicators.find((item) => item.key === key);
    assert.deepEqual(indicator?.thresholds, threshold, `${key} uses its company override`);
    assert.equal(indicator?.level, key === "turnoverCostRevenuePct" ? 1 : 0);
  }
});

test("report settings accepts and retains fractional overrides for every expanded indicator", () => {
  const submittedThresholds = {
    markupOnCogs: { bounds: [30.5, 50.5, 80.5, 120.5], direction: "higher" },
    ltvCacRatio: { bounds: [1.1, 1.6, 3.1, 5.1], direction: "higher" },
    roas: { bounds: [1.2, 2.2, 4.2, 8.2], direction: "higher" },
    oeeIndex: { bounds: [40.5, 55.5, 65.5, 85.5], direction: "higher" },
    capacityUtilization: { bounds: [30.5, 50.5, 70.5, 85.5], direction: "higher" },
    turnoverCostRevenuePct: { bounds: [20.5, 10.5, 5.5, 2.5], direction: "lower" },
    trainingRoi: { bounds: [0.1, 0.6, 1.1, 2.1], direction: "higher" },
  } as const;

  const validated = validateReportSettingsThresholds(submittedThresholds);
  assert.ok(!validated.error);
  assert.deepEqual(validated.thresholds, submittedThresholds);

  const scorecard = buildScorecard(
    {},
    { commercial: { ltvCacRatio: 3.05 } },
    { ...BASE_THRESHOLDS, ...validated.thresholds },
  );
  const ltvCac = scorecard.indicators.find((item) => item.key === "ltvCacRatio");
  assert.deepEqual(ltvCac?.thresholds, submittedThresholds.ltvCacRatio);
  assert.equal(ltvCac?.level, 2);
});