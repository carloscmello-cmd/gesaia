import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveDiagnosticIndicatorsForDownload,
} from "./reportDownload.ts";

test("an older saved diagnostic download recalculates detailed indicators from its selected period", async () => {
  const computedIndicators = {
    risks: {
      riskMatrix: [{
        name: "Risco recalculado",
        probability: 35,
        impact: 4_500,
        expectedLoss: 1_575,
      }],
      totalExpectedLoss: 1_575,
      overallExposure: "Alto",
    },
  };
  const requestedPeriods: string[] = [];

  const result = await resolveDiagnosticIndicatorsForDownload(
    {
      period: "2026-07",
      // This shape represents reports saved before detailed indicators existed.
    },
    async (period) => {
      requestedPeriods.push(period);
      return computedIndicators;
    },
  );

  assert.deepEqual(requestedPeriods, ["2026-07"]);
  assert.equal(result, computedIndicators);
});

test("a current saved diagnostic download keeps its detailed indicators instead of recalculating", async () => {
  const savedIndicators = {
    risks: {
      riskMatrix: [],
      totalExpectedLoss: 0,
      overallExposure: "Baixo",
    },
  };

  const result = await resolveDiagnosticIndicatorsForDownload(
    { period: "2026-07", diagnosticIndicators: savedIndicators },
    async () => {
      throw new Error("Current reports must not be recalculated");
    },
  );

  assert.equal(result, savedIndicators);
});