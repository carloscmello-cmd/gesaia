import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { GapHistoryChart } from "./NetworkDiagnosisPanel.tsx";

const metricDefs = [
  { key: "mcPct", label: "Margem de contribuição", higherIsBetter: true },
];

function historyWithBaseCounts(counts: number[]) {
  return {
    networkId: 1,
    metricDefs,
    points: counts.map((goldStandardUnitCount, index) => ({
      period: `2025-0${index + 1}`,
      unitsWithData: goldStandardUnitCount,
      goldStandardUnitCount,
      units: [1, 2, 3].map((companyId) => ({
        companyId,
        companyName: `Unidade ${String.fromCharCode(64 + companyId)}`,
        hasData: true,
        gapsPct: { mcPct: companyId * 2 },
      })),
    })),
  };
}

function renderHistory(counts: number[]) {
  return renderToStaticMarkup(
    <GapHistoryChart
      history={historyWithBaseCounts(counts)}
      error={null}
      selectedMetric="mcPct"
      onMetricChange={() => {}}
    />,
  );
}

test("keeps the benchmark-base change warning visible with the affected period and counts", () => {
  const markup = renderHistory([3, 2, 2]);

  assert.match(markup, /A base do Padrão Ouro mudou durante o histórico/);
  assert.match(markup, /em 2025-02 \(3 → 2 unidades\)/);
});

test("does not show a benchmark-base warning when contributor counts stay unchanged", () => {
  const markup = renderHistory([3, 3, 3]);

  assert.doesNotMatch(markup, /A base do Padrão Ouro mudou durante o histórico/);
});