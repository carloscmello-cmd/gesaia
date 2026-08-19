/**
 * Pure helpers for keeping the period selector in sync with the analysis
 * history panel in AnalysisPanel.
 *
 * Extracted so the synchronisation logic can be unit-tested without mounting
 * the full React component.
 */

/** Minimal shape required from the period data rows. */
export interface PeriodRow {
  period: string;
}

/** Minimal shape required from history run records. */
export interface HistoryRunRef {
  period: string;
}

/**
 * Build the ordered list of period options shown in the selector.
 *
 * Merges saved period rows with any additional periods that exist only in the
 * analysis history (e.g. a period whose data row was deleted after the run).
 * The result is de-duplicated and preserves insertion order: saved rows first,
 * then history-only extras.
 */
export function derivePeriodOptions(
  periods: PeriodRow[],
  historyRuns: HistoryRunRef[],
): string[] {
  return Array.from(
    new Set([
      ...periods.map(({ period }) => period),
      ...historyRuns.map(({ period }) => period),
    ]),
  );
}

/**
 * Resolve the effective (displayed) period.
 *
 * Priority:
 * 1. An explicit user/history selection (`selectedPeriod` when non-empty).
 * 2. The first saved period row.
 * 3. The first history-run period.
 * 4. Empty string when no data is available.
 */
export function deriveEffectivePeriod(
  selectedPeriod: string,
  periods: PeriodRow[],
  historyRuns: HistoryRunRef[],
): string {
  return selectedPeriod || periods[0]?.period || historyRuns[0]?.period || "";
}

/**
 * Return the period that the selector should display when the user selects a
 * historical run.  This is simply the run's own period string, but extracting
 * it here makes the intent explicit and testable.
 */
export function syncPeriodFromHistoryRun(run: HistoryRunRef): string {
  return run.period;
}
