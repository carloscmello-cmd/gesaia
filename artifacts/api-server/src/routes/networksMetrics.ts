export type Metrics = {
  netRevenue: number | null;
  mcPct: number | null;
  ebitPct: number | null;
  ebitdaPct: number | null;
  netProfitPct: number | null;
  cashCycle: number | null;
  nps: number | null;
  churnPct: number | null;
  averageTicket: number | null;
  activeCustomers: number | null;
  activeCustomersGrowthPct: number | null;
};

export const METRIC_DEFS: { key: keyof Metrics; label: string; higherIsBetter: boolean }[] = [
  { key: "mcPct",        label: "MC %",                   higherIsBetter: true  },
  { key: "ebitPct",      label: "Margem Operacional",      higherIsBetter: true  },
  { key: "ebitdaPct",    label: "EBITDA %",               higherIsBetter: true  },
  { key: "netProfitPct", label: "Margem Líquida",          higherIsBetter: true  },
  { key: "cashCycle",    label: "Ciclo de Caixa (dias)",   higherIsBetter: false },
  { key: "nps",          label: "NPS",                    higherIsBetter: true  },
  { key: "churnPct",     label: "Churn %",                higherIsBetter: false },
  { key: "averageTicket",label: "Ticket Médio",            higherIsBetter: true  },
  { key: "activeCustomersGrowthPct", label: "Clientes Ativos (cresc. %)", higherIsBetter: true },
];

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const numberValue = Number(value);
  return Number.isNaN(numberValue) ? null : numberValue;
}

export function computeMetrics(d: Record<string, unknown>, prev?: Record<string, unknown>): Metrics {
  const nr = toNumber(d.netRevenue);
  const cogs = toNumber(d.cogs);
  const vc = toNumber(d.variableCosts);
  const fc = toNumber(d.fixedCosts);
  const da = toNumber(d.depreciationAmortization) ?? 0;
  const np = toNumber(d.netProfit);
  const pmr = toNumber(d.pmr);
  const pmp = toNumber(d.pmp);
  const pme = toNumber(d.pme);
  const grossProfit = nr != null && cogs != null ? nr - cogs : null;
  const cm = nr != null && vc != null ? nr - vc : null;
  const ebit = grossProfit != null && fc != null && vc != null ? grossProfit - fc - vc : null;

  const activeCustomers = toNumber(d.activeCustomers);
  const previousActiveCustomers = prev ? toNumber(prev.activeCustomers) : null;

  return {
    netRevenue: nr,
    mcPct: cm != null && nr != null && nr > 0 ? (cm / nr) * 100 : null,
    ebitPct: ebit != null && nr != null && nr > 0 ? (ebit / nr) * 100 : null,
    ebitdaPct: ebit != null && nr != null && nr > 0 ? ((ebit + da) / nr) * 100 : null,
    netProfitPct: np != null && nr != null && nr > 0 ? (np / nr) * 100 : null,
    cashCycle: pmr != null && pmp != null && pme != null ? pmr + pme - pmp : null,
    nps: toNumber(d.nps),
    churnPct: toNumber(d.churnRate) != null ? toNumber(d.churnRate)! * 100 : null,
    averageTicket: toNumber(d.averageTicket),
    activeCustomers,
    activeCustomersGrowthPct: activeCustomers != null && previousActiveCustomers != null && previousActiveCustomers > 0
      ? ((activeCustomers - previousActiveCustomers) / previousActiveCustomers) * 100
      : null,
  };
}

export type GoldStandard = Record<string, { value: number; companyId: number; companyName: string }>;

export function computeGoldStandard(units: { companyId: number; companyName: string; metrics: Metrics }[]): GoldStandard {
  const gold: GoldStandard = {};
  for (const def of METRIC_DEFS) {
    let best: { value: number; companyId: number; companyName: string } | null = null;
    for (const unit of units) {
      const value = unit.metrics[def.key];
      if (value == null) continue;
      if (!best || (def.higherIsBetter ? value > best.value : value < best.value)) {
        best = { value, companyId: unit.companyId, companyName: unit.companyName };
      }
    }
    if (best) gold[def.key] = best;
  }
  return gold;
}

export function computeGaps(metrics: Metrics, gold: GoldStandard): Record<string, number | null> {
  const gaps: Record<string, number | null> = {};
  for (const def of METRIC_DEFS) {
    const metricValue = metrics[def.key];
    const goldValue = gold[def.key]?.value;
    if (metricValue == null || goldValue == null) {
      gaps[def.key] = null;
      continue;
    }
    // Positive means above gold (normally impossible), negative means below it.
    gaps[def.key] = def.higherIsBetter ? metricValue - goldValue : goldValue - metricValue;
  }
  return gaps;
}

export function computeGapsPct(gaps: Record<string, number | null>, gold: GoldStandard): Record<string, number | null> {
  const gapsPct: Record<string, number | null> = {};
  for (const def of METRIC_DEFS) {
    const gap = gaps[def.key];
    const goldValue = gold[def.key]?.value;
    // A zero gold value has no meaningful relative baseline. abs() keeps the
    // sign of the gap meaningful when the gold value itself is negative.
    gapsPct[def.key] = gap != null && goldValue != null && Math.abs(goldValue) > 1e-9
      ? (gap / Math.abs(goldValue)) * 100
      : null;
  }
  return gapsPct;
}

export function computeBenchmark(units: { metrics: Metrics }[]): Record<string, number | null> {
  const benchmark: Record<string, number | null> = {};
  for (const def of METRIC_DEFS) {
    const values = units
      .map((unit) => unit.metrics[def.key])
      .filter((value): value is number => value != null);
    benchmark[def.key] = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }
  return benchmark;
}

export function findPreviousPeriod(periods: string[], period: string): string | null {
  const sorted = [...new Set(periods)].sort();
  const index = sorted.indexOf(period);
  return index > 0 ? sorted[index - 1] : null;
}