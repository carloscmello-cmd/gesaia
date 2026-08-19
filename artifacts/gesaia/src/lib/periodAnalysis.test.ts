import assert from "node:assert/strict";
import test from "node:test";

import { hasCompletedFullAnalysisForPeriod } from "./periodAnalysis.ts";

const selectedPeriod = "2026-08";

test("reports no analysis when the selected period has no server status", () => {
  assert.equal(hasCompletedFullAnalysisForPeriod([], selectedPeriod), false);
});

test("reports no analysis when the selected period has no completed full run", () => {
  assert.equal(
    hasCompletedFullAnalysisForPeriod(
      [{ period: selectedPeriod, latestFullAnalysisAt: null }],
      selectedPeriod,
    ),
    false,
  );
});

test("recognizes a completed full analysis for the selected period", () => {
  assert.equal(
    hasCompletedFullAnalysisForPeriod(
      [{ period: selectedPeriod, latestFullAnalysisAt: "2026-08-19T10:00:00.000Z" }],
      selectedPeriod,
    ),
    true,
  );
});

test("uses the selected period status even when many newer periods are present", () => {
  const periods = [
    { period: selectedPeriod, latestFullAnalysisAt: "2026-08-19T10:00:00.000Z" },
    ...Array.from({ length: 50 }, (_, index) => ({
      period: `2026-${String(12 - (index % 12)).padStart(2, "0")}`,
      latestFullAnalysisAt: null,
    })),
  ];

  assert.equal(hasCompletedFullAnalysisForPeriod(periods, selectedPeriod), true);
});