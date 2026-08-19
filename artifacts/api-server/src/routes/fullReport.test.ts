/**
 * Tests for the scorecard evolution helpers in fullReport.ts.
 *
 * These are the pure/exported pieces of the previous-scorecard comparison
 * logic — the rest of the module relies on database access and is covered
 * by integration tests.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { findPreviousPeriod, isScorecard } from "./fullReportComparison.ts";
import { BASE_THRESHOLDS, buildScorecard } from "./fullReportMetrics.ts";

// ── findPreviousPeriod ────────────────────────────────────────────────────────

test("findPreviousPeriod: returns the period immediately before the current one", () => {
  const periods = ["2024-06", "2024-03", "2023-12", "2023-09"];
  assert.equal(findPreviousPeriod(periods, "2024-06"), "2024-03");
  assert.equal(findPreviousPeriod(periods, "2024-03"), "2023-12");
  assert.equal(findPreviousPeriod(periods, "2023-12"), "2023-09");
});

test("findPreviousPeriod: returns undefined for the oldest period in the list", () => {
  const periods = ["2024-06", "2024-03", "2023-12"];
  assert.equal(findPreviousPeriod(periods, "2023-12"), undefined);
});

test("findPreviousPeriod: handles an empty list", () => {
  assert.equal(findPreviousPeriod([], "2024-06"), undefined);
});

test("findPreviousPeriod: handles a single-element list when that element is the current period", () => {
  assert.equal(findPreviousPeriod(["2024-06"], "2024-06"), undefined);
});

test("findPreviousPeriod: falls back to the closest earlier period when current period is absent", () => {
  // The current period was opened for editing but has no companyData row yet.
  const periods = ["2024-03", "2023-12", "2023-09"];
  assert.equal(findPreviousPeriod(periods, "2024-06"), "2024-03");
});

test("findPreviousPeriod: returns undefined when current period is absent and older than all data", () => {
  const periods = ["2024-06", "2024-03"];
  assert.equal(findPreviousPeriod(periods, "2022-01"), undefined);
});

test("findPreviousPeriod: handles non-monthly periods (quarterly)", () => {
  const periods = ["2024-Q4", "2024-Q3", "2024-Q2", "2024-Q1"];
  assert.equal(findPreviousPeriod(periods, "2024-Q3"), "2024-Q2");
});

test("findPreviousPeriod: duplicate entries are handled when caller deduplicates", () => {
  // The actual caller uses [...new Set(...)], but test shows the helper itself
  // handles the first match even with duplicates.
  const periods = ["2024-06", "2024-06", "2024-03"];
  // First index is 0 → previous is index 1, which is the duplicate "2024-06".
  // With deduplicated input the duplicate wouldn't exist; this test documents
  // that callers must deduplicate before calling.
  const deduped = [...new Set(periods)];
  assert.equal(findPreviousPeriod(deduped, "2024-06"), "2024-03");
});

// ── isScorecard ───────────────────────────────────────────────────────────────

test("isScorecard: accepts a valid scorecard shape", () => {
  const sc = buildScorecard({ churnRate: 5 }, { financial: { safetyMargin: 10 } }, BASE_THRESHOLDS);
  assert.ok(isScorecard(sc));
});

test("isScorecard: rejects null, undefined, and primitives", () => {
  assert.ok(!isScorecard(null));
  assert.ok(!isScorecard(undefined));
  assert.ok(!isScorecard(42));
  assert.ok(!isScorecard("scorecard"));
});

test("isScorecard: rejects objects missing indicators or engines arrays", () => {
  assert.ok(!isScorecard({}));
  assert.ok(!isScorecard({ indicators: [] }));
  assert.ok(!isScorecard({ engines: [] }));
  assert.ok(!isScorecard({ indicators: "not-an-array", engines: [] }));
});

test("isScorecard: accepts objects that have both indicators and engines arrays", () => {
  assert.ok(isScorecard({ indicators: [], engines: [] }));
  assert.ok(isScorecard({ indicators: [{ key: "x" }], engines: [{ key: "y" }] }));
});

// ── Delta logic (via buildScorecard) ─────────────────────────────────────────
// The ScoreRow component only shows a delta arrow when both the current item
// and the previous item have a non-null `level`.  These tests verify that
// buildScorecard produces null levels for unclassified indicators so that the
// delta computation in ScoreRow never shows a misleading arrow.

test("buildScorecard: indicators with no data produce null level", () => {
  const sc = buildScorecard(
    { churnRate: 5 }, // only churnRate provided
    { financial: {} },
    BASE_THRESHOLDS,
  );
  const nps = sc.indicators.find((i) => i.key === "nps");
  assert.equal(nps?.level, null, "nps has no data → level should be null");
  assert.equal(nps?.levelLabel, "Dados não informados");
  assert.equal(nps?.emoji, "⚪");
});

test("buildScorecard: engines with status no_data produce null level", () => {
  const sc = buildScorecard(
    {},
    { marketing: { status: "no_data", score: 99 } },
    BASE_THRESHOLDS,
  );
  const marketing = sc.engines.find((e) => e.key === "marketing");
  assert.equal(marketing?.level, null, "no_data engine → level should be null");
});

test("buildScorecard: comparison between two periods with one unclassified indicator has null delta potential", () => {
  // Current period has nps data; previous period does not.
  const current = buildScorecard(
    { nps: 60 },
    { financial: {} },
    BASE_THRESHOLDS,
  );
  const previous = buildScorecard(
    {}, // nps absent
    { financial: {} },
    BASE_THRESHOLDS,
  );

  const curNps = current.indicators.find((i) => i.key === "nps");
  const prevNps = previous.indicators.find((i) => i.key === "nps");

  assert.equal(curNps?.level, 3, "nps=60 should be 'bom'");
  assert.equal(prevNps?.level, null, "nps absent in previous → null level");

  // Simulate the ScoreRow delta guard: delta is only computed when both
  // levels are non-null. With prevNps.level === null, delta would be null
  // and no arrow would be shown.
  const delta =
    curNps?.level != null && prevNps?.level != null
      ? curNps.level - prevNps.level
      : null;
  assert.equal(delta, null, "no delta should be produced when previous level is null");
});

test("buildScorecard: comparison between two periods where current loses data does not produce misleading delta", () => {
  const current = buildScorecard(
    {}, // nps absent this period
    { financial: {} },
    BASE_THRESHOLDS,
  );
  const previous = buildScorecard(
    { nps: 60 },
    { financial: {} },
    BASE_THRESHOLDS,
  );

  const curNps = current.indicators.find((i) => i.key === "nps");
  const prevNps = previous.indicators.find((i) => i.key === "nps");

  assert.equal(curNps?.level, null);
  assert.equal(prevNps?.level, 3);

  const delta =
    curNps?.level != null && prevNps?.level != null
      ? curNps.level - prevNps.level
      : null;
  assert.equal(delta, null, "no delta when current level is null");
});
