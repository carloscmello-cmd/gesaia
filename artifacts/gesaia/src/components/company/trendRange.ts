export const STALE_TREND_RANGE_ERROR =
  "O intervalo selecionado não é mais contínuo porque um período foi removido. Escolha um novo intervalo para continuar.";

function parseMonthlyPeriod(period: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? { year, month } : null;
}

/**
 * Returns every YYYY-MM value implied by an inclusive trend range. A null
 * result preserves the API's existing handling for non-monthly legacy data.
 */
export function getExpectedTrendPeriods(periodStart: string, periodEnd: string): string[] | null {
  const start = parseMonthlyPeriod(periodStart);
  const end = parseMonthlyPeriod(periodEnd);
  if (!start || !end) return null;

  const startIndex = start.year * 12 + start.month - 1;
  const endIndex = end.year * 12 + end.month - 1;
  if (startIndex > endIndex) return null;

  return Array.from({ length: endIndex - startIndex + 1 }, (_, index) => {
    const value = startIndex + index;
    return `${Math.floor(value / 12)}-${String((value % 12) + 1).padStart(2, "0")}`;
  });
}

/**
 * Rejects any trend response that omits a month within a YYYY-MM range.
 * This prevents a deleted middle period from being charted as a false
 * period-over-period comparison.
 */
export function validateTrendPeriodCoverage(
  periodStart: string,
  periodEnd: string,
  periods: readonly { period: string }[],
  options: { allowPeriodsOutsideRange?: boolean } = {},
): string | null {
  const expected = getExpectedTrendPeriods(periodStart, periodEnd);
  if (!expected) return null;

  const received = new Set(periods.map(({ period }) => period));
  const includesEveryExpectedPeriod = expected.every((period) => received.has(period));
  const hasOnlyExpectedPeriods = options.allowPeriodsOutsideRange || expected.length === periods.length;
  return includesEveryExpectedPeriod && hasOnlyExpectedPeriods
    ? null
    : STALE_TREND_RANGE_ERROR;
}

export function isTrendRangeNotFound(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "status" in error
    && (error as { status?: unknown }).status === 404;
}