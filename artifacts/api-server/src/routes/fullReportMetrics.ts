export type Threshold = {
  bounds: [number, number, number, number];
  direction: "higher" | "lower";
};

export const ENGINE_NAMES = [
  "financial",
  "commercial",
  "marketing",
  "operations",
  "hr",
  "risks",
  "innovation",
  "market_intelligence",
  "network",
  "strategy",
] as const;

const ENGINE_TITLES: Record<string, string> = {
  financial: "Financeiro",
  commercial: "Comercial",
  marketing: "Marketing",
  operations: "Operações",
  hr: "Pessoas (RH)",
  risks: "Riscos",
  innovation: "Inovação",
  market_intelligence: "Inteligência de Mercado",
  network: "Rede",
  strategy: "Estratégia",
};

export const INDICATOR_DEFS: {
  key: string;
  label: string;
  unit: "%" | "dias" | "pts" | "x";
  engine: "financial" | "commercial" | "marketing" | "operations" | "hr";
}[] = [
  // Financeiro
  { key: "safetyMargin", label: "Margem de Segurança", unit: "%", engine: "financial" },
  { key: "ebitdaMargin", label: "Margem EBITDA", unit: "%", engine: "financial" },
  { key: "mcPct", label: "Margem de Contribuição", unit: "%", engine: "financial" },
  { key: "cashCycle", label: "Ciclo de Caixa", unit: "dias", engine: "financial" },
  { key: "markupOnCogs", label: "Markup sobre CMV", unit: "%", engine: "financial" },
  // Comercial
  { key: "churnRate", label: "Churn mensal", unit: "%", engine: "commercial" },
  { key: "conversionRate", label: "Taxa de Conversão", unit: "%", engine: "commercial" },
  { key: "ltvCacRatio", label: "LTV:CAC", unit: "x", engine: "commercial" },
  // Marketing
  { key: "nps", label: "NPS", unit: "pts", engine: "marketing" },
  { key: "defaultRate", label: "Inadimplência", unit: "%", engine: "marketing" },
  { key: "roas", label: "ROAS", unit: "x", engine: "marketing" },
  // Operações
  { key: "oeeIndex", label: "OEE", unit: "%", engine: "operations" },
  { key: "capacityUtilization", label: "Utilização de Capacidade", unit: "%", engine: "operations" },
  // RH
  { key: "turnoverCostRevenuePct", label: "Custo de Turnover (% rec.)", unit: "%", engine: "hr" },
  { key: "trainingRoi", label: "ROI de Treinamento", unit: "x", engine: "hr" },
];

export const BASE_THRESHOLDS: Record<string, Threshold> = {
  // Financeiro
  safetyMargin:           { bounds: [0, 10, 20, 35],   direction: "higher" },
  ebitdaMargin:           { bounds: [0, 5, 10, 20],    direction: "higher" },
  mcPct:                  { bounds: [20, 35, 50, 65],  direction: "higher" },
  cashCycle:              { bounds: [60, 30, 15, 0],   direction: "lower"  },
  markupOnCogs:           { bounds: [30, 50, 80, 120], direction: "higher" },
  // Comercial
  churnRate:              { bounds: [10, 5, 3, 1],     direction: "lower"  },
  conversionRate:         { bounds: [1, 3, 7, 15],     direction: "higher" },
  ltvCacRatio:            { bounds: [1, 1.5, 3, 5],    direction: "higher" },
  // Marketing
  nps:                    { bounds: [0, 25, 50, 75],   direction: "higher" },
  defaultRate:            { bounds: [10, 5, 3, 1],     direction: "lower"  },
  roas:                   { bounds: [1, 2, 4, 8],      direction: "higher" },
  // Operações
  oeeIndex:               { bounds: [40, 55, 65, 85],  direction: "higher" },
  capacityUtilization:    { bounds: [30, 50, 70, 85],  direction: "higher" },
  // RH
  turnoverCostRevenuePct: { bounds: [20, 10, 5, 2],    direction: "lower"  },
  trainingRoi:            { bounds: [0, 0.5, 1, 2],    direction: "higher" },
};

const LEVEL_META = [
  { key: "critico", label: "Crítico", emoji: "🔴" },
  { key: "ruim", label: "Ruim", emoji: "🟠" },
  { key: "aceitavel", label: "Aceitável", emoji: "🟡" },
  { key: "bom", label: "Bom", emoji: "🟢" },
  { key: "excelente", label: "Excelente", emoji: "⭐" },
] as const;

const CHECKLIST: { group: string; fields: { key: string; label: string }[] }[] = [
  {
    group: "DRE (Resultado)",
    fields: [
      { key: "grossRevenue", label: "Receita Bruta" },
      { key: "netRevenue", label: "Receita Líquida" },
      { key: "cogs", label: "CMV/CPV" },
      { key: "variableCosts", label: "Custos Variáveis" },
      { key: "fixedCosts", label: "Custos Fixos" },
      { key: "netProfit", label: "Lucro Líquido" },
    ],
  },
  {
    group: "Ciclo Financeiro",
    fields: [
      { key: "pmr", label: "PMR (Prazo Médio de Recebimento)" },
      { key: "pmp", label: "PMP (Prazo Médio de Pagamento)" },
      { key: "pme", label: "PME (Prazo Médio de Estoque)" },
    ],
  },
  {
    group: "Comercial e Clientes",
    fields: [
      { key: "activeCustomers", label: "Clientes Ativos" },
      { key: "averageTicket", label: "Ticket Médio" },
      { key: "conversionRate", label: "Taxa de Conversão" },
      { key: "churnRate", label: "Churn" },
      { key: "nps", label: "NPS" },
      { key: "defaultRate", label: "Inadimplência" },
    ],
  },
  {
    group: "Pessoas",
    fields: [
      { key: "totalEmployees", label: "Total de Colaboradores" },
      { key: "proLabore", label: "Pró-labore dos Sócios" },
    ],
  },
];

// score levels: 0 crítico | 1 ruim | 2 aceitável | 3 bom | 4 excelente
export function classify(value: number | null, threshold: Threshold): number | null {
  if (value == null) return null;
  const [b0, b1, b2, b3] = threshold.bounds;
  if (threshold.direction === "higher") {
    if (value < b0) return 0;
    if (value < b1) return 1;
    if (value < b2) return 2;
    if (value < b3) return 3;
    return 4;
  }
  if (value > b0) return 0;
  if (value > b1) return 1;
  if (value > b2) return 2;
  if (value > b3) return 3;
  return 4;
}

function classifyEngineScore(score: number | null): number | null {
  if (score == null) return null;
  if (score < 25) return 0;
  if (score < 45) return 1;
  if (score < 65) return 2;
  if (score < 85) return 3;
  return 4;
}

function toNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const numberValue = Number(value);
  return Number.isNaN(numberValue) ? null : numberValue;
}

export function buildChecklist(data: Record<string, unknown> | null | undefined) {
  return CHECKLIST.map((group) => ({
    group: group.group,
    fields: group.fields.map((field) => ({
      ...field,
      filled: data != null && data[field.key] !== null && data[field.key] !== undefined,
    })),
  }));
}

function computeIndicators(
  data: Record<string, unknown> | null | undefined,
  engineResults: Record<string, unknown>,
) {
  const financial   = (engineResults.financial   ?? {}) as Record<string, unknown>;
  const commercial  = (engineResults.commercial  ?? {}) as Record<string, unknown>;
  const marketing   = (engineResults.marketing   ?? {}) as Record<string, unknown>;
  const operations  = (engineResults.operations  ?? {}) as Record<string, unknown>;
  const hr          = (engineResults.hr          ?? {}) as Record<string, unknown>;

  return {
    // Financeiro
    safetyMargin:           toNum(financial.safetyMargin),
    ebitdaMargin:           toNum(financial.ebitdaMargin),
    mcPct:                  toNum(financial.contributionMarginPct),
    cashCycle:              toNum(financial.cashCycle),
    markupOnCogs:           toNum(financial.markupOnCogs),
    // Comercial
    churnRate:              toNum(data?.churnRate),
    conversionRate:         toNum(data?.conversionRate),
    ltvCacRatio:            toNum(commercial.ltvCacRatio),
    // Marketing
    nps:                    toNum(data?.nps),
    defaultRate:            toNum(data?.defaultRate),
    roas:                   toNum(marketing.roas),
    // Operações
    oeeIndex:               toNum(operations.oeeIndex),
    capacityUtilization:    toNum(operations.capacityUtilization),
    // RH
    turnoverCostRevenuePct: toNum(hr.turnoverCostRevenuePercent),
    trainingRoi:            toNum(hr.trainingRoi),
  } as Record<string, number | null>;
}

export function buildScorecard(
  data: Record<string, unknown> | null | undefined,
  engineResults: Record<string, unknown>,
  thresholds: Record<string, Threshold>,
) {
  const values = computeIndicators(data, engineResults);

  const indicators = INDICATOR_DEFS.map((definition) => {
    const threshold = thresholds[definition.key] ?? BASE_THRESHOLDS[definition.key];
    const value = values[definition.key];
    const level = classify(value, threshold);
    return {
      key: definition.key,
      label: definition.label,
      unit: definition.unit,
      engine: definition.engine,
      value,
      level,
      levelKey: level != null ? LEVEL_META[level].key : null,
      levelLabel: level != null ? LEVEL_META[level].label : "Dados não informados",
      emoji: level != null ? LEVEL_META[level].emoji : "⚪",
      thresholds: threshold,
    };
  }).sort((a, b) => (a.level ?? 99) - (b.level ?? 99));

  const engines = ENGINE_NAMES.map((name) => {
    const result = engineResults[name] as Record<string, unknown> | undefined;
    const score = result && result.status !== "no_data" ? toNum(result.score) : null;
    const level = classifyEngineScore(score);
    return {
      key: name,
      label: ENGINE_TITLES[name] ?? name,
      score,
      level,
      levelKey: level != null ? LEVEL_META[level].key : null,
      levelLabel: level != null ? LEVEL_META[level].label : "Dados não informados",
      emoji: level != null ? LEVEL_META[level].emoji : "⚪",
    };
  }).sort((a, b) => (a.level ?? 99) - (b.level ?? 99));

  return { indicators, engines };
}