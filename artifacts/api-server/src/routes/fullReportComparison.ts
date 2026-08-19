/**
 * Pure helpers for the scorecard evolution / comparison logic.
 * Kept in a separate module so they can be unit-tested without the database
 * package (whose directory imports break the bare Node test runner).
 */
import type { buildScorecard } from "./fullReportMetrics.ts";

export type Scorecard = ReturnType<typeof buildScorecard>;

export type ScorecardComparison = {
  period: string;
  source: "saved_report" | "calculated_from_data";
  scorecard: Scorecard;
};

/**
 * Type-guard: returns true when `value` looks like a full Scorecard object
 * (i.e. has both `indicators` and `engines` arrays).
 */
export function isScorecard(value: unknown): value is Scorecard {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { indicators?: unknown; engines?: unknown };
  return Array.isArray(candidate.indicators) && Array.isArray(candidate.engines);
}

/**
 * Given a list of periods sorted **descending** (most-recent first) and the
 * current period, return the period string that immediately precedes it
 * chronologically.
 *
 * The current period may not be present in the list (e.g. it was opened for
 * editing before any data was saved) — in that case we fall back to the first
 * element in the list that is lexicographically less than the current period.
 *
 * Periods are expected to follow a YYYY-MM or YYYY-MM-DD format so that
 * lexicographic ordering matches chronological ordering.
 */
export function findPreviousPeriod(
  periodsDescending: string[],
  currentPeriod: string,
): string | undefined {
  const index = periodsDescending.indexOf(currentPeriod);
  if (index >= 0) return periodsDescending[index + 1];
  return periodsDescending.find((candidate) => candidate < currentPeriod);
}
