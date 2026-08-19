import assert from "node:assert/strict";
import test from "node:test";
import {
  latestCompletedFullAnalysisAt,
  needsReanalysis,
} from "./periodAnalysisStatus.ts";

test("marks a period as stale when its data changed after the latest calculation", () => {
  assert.equal(
    needsReanalysis("2026-08-19T11:00:00.000Z", "2026-08-19T10:00:00.000Z"),
    true,
  );
});

test("keeps a period current when its latest calculation is as new as its data", () => {
  assert.equal(
    needsReanalysis("2026-08-19T10:00:00.000Z", "2026-08-19T10:00:00.000Z"),
    false,
  );
  assert.equal(
    needsReanalysis("2026-08-19T10:00:00.000Z", "2026-08-19T11:00:00.000Z"),
    false,
  );
});

test("marks a period with no calculation as needing analysis", () => {
  assert.equal(needsReanalysis("2026-08-19T10:00:00.000Z", null), true);
});

test("does not let a newer partial spot-check replace the latest full analysis", () => {
  const runs = [
    {
      status: "completed",
      createdAt: "2026-08-19T12:00:00.000Z",
      results: { runType: "partial", engineResults: { financial: { score: 72 } } },
    },
    {
      status: "completed",
      createdAt: "2026-08-19T10:00:00.000Z",
      results: { runType: "full", findings: [], blufRecommendation: "" },
    },
  ];

  const latestFullAnalysisAt = latestCompletedFullAnalysisAt(runs);
  assert.equal(latestFullAnalysisAt, "2026-08-19T10:00:00.000Z");
  assert.equal(needsReanalysis("2026-08-19T11:00:00.000Z", latestFullAnalysisAt), true);
});

test("uses a newer completed full analysis to clear the stale status", () => {
  const latestFullAnalysisAt = latestCompletedFullAnalysisAt([
    {
      status: "completed",
      createdAt: "2026-08-19T12:00:00.000Z",
      results: { runType: "full", findings: [], blufRecommendation: "" },
    },
    {
      status: "completed",
      createdAt: "2026-08-19T11:00:00.000Z",
      results: { runType: "partial", engineResults: { financial: { score: 72 } } },
    },
  ]);

  assert.equal(needsReanalysis("2026-08-19T11:00:00.000Z", latestFullAnalysisAt), false);
});

test("keeps a full analysis even when newer partial runs exceed the history window", () => {
  const fullAnalysisAt = "2026-08-19T09:00:00.000Z";
  const newerPartialRuns = Array.from({ length: 51 }, (_, index) => ({
    status: "completed",
    createdAt: `2026-08-19T10:00:${String(index).padStart(2, "0")}.000Z`,
    results: { runType: "partial", engineResults: { financial: { score: 72 } } },
  }));

  const latestFullAnalysisAt = latestCompletedFullAnalysisAt([
    { status: "completed", createdAt: fullAnalysisAt, results: { runType: "full", findings: [] } },
    ...newerPartialRuns,
  ]);

  assert.equal(latestFullAnalysisAt, fullAnalysisAt);
});
