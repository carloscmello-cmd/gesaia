import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTrendChartData,
  getSafetyMarginUnavailableMessage,
} from "./BridgePanel.tsx";

test("keeps safety-margin gaps and marks missing variable costs for chart inspection", () => {
  const chartData = buildTrendChartData([
    {
      period: "2025-01",
      metrics: {
        safetyMargin: { value: 60, delta: null, deltaPct: null },
      },
    },
    {
      period: "2025-02",
      metrics: {
        safetyMargin: {
          value: null,
          delta: null,
          deltaPct: null,
          unavailableReason: "missing_inputs",
          missingInputs: ["variableCosts"],
        },
      },
    },
    {
      period: "2025-03",
      metrics: {
        safetyMargin: { value: 60, delta: null, deltaPct: null },
      },
    },
  ]);

  assert.deepEqual(
    chartData.map(point => point.safetyMargin),
    [60, null, 60],
    "The area must retain the unavailable period as a gap rather than connect neighboring values",
  );
  assert.equal(chartData[1].safetyMarginMissingInputMarker, 0);
  assert.equal(chartData[1].safetyMarginNotApplicableMarker, null);
  assert.equal(
    chartData[1].safetyMarginUnavailableMessage,
    "Não calculada: informe Custos Variáveis para este período.",
  );
});

test("keeps non-applicable safety margins distinct from missing financial input", () => {
  const missingInput = {
    value: null,
    unavailableReason: "missing_inputs" as const,
    missingInputs: ["variableCosts"],
  };
  const notApplicable = {
    value: null,
    unavailableReason: "not_applicable" as const,
    missingInputs: [],
  };

  assert.equal(
    getSafetyMarginUnavailableMessage(missingInput),
    "Não calculada: informe Custos Variáveis para este período.",
  );
  assert.equal(
    getSafetyMarginUnavailableMessage(notApplicable),
    "Não aplicável neste período.",
  );

  const [point] = buildTrendChartData([{
    period: "2025-02",
    metrics: {
      safetyMargin: { ...notApplicable, delta: null, deltaPct: null },
    },
  }]);
  assert.equal(point.safetyMarginMissingInputMarker, null);
  assert.equal(point.safetyMarginNotApplicableMarker, 0);
});