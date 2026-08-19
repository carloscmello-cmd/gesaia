export type PeriodReference = {
  period: string;
};

export type StaleComparisonPeriod = {
  base?: string;
  comp?: string;
} | null;

type ResolveStaleComparisonPeriodInput = {
  periodBase: string;
  periodComp: string;
  periods: readonly PeriodReference[];
  periodsSuccess: boolean;
};

/**
 * Finds URL-backed comparison periods that are no longer available.
 *
 * An empty period list is treated as not ready, even when a successful query
 * has returned no rows. This prevents a loading/empty state from being
 * mistaken for deleted periods.
 */
export function resolveStaleComparisonPeriod({
  periodBase,
  periodComp,
  periods,
  periodsSuccess,
}: ResolveStaleComparisonPeriodInput): StaleComparisonPeriod {
  if (
    !periodBase ||
    !periodComp ||
    !periodsSuccess ||
    periods.length === 0
  ) {
    return null;
  }

  const periodSet = new Set(periods.map(({ period }) => period));
  const missingBase = !periodSet.has(periodBase) ? periodBase : undefined;
  const missingComp = !periodSet.has(periodComp) ? periodComp : undefined;

  return missingBase || missingComp
    ? { base: missingBase, comp: missingComp }
    : null;
}