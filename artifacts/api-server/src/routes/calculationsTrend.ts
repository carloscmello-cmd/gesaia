/**
 * Pure trend-analysis helpers — no database or framework imports.
 * Kept in a separate module so unit tests can import it directly without
 * triggering the ESM directory-import error that comes from @workspace/db.
 */

export type TrendMetricName =
  | "netRevenue"
  | "contributionMargin"
  | "contributionMarginPct"
  | "fixedCosts"
  | "operatingResult"
  | "ebitda"
  | "netProfit"
  | "activeCustomers"
  | "averageTicket"
  | "safetyMargin"
  | "cashCycle";

export type TrendMetric = {
  value: number | null;
  delta: number | null;
  deltaPct: number | null;
  unavailableReason: "missing_inputs" | "not_applicable" | null;
  missingInputs: string[];
};

export const TREND_METRICS: TrendMetricName[] = [
  "netRevenue",
  "contributionMargin",
  "contributionMarginPct",
  "fixedCosts",
  "operatingResult",
  "ebitda",
  "netProfit",
  "activeCustomers",
  "averageTicket",
  "safetyMargin",
  "cashCycle",
];

export function periodSortKey(period: string): string {
  return period.trim();
}

function getExpectedMonthlyPeriods(periodStart: string, periodEnd: string): string[] | null {
  const parsePeriod = (period: string) => {
    const match = /^(\d{4})-(\d{2})$/.exec(period);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    return month >= 1 && month <= 12 ? { year, month } : null;
  };
  const start = parsePeriod(periodStart);
  const end = parsePeriod(periodEnd);
  if (!start || !end) return null;

  const startIndex = start.year * 12 + start.month - 1;
  const endIndex = end.year * 12 + end.month - 1;
  if (startIndex > endIndex) return null;

  return Array.from({ length: endIndex - startIndex + 1 }, (_, index) => {
    const value = startIndex + index;
    return `${Math.floor(value / 12)}-${String((value % 12) + 1).padStart(2, "0")}`;
  });
}

export function roundTrendValue(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

type TrendMetricValue = Pick<TrendMetric, "value" | "unavailableReason" | "missingInputs">;

export function getTrendMetricValue(row: any, metric: TrendMetricName): number | null {
  return getTrendMetricResult(row, metric).value;
}

export function getTrendMetricResult(row: any, metric: TrendMetricName): TrendMetricValue {
  const n = (key: string) => {
    const value = row?.[key];
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const netRevenue = n("netRevenue");
  const variableCosts = n("variableCosts");
  const fixedCosts = n("fixedCosts");
  const contributionMargin = netRevenue !== null && variableCosts !== null
    ? netRevenue - variableCosts
    : null;
  const available = (value: number | null): TrendMetricValue => ({
    value,
    unavailableReason: null,
    missingInputs: [],
  });

  switch (metric) {
    case "netRevenue": return available(netRevenue);
    case "contributionMargin": return available(contributionMargin);
    case "contributionMarginPct":
      return available(contributionMargin !== null && netRevenue !== null && netRevenue !== 0
        ? (contributionMargin / netRevenue) * 100
        : null);
    case "fixedCosts": return available(fixedCosts);
    case "operatingResult":
      return available(contributionMargin !== null && fixedCosts !== null
        ? contributionMargin - fixedCosts
        : null);
    case "ebitda": return available(n("ebitda"));
    case "netProfit": return available(n("netProfit"));
    case "activeCustomers": return available(n("activeCustomers"));
    case "averageTicket": return available(n("averageTicket"));
    case "safetyMargin": {
      const netRevSM = n("netRevenue");
      const variableCostsSM = n("variableCosts");
      const fixedCostsSM = n("fixedCosts");
      if (netRevSM === null || variableCostsSM === null || fixedCostsSM === null) {
        const missingInputs = [
          netRevSM === null ? "netRevenue" : null,
          variableCostsSM === null ? "variableCosts" : null,
          fixedCostsSM === null ? "fixedCosts" : null,
        ].filter((input): input is string => input !== null);
        return { value: null, unavailableReason: "missing_inputs", missingInputs };
      }

      const mcSM = netRevSM - variableCostsSM;
      if (netRevSM <= 0 || mcSM <= 0) {
        return { value: null, unavailableReason: "not_applicable", missingInputs: [] };
      }

      const peSM = fixedCostsSM / (mcSM / netRevSM);
      return available(((netRevSM - peSM) / netRevSM) * 100);
    }
    case "cashCycle": {
      const pmr = n("pmr");
      const pme = n("pme");
      const pmp = n("pmp");
      const operatingCycleTrend = pmr !== null && pme !== null ? pmr + pme : null;
      return available(operatingCycleTrend !== null && pmp !== null ? operatingCycleTrend - pmp : null);
    }
  }
}

export function buildTrendAnalysis(periodStart: string, periodEnd: string, rows: any[]) {
  const startKey = periodSortKey(periodStart);
  const endKey = periodSortKey(periodEnd);
  if (startKey === endKey) {
    return { status: 400, error: "Selecione períodos inicial e final diferentes" } as const;
  }
  if (startKey.localeCompare(endKey, undefined, { numeric: true }) > 0) {
    return { status: 400, error: "O período inicial deve ser anterior ao período final" } as const;
  }

  const selectedRows = rows
    .filter((row) => {
      const key = periodSortKey(row.period);
      return key.localeCompare(startKey, undefined, { numeric: true }) >= 0
        && key.localeCompare(endKey, undefined, { numeric: true }) <= 0;
    })
    .sort((a, b) => periodSortKey(a.period).localeCompare(periodSortKey(b.period), undefined, { numeric: true }));

  if (!selectedRows.some((row) => row.period === periodStart) || !selectedRows.some((row) => row.period === periodEnd)) {
    return { status: 404, error: "Dados não encontrados para o período inicial ou final" } as const;
  }
  if (selectedRows.length < 3) {
    return { status: 400, error: "A tendência precisa de pelo menos 3 períodos com dados no intervalo" } as const;
  }
  const expectedPeriods = getExpectedMonthlyPeriods(periodStart, periodEnd);
  if (expectedPeriods && !expectedPeriods.every((period) => selectedRows.some((row) => row.period === period))) {
    return { status: 404, error: "Dados não encontrados para todos os períodos do intervalo contínuo" } as const;
  }

  const previousValues: Partial<Record<TrendMetricName, number | null>> = {};
  const periods = selectedRows.map((row) => {
    const metrics = {} as Record<TrendMetricName, TrendMetric>;
    for (const metric of TREND_METRICS) {
      const result = getTrendMetricResult(row, metric);
      const value = roundTrendValue(result.value);
      const previous = previousValues[metric] ?? null;
      const delta = value !== null && previous !== null ? roundTrendValue(value - previous) : null;
      const deltaPct = delta !== null && previous !== null && previous !== 0
        ? roundTrendValue((delta / Math.abs(previous)) * 100)
        : null;
      metrics[metric] = {
        value,
        delta,
        deltaPct,
        unavailableReason: result.unavailableReason,
        missingInputs: result.missingInputs,
      };
      previousValues[metric] = value;
    }
    return { period: row.period, metrics };
  });

  return { periodStart, periodEnd, periods };
}
