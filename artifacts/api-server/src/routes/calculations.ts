import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { companies, companyData, calculationRuns } from "@workspace/db/schema";
import { ComparePeriodsTrendBody, ComparePeriodsTrendResponse } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import {
  buildCalculationHistory,
  findLatestFullAnalysisRun,
  FULL_ANALYSIS_ENGINE_NAMES as ENGINE_NAMES,
} from "./calculationHistory";
import {
  applyFindingPriorities,
  buildPriorityBluf,
  scorePriority,
} from "../lib/scoreThresholds";
import { findOperationsBottleneck } from "../lib/operationsBottleneck";
import { buildTrendAnalysis } from "./calculationsTrend";
import { buildBridgeAnalysis, validateBridgePeriodOrder } from "./calculationsBridge";

export { buildBridgeAnalysis };

const router = Router({ mergeParams: true });

function canAccessCompany(user: any, company: any): boolean {
  return user.role === "admin" || company.ownerId === user.id;
}

// Run a specific calculation
router.post("/:id/calculate", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }
  if (!canAccessCompany(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }

  const { period, engines } = req.body;
  const hasSupportedEngines = Array.isArray(engines)
    && engines.length > 0
    && engines.every((engine) => typeof engine === "string" && ENGINE_NAMES.includes(engine as typeof ENGINE_NAMES[number]))
    && new Set(engines).size === engines.length;
  if (!period || !hasSupportedEngines) {
    res.status(400).json({ error: "period and a non-empty, unique engines[] list of supported engines are required" });
    return;
  }

  const [dataRow] = await db.select().from(companyData)
    .where(and(eq(companyData.companyId, id), eq(companyData.period, period)))
    .limit(1);

  const results = runEngines(engines, dataRow);
  const executedAt = new Date().toISOString();
  const priorities = Object.fromEntries(
    Object.entries(results).flatMap(([engine, result]) => {
      const priority = scorePriority((result as Record<string, unknown>).score, company.scoreThresholds);
      return priority ? [[engine, priority]] : [];
    }),
  );

  await db.insert(calculationRuns).values({
    companyId: id,
    period,
    engines: engines as string[],
    status: "completed",
    results: { runType: "partial", engineResults: results },
  });

  res.json({ period, results, priorities, executedAt });
});

// Run full analysis (all engines)
// Handles both the legacy /full-analysis path and the generated-client /calculate/full path
async function runFullAnalysisHandler(req: any, res: any) {
  const user = req.dbUser;
  const id = Number(req.params.id);
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }
  if (!canAccessCompany(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }

  const { period } = req.body;
  if (!period) { res.status(400).json({ error: "period required" }); return; }

  const [dataRow] = await db.select().from(companyData)
    .where(and(eq(companyData.companyId, id), eq(companyData.period, period)))
    .limit(1);

  const engineResults = runEngines([...ENGINE_NAMES], dataRow);
  const findings = buildFindings(engineResults, dataRow, company.scoreThresholds);
  const blufRecommendation = buildBluf(findings);
  const executedAt = new Date().toISOString();

  await db.insert(calculationRuns).values({
    companyId: id,
    period,
    engines: [...ENGINE_NAMES],
    status: "completed",
    results: { runType: "full", findings, blufRecommendation },
  });

  res.json({ period, findings, blufRecommendation, executedAt });
}

router.post("/:id/full-analysis", requireAuth, runFullAnalysisHandler);
// Alias matching the generated API client contract (POST /api/companies/:id/calculate/full)
router.post("/:id/calculate/full", requireAuth, runFullAnalysisHandler);

// POST /api/companies/:id/bridge-analysis — decompõe variação entre dois períodos
router.post("/:id/bridge-analysis", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }
  if (!canAccessCompany(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }

  const { periodBase, periodComp } = req.body;
  if (!periodBase || !periodComp) {
    res.status(400).json({ error: "periodBase and periodComp required" });
    return;
  }
  const periodOrderError = validateBridgePeriodOrder(periodBase, periodComp);
  if (periodOrderError) {
    res.status(400).json({ error: periodOrderError });
    return;
  }

  const rows = await db.select().from(companyData)
    .where(and(eq(companyData.companyId, id)));

  const base = rows.find(r => r.period === periodBase);
  const comp = rows.find(r => r.period === periodComp);

  if (!base || !comp) {
    res.status(404).json({ error: "Dados não encontrados para um ou ambos os períodos" });
    return;
  }

  res.json(buildBridgeAnalysis(periodBase, periodComp, base, comp));
});

// compare-periods: canonical route for period-over-period variation analysis (waterfall/bridge)
router.post("/:id/compare-periods", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }
  if (!canAccessCompany(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }

  const { periodBase, periodComp } = req.body;
  if (!periodBase || !periodComp) {
    res.status(400).json({ error: "periodBase and periodComp required" });
    return;
  }
  const periodOrderError = validateBridgePeriodOrder(periodBase, periodComp);
  if (periodOrderError) {
    res.status(400).json({ error: periodOrderError });
    return;
  }

  const rows = await db.select().from(companyData)
    .where(and(eq(companyData.companyId, id)));

  const base = rows.find(r => r.period === periodBase);
  const comp = rows.find(r => r.period === periodComp);

  if (!base || !comp) {
    res.status(404).json({ error: "Dados não encontrados para um ou ambos os períodos" });
    return;
  }

  res.json(buildBridgeAnalysis(periodBase, periodComp, base, comp));
});

// POST /api/companies/:id/compare-periods/trend — acompanha métricas em 3+ períodos
router.post("/:id/compare-periods/trend", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }
  if (!canAccessCompany(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }

  const body = ComparePeriodsTrendBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "periodStart and periodEnd are required" });
    return;
  }
  const { periodStart, periodEnd } = body.data;
  if (!periodStart || !periodEnd) {
    res.status(400).json({ error: "periodStart and periodEnd are required" });
    return;
  }

  const rows = await db.select().from(companyData)
    .where(eq(companyData.companyId, id));
  const trend = buildTrendAnalysis(periodStart, periodEnd, rows);

  if ("error" in trend) {
    res.status(trend.status ?? 400).json({ error: trend.error });
    return;
  }

  res.json(ComparePeriodsTrendResponse.parse(trend));
});


function legacyBuildBridgeAnalysis(periodBase: string, periodComp: string, base: any, comp: any) {
  const n = (obj: any, k: string) => { const v = obj?.[k]; return v !== null && v !== undefined ? Number(v) : null; };
  const safe = (v: number | null) => v ?? 0;

  // ── Receitas ─────────────────────────────────────────────────────────────
  const rev1 = safe(n(base, "netRevenue"));
  const rev2 = safe(n(comp, "netRevenue"));
  const deltaRev = rev2 - rev1;
  const deltaRevPct = rev1 !== 0 ? (deltaRev / rev1) * 100 : null;

  // ── Custos variáveis → Margem de Contribuição ────────────────────────────
  const varC1 = safe(n(base, "variableCosts"));
  const varC2 = safe(n(comp, "variableCosts"));
  const mc1   = rev1 - varC1;
  const mc2   = rev2 - varC2;
  const mcPct1 = rev1 > 0 ? mc1 / rev1 : 0;
  const mcPct2 = rev2 > 0 ? mc2 / rev2 : 0;

  // ── Custos fixos ─────────────────────────────────────────────────────────
  const fix1 = safe(n(base, "fixedCosts"));
  const fix2 = safe(n(comp, "fixedCosts"));

  // ── Resultado Operacional = MC − Custo Fixo ──────────────────────────────
  const result1 = mc1 - fix1;
  const result2 = mc2 - fix2;
  const deltaResult = result2 - result1;

  // ── Bridge Decomposition (3 efeitos que somam ao Δ Resultado) ────────────
  // 1. Efeito Volume: quanto o Δ Receita contribuiu à MC, mantendo MC% do período base
  const efectoVolume = deltaRev * mcPct1;
  // 2. Efeito Margem/CMV: quanto a mudança no MC% impactou, aplicado à nova receita
  const efectoMargem = rev2 * (mcPct2 - mcPct1);
  // 3. Efeito Custo Fixo: variação de custo fixo (negativa se aumentou)
  const efectoCustoFixo = -(fix2 - fix1);
  // Verificação: os 3 devem somar ≈ deltaResult
  const bridgeSum = efectoVolume + efectoMargem + efectoCustoFixo;
  const bridgeError = Math.abs(bridgeSum - deltaResult);

  // ── Indicadores secundários ──────────────────────────────────────────────
  const grossRev1 = n(base, "grossRevenue");
  const grossRev2 = n(comp, "grossRevenue");
  const cogs1 = n(base, "cogs");
  const cogs2 = n(comp, "cogs");
  const ebitda1 = n(base, "ebitda");
  const ebitda2 = n(comp, "ebitda");
  const netP1 = n(base, "netProfit");
  const netP2 = n(comp, "netProfit");
  const customers1 = n(base, "activeCustomers");
  const customers2 = n(comp, "activeCustomers");
  const ticket1 = n(base, "averageTicket");
  const ticket2 = n(comp, "averageTicket");

  // Decomposição do Δ Receita em volume vs preço (quando disponível)
  let volumeEffect: number | null = null;
  let priceEffect: number | null = null;
  if (customers1 !== null && customers2 !== null && ticket1 !== null && ticket2 !== null && customers1 > 0) {
    volumeEffect = (customers2 - customers1) * ticket1;    // Δ clientes × preço base
    priceEffect  = customers2 * (ticket2 - ticket1);       // Δ ticket × novos clientes
  }

  // ── Diagnóstico de Vazamento ──────────────────────────────────────────────
  const isLeaking = deltaRev > 0 && deltaResult < 0;
  const isImproving = deltaRev >= 0 && deltaResult > 0;
  const isPressured = deltaRev < 0 && deltaResult < 0;

  // ── Narrativa ─────────────────────────────────────────────────────────────
  const lines: string[] = [];
  if (isLeaking) {
    lines.push(`⚠️ Sinal de vazamento detectado: a receita cresceu ${deltaRevPct !== null ? `${deltaRevPct.toFixed(1)}%` : ""} mas o resultado operacional caiu R$ ${Math.abs(Math.round(deltaResult)).toLocaleString("pt-BR")}.`);
    if (efectoMargem < -Math.abs(efectoVolume) * 0.3)
      lines.push("A principal causa é a queda na margem de contribuição — o custo variável cresceu proporcionalmente mais que a receita.");
    if (efectoCustoFixo < -Math.abs(efectoVolume) * 0.3)
      lines.push("O aumento de custos fixos está consumindo o ganho de receita.");
  } else if (isImproving) {
    lines.push(`✅ Empresa cresceu de forma saudável: receita e resultado operacional evoluíram juntos.`);
    const mainDriver = efectoVolume >= efectoMargem && efectoVolume >= efectoCustoFixo ? "volume de vendas" : efectoMargem >= efectoCustoFixo ? "melhora de margem" : "controle de custos fixos";
    lines.push(`O principal driver de melhora foi o ${mainDriver}.`);
  } else if (isPressured) {
    lines.push(`📉 Queda de receita e resultado: empresa em compressão no período.`);
    if (Math.abs(efectoMargem) < Math.abs(efectoVolume) * 0.5)
      lines.push("A margem de contribuição foi preservada — o problema está concentrado na queda de volume/receita.");
    else
      lines.push("A margem de contribuição também piorou, agravando o efeito da queda de receita.");
  } else {
    lines.push(`Período comparativo com variações mistas: analise os efeitos abaixo para identificar as alavancas principais.`);
  }

  const bridge = [
    { label: "Efeito Volume", value: Math.round(efectoVolume), description: "Impacto do Δ Receita na MC, mantendo o MC% do período base" },
    { label: "Efeito Margem/CMV", value: Math.round(efectoMargem), description: "Impacto da variação de margem de contribuição % na nova receita" },
    { label: "Efeito Custo Fixo", value: Math.round(efectoCustoFixo), description: "Variação de custos fixos (positivo = custo caiu = melhora)" },
  ];

  return {
    periodBase,
    periodComp,
    summary: {
      netRevenue:         { base: Math.round(rev1), comp: Math.round(rev2),    delta: Math.round(deltaRev),    deltaPct: deltaRevPct },
      contributionMargin: { base: Math.round(mc1),  comp: Math.round(mc2),     delta: Math.round(mc2 - mc1),   deltaPct: mc1 !== 0 ? ((mc2 - mc1) / Math.abs(mc1)) * 100 : null },
      mcPct:              { base: mcPct1 * 100,      comp: mcPct2 * 100,        delta: (mcPct2 - mcPct1) * 100, deltaPct: null },
      fixedCosts:         { base: Math.round(fix1),  comp: Math.round(fix2),    delta: Math.round(fix2 - fix1), deltaPct: fix1 !== 0 ? ((fix2 - fix1) / Math.abs(fix1)) * 100 : null },
      operatingResult:    { base: Math.round(result1), comp: Math.round(result2), delta: Math.round(deltaResult), deltaPct: result1 !== 0 ? (deltaResult / Math.abs(result1)) * 100 : null },
      ...(grossRev1 !== null ? { grossRevenue: { base: Math.round(grossRev1), comp: Math.round(safe(grossRev2)), delta: Math.round(safe(grossRev2) - grossRev1), deltaPct: grossRev1 !== 0 ? ((safe(grossRev2) - grossRev1) / grossRev1) * 100 : null } } : {}),
      ...(ebitda1 !== null   ? { ebitda:       { base: Math.round(ebitda1),   comp: Math.round(safe(ebitda2)),   delta: Math.round(safe(ebitda2) - ebitda1),   deltaPct: ebitda1 !== 0 ? ((safe(ebitda2) - ebitda1) / Math.abs(ebitda1)) * 100 : null } } : {}),
      ...(netP1 !== null     ? { netProfit:    { base: Math.round(netP1),     comp: Math.round(safe(netP2)),     delta: Math.round(safe(netP2) - netP1),     deltaPct: netP1 !== 0 ? ((safe(netP2) - netP1) / Math.abs(netP1)) * 100 : null } } : {}),
      ...(customers1 !== null ? { activeCustomers: { base: customers1, comp: safe(customers2), delta: safe(customers2) - customers1, deltaPct: customers1 !== 0 ? ((safe(customers2) - customers1) / customers1) * 100 : null } } : {}),
      ...(ticket1 !== null    ? { averageTicket:   { base: Math.round(ticket1), comp: Math.round(safe(ticket2)), delta: Math.round(safe(ticket2) - ticket1), deltaPct: ticket1 !== 0 ? ((safe(ticket2) - ticket1) / ticket1) * 100 : null } } : {}),
    },
    bridge,
    bridgeCheckOk: bridgeError < Math.max(100, Math.abs(deltaResult) * 0.01),
    revenueDecomposition: volumeEffect !== null ? {
      volumeEffect: Math.round(volumeEffect),
      priceEffect:  Math.round(safe(priceEffect)),
      description:  "Decomposição do Δ Receita em efeito de clientes vs ticket médio",
    } : null,
    diagnosis: { isLeaking, isImproving, isPressured },
    narrative: lines.join(" "),
  };
}

// List calculation history, including partial spot-checks composed with their
// full-analysis baseline so the history panel can restore complete diagnostics.
router.get("/:id/calculations", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }
  if (!canAccessCompany(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }

  const runs = await db.select().from(calculationRuns)
    .where(eq(calculationRuns.companyId, id))
    .orderBy(desc(calculationRuns.createdAt));

  res.json(buildCalculationHistory(runs, company.scoreThresholds));
});

// Get the most recent full-analysis result. The result payload's persisted
// discriminator, not its engine list, identifies a full run: a spot-check may
// intentionally refresh all engines while still only containing raw metrics.
router.get("/:id/calculations/latest", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }
  if (!canAccessCompany(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }

  const runs = await db.select().from(calculationRuns)
    .where(eq(calculationRuns.companyId, id))
    .orderBy(desc(calculationRuns.createdAt));
  const fullRun = findLatestFullAnalysisRun(runs);

  if (!fullRun) { res.status(404).json({ error: "No full analysis found" }); return; }

  const results = fullRun.results as { findings?: unknown[]; blufRecommendation?: string } | null;
  if (!results?.findings) { res.status(404).json({ error: "No results in latest run" }); return; }

  const findings = applyFindingPriorities(results.findings as any[], company.scoreThresholds);
  res.json({
    id: fullRun.id,
    companyId: fullRun.companyId,
    period: fullRun.period,
    engines: fullRun.engines,
    status: fullRun.status,
    createdAt: fullRun.createdAt,
    findings,
    blufRecommendation: buildPriorityBluf(findings),
  });
});

// ── Calculation engine logic ──────────────────────────────────────────────────

export function runEngines(engines: string[], data: any): Record<string, unknown> {
  const results: Record<string, unknown> = {};
  for (const engine of engines) {
    results[engine] = runEngine(engine, data);
  }
  return results;
}

function toNum(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function pct(a: unknown, b: unknown): number | null {
  const an = toNum(a), bn = toNum(b);
  if (an === null || bn === null || bn === 0) return null;
  return (an / bn) * 100;
}

// ── Safety margin classification (spec: única com faixas fixas — mede vs ponto de equilíbrio)
function classifyMargemSeguranca(pct: number | null): string | null {
  if (pct === null) return null;
  if (pct < 0)   return "Péssimo";
  if (pct < 10)  return "Ruim";
  if (pct < 20)  return "Aceitável";
  if (pct < 35)  return "Bom";
  return "Excelente";
}

function runEngine(engine: string, data: any): Record<string, unknown> {
  if (!data) return { status: "no_data", message: "Sem dados financeiros para este período" };

  switch (engine) {

    // ── MOTOR FINANCEIRO (spec: DRE + ponto de equilíbrio + margem de contribuição + ciclo financeiro)
    case "financial": {
      const netRev  = toNum(data.netRevenue);
      const grossRev = toNum(data.grossRevenue);
      const cogs    = toNum(data.cogs);
      const grossPr = toNum(data.grossProfit);
      const fixedC  = toNum(data.fixedCosts);
      const varC    = toNum(data.variableCosts);
      const ebitda  = toNum(data.ebitda);
      const netPr   = toNum(data.netProfit);
      const pmr     = toNum(data.pmr);
      const pmp     = toNum(data.pmp);
      const pme     = toNum(data.pme);
      const proLab  = toNum(data.proLabore);

      // DRE margins
      const grossMargin  = pct(grossPr ?? (netRev !== null && cogs !== null ? netRev - cogs : null), grossRev);
      const ebitdaMargin = pct(ebitda, netRev);
      const netMargin    = pct(netPr, netRev);
      const costRevRatio = netRev && fixedC !== null && varC !== null
        ? pct(fixedC + varC, netRev) : null;

      // Margem de Contribuição = Receita Líquida − Custos Variáveis
      const mc    = netRev !== null && varC !== null ? netRev - varC : null;
      const mcPct = pct(mc, netRev);

      // Ponto de Equilíbrio = Custos Fixos ÷ (MC / Receita Líquida)
      const peRevenue = mc !== null && netRev !== null && fixedC !== null && mc > 0
        ? (fixedC / (mc / netRev)) : null;

      // Margem de Segurança = (Receita − PE) / Receita × 100
      const safetyMargin = netRev !== null && peRevenue !== null && netRev > 0
        ? ((netRev - peRevenue) / netRev) * 100 : null;
      const safetyClass = classifyMargemSeguranca(safetyMargin);

      // Resultado Operacional = Receita Líquida − CMV − Custos Fixos − Custos Variáveis
      const operatingResult = netRev !== null && cogs !== null && fixedC !== null && varC !== null
        ? netRev - cogs - fixedC - varC : null;
      const operatingMargin = pct(operatingResult, netRev);

      // Ciclo financeiro (requer PMR, PMP, PME)
      const operatingCycle  = pmr !== null && pme !== null ? pmr + pme : null;
      const cashCycle       = operatingCycle !== null && pmp !== null ? operatingCycle - pmp : null;
      const workingCapNeed  = cashCycle !== null && netRev !== null
        ? Math.round(cashCycle * (netRev / 30)) : null;

      // Capacidade de pró-labore
      const maxProLabore = netRev !== null && varC !== null && fixedC !== null
        ? netRev - varC - fixedC : null;

      // Score composto: foca em saúde financeira real
      const scoreComponents: (number | null)[] = [];
      if (mcPct !== null)      scoreComponents.push(Math.min(100, Math.max(0, mcPct * 1.5)));
      if (ebitdaMargin !== null) scoreComponents.push(Math.min(100, Math.max(0, ebitdaMargin * 4)));
      if (netMargin !== null)  scoreComponents.push(Math.min(100, Math.max(0, netMargin * 5)));
      if (safetyMargin !== null) scoreComponents.push(Math.min(100, Math.max(0, safetyMargin * 2)));
      const score = calcScore(scoreComponents);

      // Markup sobre CMV = (Receita Líquida − CMV) / CMV × 100
      const markupOnCogs = cogs !== null && cogs > 0 && netRev !== null
        ? ((netRev - cogs) / cogs) * 100 : null;

      return {
        // DRE
        grossMargin, ebitdaMargin, netMargin, operatingMargin, costRevRatio,
        // Margem de contribuição e equilíbrio
        contributionMargin: mc !== null ? Math.round(mc) : null,
        contributionMarginPct: mcPct,
        breakEvenRevenue: peRevenue !== null ? Math.round(peRevenue) : null,
        safetyMargin, safetyMarginClass: safetyClass,
        // Resultado operacional
        operatingResult: operatingResult !== null ? Math.round(operatingResult) : null,
        // Ciclo financeiro
        operatingCycle, cashCycle,
        workingCapitalNeed: workingCapNeed,
        // Markup
        markupOnCogs,
        // Pró-labore
        maxProLabore: maxProLabore !== null ? Math.round(maxProLabore) : null,
        currentProLabore: proLab,
        score,
      };
    }

    // ── MOTOR COMERCIAL ──────────────────────────────────────────────────────
    case "commercial": {
      const convRate  = toNum(data.conversionRate);  // percentage point (0–100), e.g. 12.5 = 12.5%
      const avgTicket = toNum(data.averageTicket);
      const churn     = toNum(data.churnRate);       // percentage point (0–100) mensal, e.g. 3.2 = 3.2%
      const customers = toNum(data.activeCustomers);
      const netRev    = toNum(data.netRevenue);
      const extra     = (data.additionalData ?? {}) as Record<string, unknown>;

      // Inputs adicionais (additionalData)
      const newCustomers        = toNum(extra.newCustomers);         // novos clientes no período
      const totalAcquisitionCost = toNum(extra.totalAcquisitionCost); // custo total de aquisição (marketing + vendas)
      const funnelLeads         = toNum(extra.funnelLeads);          // leads gerados
      const funnelProposals     = toNum(extra.funnelProposals);      // propostas enviadas
      const funnelNegotiations  = toNum(extra.funnelNegotiations);   // negociações abertas
      const numSalespeople      = toNum(extra.numSalespeople);        // vendedores ativos

      // ── CAC = Custo Total de Aquisição / Novos Clientes ─────────────────
      // (spec: CAC calculado quando budget total e clientes novos disponíveis)
      const cac = totalAcquisitionCost !== null && newCustomers !== null && newCustomers > 0
        ? Math.round(totalAcquisitionCost / newCustomers) : null;

      // ── LTV = Ticket Médio / Taxa de Churn mensal ────────────────────────
      // (spec: LTV/CAC — classifica saúde da aquisição de clientes)
      // churn stored as % (e.g. 3.2 = 3.2% = 0.032) → divide by 100 before using as decimal
      const ltv = avgTicket !== null && churn !== null && churn > 0
        ? Math.round(avgTicket / (churn / 100)) : null;

      // ── Razão LTV/CAC e classificação ────────────────────────────────────
      const ltvCac = ltv !== null && cac !== null && cac > 0
        ? parseFloat((ltv / cac).toFixed(2)) : null;
      // Faixas: ≥3 Saudável · ≥1.5 Aceitável · <1.5 Crítico
      const ltvCacClass = ltvCac !== null
        ? (ltvCac >= 3 ? "Saudável" : ltvCac >= 1.5 ? "Aceitável" : "Crítico") : null;

      // ── Conversões do funil ──────────────────────────────────────────────
      const leadsToProposal    = funnelLeads !== null && funnelProposals !== null && funnelLeads > 0
        ? parseFloat((funnelProposals / funnelLeads * 100).toFixed(1)) : null;
      const proposalToNeg      = funnelProposals !== null && funnelNegotiations !== null && funnelProposals > 0
        ? parseFloat((funnelNegotiations / funnelProposals * 100).toFixed(1)) : null;
      const negToClose         = funnelNegotiations !== null && newCustomers !== null && funnelNegotiations > 0
        ? parseFloat((newCustomers / funnelNegotiations * 100).toFixed(1)) : null;
      const overallFunnelConv  = funnelLeads !== null && newCustomers !== null && funnelLeads > 0
        ? parseFloat((newCustomers / funnelLeads * 100).toFixed(2)) : null;

      // ── Receita por vendedor (proxy de produtividade) ────────────────────
      const revenuePerSalesperson = numSalespeople !== null && numSalespeople > 0 && netRev !== null
        ? Math.round(netRev / numSalespeople) : null;

      // ── MRR estimado = ticket médio × clientes ativos ────────────────────
      const estimatedMRR = avgTicket !== null && customers !== null
        ? Math.round(avgTicket * customers) : null;

      // ── Receita por cliente ──────────────────────────────────────────────
      const revenuePerCustomer = netRev !== null && customers !== null && customers > 0
        ? Math.round(netRev / customers) : null;

      // ── Scores parciais ──────────────────────────────────────────────────
      // convRate stored as % (12.5 = 12.5%) → 25% = score 100
      const convScore    = convRate !== null ? Math.min(100, convRate * 4)    : null;  // 25% = 100
      // churn stored as % (3.2 = 3.2%) → 10% churn = score 0
      const churnScore   = churn   !== null ? Math.max(0, 100 - churn * 10)  : null;  // 10% = 0
      const ltvCacScore  = ltvCac  !== null ? Math.min(100, ltvCac / 5 * 100) : null; // 5× = 100
      const score = calcScore([convScore, churnScore, ltvCacScore].filter(v => v !== null) as (number | null)[]);

      return {
        conversionRate: convRate,
        averageTicket: avgTicket,
        churnRate: churn,
        activeCustomers: customers,
        newCustomers,
        totalAcquisitionCost,
        cac,
        estimatedLTV: ltv,
        ltvCacRatio: ltvCac,
        ltvCacClassification: ltvCacClass,
        estimatedMRR,
        revenuePerCustomer,
        revenuePerSalesperson,
        funnelLeadsToProposalPct: leadsToProposal,
        funnelProposalToNegPct: proposalToNeg,
        funnelNegToClosePct: negToClose,
        overallFunnelConversionPct: overallFunnelConv,
        numSalespeople,
        score,
      };
    }

    // ── MOTOR DE MARKETING ───────────────────────────────────────────────────
    case "marketing": {
      const nps       = toNum(data.nps);
      const avgTicket = toNum(data.averageTicket);
      const churn     = toNum(data.churnRate);
      const extra     = (data.additionalData ?? {}) as Record<string, unknown>;

      // NPS classification (spec: Promotor ≥75, Neutro Positivo ≥50, Neutro ≥0, Detrator <0)
      const npsClass = nps !== null
        ? (nps >= 75 ? "Promotor" : nps >= 50 ? "Neutro Positivo" : nps >= 0 ? "Neutro" : "Detrator")
        : null;

      // Inputs de funil de marketing (additionalData)
      const impressions     = toNum(extra.impressions);       // impressões totais de anúncios
      const clicks          = toNum(extra.clicks);            // cliques nos anúncios
      const adLeads         = toNum(extra.adLeads);           // leads gerados pelos anúncios
      const adRevenue       = toNum(extra.adRevenue);         // receita atribuída aos anúncios (R$)
      const adSpend         = toNum(extra.adSpend);           // investimento total em mídia (R$)
      const newCustomers    = toNum(extra.newCustomers);      // novos clientes convertidos no período

      // ── CTR = Cliques / Impressões × 100 ────────────────────────────────
      // (spec: CTR — taxa de clique em anúncios)
      const ctr = clicks !== null && impressions !== null && impressions > 0
        ? parseFloat((clicks / impressions * 100).toFixed(2)) : null;
      // Faixas CTR: ≥5% Excelente · ≥2% Bom · ≥1% Aceitável · <1% Ruim
      const ctrClass = ctr !== null
        ? (ctr >= 5 ? "Excelente" : ctr >= 2 ? "Bom" : ctr >= 1 ? "Aceitável" : "Ruim") : null;

      // ── CPL = Investimento / Leads ───────────────────────────────────────
      // (spec: CPL — custo por lead)
      const cpl = adSpend !== null && adLeads !== null && adLeads > 0
        ? Math.round(adSpend / adLeads) : null;

      // ── CAC = Investimento / Novos Clientes (via canal de marketing) ─────
      // (spec: CAC — custo de aquisição de cliente)
      const cac = adSpend !== null && newCustomers !== null && newCustomers > 0
        ? Math.round(adSpend / newCustomers) : null;

      // ── ROAS = Receita Atribuída / Investimento ──────────────────────────
      // (spec: ROAS — retorno sobre o investimento em anúncios)
      const roas = adRevenue !== null && adSpend !== null && adSpend > 0
        ? parseFloat((adRevenue / adSpend).toFixed(2)) : null;
      // Faixas ROAS: ≥4× Excelente · ≥2× Bom · ≥1× Aceitável · <1× Crítico
      const roasClass = roas !== null
        ? (roas >= 4 ? "Excelente" : roas >= 2 ? "Bom" : roas >= 1 ? "Aceitável" : "Crítico") : null;

      // ── ROI de Marketing = (Receita − Investimento) / Investimento × 100 ─
      // (spec: ROI de canal de marketing)
      const roiMarketing = adRevenue !== null && adSpend !== null && adSpend > 0
        ? parseFloat(((adRevenue - adSpend) / adSpend * 100).toFixed(1)) : null;
      // Faixas ROI: >300% Excelente · >100% Bom · >0% Aceitável · ≤0% Negativo
      const roiClass = roiMarketing !== null
        ? (roiMarketing > 300 ? "Excelente" : roiMarketing > 100 ? "Bom" : roiMarketing > 0 ? "Aceitável" : "Negativo") : null;

      // ── LTV = Ticket Médio / Churn mensal ───────────────────────────────
      // churn stored as % (e.g. 3.2 = 3.2% = 0.032 decimal) → divide by 100
      const ltv = avgTicket !== null && churn !== null && churn > 0
        ? Math.round(avgTicket / (churn / 100)) : null;

      // ── LTV/CAC e classificação ──────────────────────────────────────────
      // (spec: LTV/CAC ≥3 Saudável · ≥1.5 Aceitável · <1.5 Crítico)
      const ltvCac = ltv !== null && cac !== null && cac > 0
        ? parseFloat((ltv / cac).toFixed(2)) : null;
      const ltvCacClass = ltvCac !== null
        ? (ltvCac >= 3 ? "Saudável" : ltvCac >= 1.5 ? "Aceitável" : "Crítico") : null;

      // ── Taxa de conversão do funil de marketing ─────────────────────────
      const clickToLead = clicks !== null && adLeads !== null && clicks > 0
        ? parseFloat((adLeads / clicks * 100).toFixed(1)) : null;
      const leadToCustomer = adLeads !== null && newCustomers !== null && adLeads > 0
        ? parseFloat((newCustomers / adLeads * 100).toFixed(1)) : null;

      // ── Score composto ───────────────────────────────────────────────────
      // NPS (30%), ROAS (30%), LTV/CAC (25%), CTR (15%)
      const npsScore    = nps    !== null ? Math.max(0, Math.min(100, nps)) : null;
      const roasScore   = roas   !== null ? Math.min(100, roas / 4 * 100)  : null; // 4× = 100
      const ltvCacScore = ltvCac !== null ? Math.min(100, ltvCac / 5 * 100) : null; // 5× = 100
      const ctrScore    = ctr    !== null ? Math.min(100, ctr / 5 * 100)   : null; // 5% = 100

      const score = calcWeightedScore([
        { value: npsScore,    weight: 0.30 },
        { value: roasScore,   weight: 0.30 },
        { value: ltvCacScore, weight: 0.25 },
        { value: ctrScore,    weight: 0.15 },
      ]) ?? npsScore;

      return {
        nps, npsClassification: npsClass,
        impressions, clicks, adLeads, adSpend, adRevenue, newCustomers,
        ctr, ctrClassification: ctrClass,
        cpl, cac,
        roas, roasClassification: roasClass,
        roiMarketing, roiClassification: roiClass,
        ltv, ltvCacRatio: ltvCac, ltvCacClassification: ltvCacClass,
        clickToLeadPct: clickToLead, leadToCustomerPct: leadToCustomer,
        score,
      };
    }

    // ── MOTOR DE OPERAÇÕES ───────────────────────────────────────────────────
    case "operations": {
      const employees = toNum(data.totalEmployees);
      const netRev    = toNum(data.netRevenue);
      const extra     = (data.additionalData ?? {}) as Record<string, unknown>;

      // ── Produtividade por colaborador ────────────────────────────────────
      const revenuePerEmployee = employees !== null && employees > 0 && netRev !== null
        ? Math.round(netRev / employees) : null;

      // Dados de capacidade e OEE (additionalData)
      const capacityUtilization = toNum(extra.capacityUtilization); // % 0–100
      const defectRate          = toNum(extra.defectRate);           // % 0–100 (taxa de defeitos/retrabalho)
      const avgCycleTimeMins    = toNum(extra.avgCycleTimeMins);     // minutos por ciclo/unidade

      // ── OEE = Disponibilidade × Performance × Qualidade ─────────────────
      // (spec: OEE — Overall Equipment Effectiveness)
      // Aceita OEE como índice direto OU calcula dos 3 componentes
      const oeeAvailability = toNum(extra.oeeAvailability); // % (0–100)
      const oeePerformance  = toNum(extra.oeePerformance);  // % (0–100)
      const oeeQuality      = toNum(extra.oeeQuality);      // % (0–100) = 100 − defectRate
      const oeeIndexInput   = toNum(extra.oeeIndex);        // índice direto % (0–100), se disponível

      // Calcula OEE pelos componentes quando todos presentes; caso contrário usa o índice direto
      let oeeCalculated: number | null = null;
      if (oeeAvailability !== null && oeePerformance !== null && oeeQuality !== null) {
        oeeCalculated = parseFloat((oeeAvailability / 100 * oeePerformance / 100 * oeeQuality / 100 * 100).toFixed(1));
      } else if (oeeIndexInput !== null) {
        oeeCalculated = oeeIndexInput;
      }

      // Faixas OEE: ≥85% Classe Mundial · ≥65% Bom · ≥45% Aceitável · <45% Crítico
      const oeeClass = oeeCalculated !== null
        ? (oeeCalculated >= 85 ? "Classe Mundial" : oeeCalculated >= 65 ? "Bom" : oeeCalculated >= 45 ? "Aceitável" : "Crítico")
        : null;

      // ── Utilização de capacidade e folga ─────────────────────────────────
      // (spec: calcular utilização da capacidade instalada e folga disponível)
      const capacitySlack = capacityUtilization !== null ? parseFloat((100 - capacityUtilization).toFixed(1)) : null;

      // Faixas de utilização: >90% Saturado · >70% Bom · >40% Médio · ≤40% Ocioso
      const utilizationClass = capacityUtilization !== null
        ? (capacityUtilization > 90 ? "Saturado" : capacityUtilization > 70 ? "Bom" : capacityUtilization > 40 ? "Médio" : "Ocioso")
        : null;

      // ── Identificação de gargalo ─────────────────────────────────────────
      // (spec: identificar gargalo de processo — a etapa que limita o sistema)
      // Usa dados de etapas do processo quando disponíveis (até 5 etapas)
      const {
        stageCount,
        bottleneckStage,
        bottleneckCapacity,
        systemThroughput,
      } = findOperationsBottleneck(extra);

      // ── Taxa de defeitos / qualidade ─────────────────────────────────────
      const qualityRate = defectRate !== null ? parseFloat((100 - defectRate).toFixed(1)) : null;
      // Faixas: ≥99% Excelente · ≥95% Bom · ≥90% Aceitável · <90% Crítico
      const qualityClass = qualityRate !== null
        ? (qualityRate >= 99 ? "Excelente" : qualityRate >= 95 ? "Bom" : qualityRate >= 90 ? "Aceitável" : "Crítico")
        : null;

      // ── Score composto ───────────────────────────────────────────────────
      // OEE (35%), Utilização de capacidade (30%), Qualidade (25%), Produtividade (10%)
      const oeeScore  = oeeCalculated !== null ? Math.min(100, oeeCalculated) : null;
      // Utilização ideal ≈ 80% (saturação acima = risco; ociosidade abaixo = desperdício)
      const capScore  = capacityUtilization !== null
        ? (capacityUtilization <= 90
          ? Math.min(100, capacityUtilization * 1.1)         // até 90% = pontuação linear
          : Math.max(0, 100 - (capacityUtilization - 90) * 5)) // acima de 90% penaliza (risco de ruptura)
        : null;
      const defScore  = qualityRate !== null ? Math.min(100, qualityRate) : null;
      const prodScore = revenuePerEmployee !== null
        ? Math.min(100, Math.round(revenuePerEmployee / 3000)) : null;

      const score = calcWeightedScore([
        { value: oeeScore,   weight: 0.35 },
        { value: capScore,   weight: 0.30 },
        { value: defScore,   weight: 0.25 },
        { value: prodScore,  weight: 0.10 },
      ]);

      return {
        totalEmployees: employees,
        revenuePerEmployee,
        capacityUtilization,
        utilizationClassification: utilizationClass,
        capacitySlack,
        oeeIndex: oeeCalculated,
        oeeClassification: oeeClass,
        oeeAvailability,
        oeePerformance,
        oeeQuality,
        defectRate,
        qualityRate,
        qualityClassification: qualityClass,
        avgCycleTimeMins,
        ...(bottleneckStage ? { bottleneckStage, bottleneckCapacity, systemThroughput } : {}),
        stageCount: stageCount > 0 ? stageCount : null,
        score,
      };
    }

    // ── MOTOR DE RH ──────────────────────────────────────────────────────────
    case "hr": {
      const employees = toNum(data.totalEmployees);
      const netRev    = toNum(data.netRevenue);
      const extra     = (data.additionalData ?? {}) as Record<string, unknown>;

      // ── Produtividade por colaborador ────────────────────────────────────
      const revenuePerEmployee = employees !== null && employees > 0 && netRev !== null
        ? Math.round(netRev / employees) : null;

      // Inputs de RH (additionalData)
      const turnoverRate          = toNum(extra.turnoverRate);          // % anual (0–100)
      const avgSalary             = toNum(extra.avgSalary);             // R$/mês (salário médio)
      const trainingInvestment    = toNum(extra.trainingInvestment);    // R$ total investido em treinamento
      const trainingHoursPerYear  = toNum(extra.trainingHoursPerYear);  // horas de treinamento/ano
      const newHires              = toNum(extra.newHires);              // contratações no período
      const avgRecruitmentCost    = toNum(extra.avgRecruitmentCost);    // R$ custo médio de recrutamento por vaga
      const productivityGainPct   = toNum(extra.productivityGainPct);   // % ganho de produtividade esperado com treinamento

      // ── Custo de Turnover ────────────────────────────────────────────────
      // (spec: rescisão + recrutamento + treinamento + perda de produtividade na rampagem)
      // Salário anual estimado
      const annualSalaryEst = avgSalary !== null
        ? avgSalary * 12
        : revenuePerEmployee !== null ? revenuePerEmployee * 0.35 : null; // proxy: 35% receita/col

      // Colaboradores que saíram no período
      const turnoverEmployees = turnoverRate !== null && employees !== null
        ? Math.round((turnoverRate / 100) * employees) : null;

      // Decomposição do custo por colaborador desligado:
      //   Rescisão: 40% salário anual (médio mercado, inclui FGTS e aviso prévio)
      //   Recrutamento: custo informado ou proxy (30% salário anual)
      //   Treinamento de entrada: 20% salário anual
      //   Perda de produtividade na rampagem (~3 meses em 50%): 12.5% salário anual
      const recruitCostPerPerson = avgRecruitmentCost !== null
        ? avgRecruitmentCost
        : annualSalaryEst !== null ? annualSalaryEst * 0.30 : null;
      const costPerTurnover = annualSalaryEst !== null
        ? Math.round(
            annualSalaryEst * 0.40  // rescisão
          + (recruitCostPerPerson ?? annualSalaryEst * 0.30) // recrutamento
          + annualSalaryEst * 0.20  // treinamento inicial
          + annualSalaryEst * 0.125  // rampagem (3 meses × 50%)
          )
        : null;
      const turnoverCostTotal = turnoverEmployees !== null && costPerTurnover !== null
        ? Math.round(turnoverEmployees * costPerTurnover) : null;
      // Custo de turnover como % da receita líquida
      const turnoverCostRevPct = turnoverCostTotal !== null && netRev !== null && netRev > 0
        ? parseFloat((turnoverCostTotal / netRev * 100).toFixed(1)) : null;

      // Faixas de turnover: ≤5% Baixo · ≤10% Médio · ≤20% Alto · >20% Crítico
      const turnoverClass = turnoverRate !== null
        ? (turnoverRate <= 5 ? "Baixo" : turnoverRate <= 10 ? "Médio" : turnoverRate <= 20 ? "Alto" : "Crítico")
        : null;

      // ── Taxa de Retenção ─────────────────────────────────────────────────
      const retentionRate = turnoverRate !== null ? parseFloat((100 - turnoverRate).toFixed(1)) : null;

      // ── ROI de Treinamento ───────────────────────────────────────────────
      // (spec: ROI/payback de treinamento)
      // ROI = Ganho Esperado / Investimento
      // Ganho esperado = revenuePerEmployee × employees × (productivityGainPct/100)
      let trainingRoi: number | null = null;
      let trainingPaybackMonths: number | null = null;
      if (trainingInvestment !== null && trainingInvestment > 0) {
        if (productivityGainPct !== null && revenuePerEmployee !== null && employees !== null) {
          // Ganho anual em receita estimado pelo % de ganho de produtividade declarado
          const annualGain = revenuePerEmployee * employees * (productivityGainPct / 100);
          trainingRoi = parseFloat((annualGain / trainingInvestment).toFixed(2));
          const monthlyGain = annualGain / 12;
          trainingPaybackMonths = monthlyGain > 0 ? Math.ceil(trainingInvestment / monthlyGain) : null;
        } else if (trainingHoursPerYear !== null && annualSalaryEst !== null && employees !== null) {
          // Proxy: cada hora de treinamento gera 0.5% de ganho de produtividade por colaborador
          const productivityProxy = (trainingHoursPerYear * 0.005) * annualSalaryEst * employees;
          trainingRoi = parseFloat((productivityProxy / trainingInvestment).toFixed(2));
          const monthlyGain = productivityProxy / 12;
          trainingPaybackMonths = monthlyGain > 0 ? Math.ceil(trainingInvestment / monthlyGain) : null;
        }
      }
      // Faixas ROI treinamento: >2× Excelente · >1× Bom · >0× Aceitável · ≤0× Negativo
      const trainingRoiClass = trainingRoi !== null
        ? (trainingRoi > 2 ? "Excelente" : trainingRoi > 1 ? "Bom" : trainingRoi > 0 ? "Aceitável" : "Negativo")
        : null;

      // ── Score composto ───────────────────────────────────────────────────
      // Retenção (50%), Produtividade (30%), ROI Treinamento (20%)
      const retentionScore = retentionRate !== null ? Math.min(100, retentionRate) : null;
      const prodScore      = revenuePerEmployee !== null ? Math.min(100, Math.round(revenuePerEmployee / 3000)) : null;
      const roiScore       = trainingRoi !== null ? Math.min(100, trainingRoi / 3 * 100) : null; // 3× = 100

      const score = calcWeightedScore([
        { value: retentionScore, weight: 0.50 },
        { value: prodScore,      weight: 0.30 },
        { value: roiScore,       weight: 0.20 },
      ]);

      return {
        totalEmployees: employees,
        revenuePerEmployee,
        turnoverRate,
        turnoverClassification: turnoverClass,
        retentionRate,
        annualSalaryEstimate: annualSalaryEst !== null ? Math.round(annualSalaryEst) : null,
        turnoverCostPerPerson: costPerTurnover,
        turnoverCostTotal,
        // Backward-compatible aliases consumed by AnalysisPanel highlights and charts
        turnoverCostEstimate: turnoverCostTotal,
        turnoverCostRevenuePercent: turnoverCostRevPct,
        trainingInvestment,
        avgSalary,
        trainingHoursPerYear,
        productivityGainPct,
        trainingRoi,
        // Backward-compatible alias consumed by AnalysisPanel secondary metrics / METRIC_LABELS
        trainingRoiEstimate: trainingRoi,
        trainingRoiClassification: trainingRoiClass,
        trainingPaybackMonths,
        newHires,
        avgRecruitmentCost,
        score,
      };
    }

    // ── MOTOR DE RISCOS ──────────────────────────────────────────────────────
    case "risks": {
      const defaultRate = toNum(data.defaultRate);   // percentage point (0–100), ex: 5 = 5%
      const churn       = toNum(data.churnRate);
      const fixedC      = toNum(data.fixedCosts);
      const netRev      = toNum(data.netRevenue);
      const extra       = (data.additionalData ?? {}) as Record<string, unknown>;

      // ── Risco de Inadimplência ───────────────────────────────────────────
      // defaultRate stored as % (e.g. 2.1 = 2.1%)
      // Faixas: >10% Crítico · >5% Alto · >2% Médio · ≤2% Baixo
      const defaultRisk = defaultRate !== null
        ? (defaultRate > 10 ? "Crítico" : defaultRate > 5 ? "Alto" : defaultRate > 2 ? "Médio" : "Baixo")
        : null;
      // Perda esperada por inadimplência = (defaultRate/100) × Receita Líquida
      const expectedDefaultLoss = defaultRate !== null && netRev !== null
        ? Math.round((defaultRate / 100) * netRev) : null;

      // ── Alavancagem Operacional = Custos Fixos / Receita Líquida ─────────
      // (spec: alavancagem representa quanto a empresa depende de receita para cobrir fixos)
      const operatingLeverage = fixedC !== null && netRev !== null && netRev > 0
        ? parseFloat((fixedC / netRev * 100).toFixed(1)) : null;
      // Faixas: >60% Alto · >40% Médio · ≤40% Baixo
      const leverageRisk = operatingLeverage !== null
        ? (operatingLeverage > 60 ? "Alto" : operatingLeverage > 40 ? "Médio" : "Baixo") : null;

      // ── Concentração de Cliente ──────────────────────────────────────────
      const topClientPct = toNum(extra.topClientConcentration); // % receita do maior cliente
      // Faixas: >40% Crítico · >25% Alto · >10% Médio · ≤10% Baixo
      const concentrationRisk = topClientPct !== null
        ? (topClientPct > 40 ? "Crítico" : topClientPct > 25 ? "Alto" : topClientPct > 10 ? "Médio" : "Baixo") : null;

      // ── Matriz Probabilidade × Impacto ───────────────────────────────────
      // (spec: classificar risco pela Matriz Probabilidade × Impacto e calcular Valor Esperado de Perda)
      // Aceita até 3 riscos com probabilidade (0–100%) e impacto financeiro (R$).
      //
      // Classificação pela matriz 4×4 (explícita e auditável):
      //   Probabilidade: Baixa 0–25% | Média 25–50% | Alta 50–75% | Muito Alta >75%
      //     → score P: 1 | 2 | 3 | 4
      //   Impacto (% da Receita Líquida, ou valor absoluto quando sem receita):
      //     Baixo <5% | Médio 5–20% | Alto 20–50% | Crítico >50%
      //     → score I: 1 | 2 | 3 | 4
      //   Zona = P × I:
      //     1      → Baixo
      //     2–4    → Médio
      //     5–8    → Alto
      //     9–16   → Crítico
      function riskMatrixZone(prob: number, impact: number): string {
        const pScore = prob <= 25 ? 1 : prob <= 50 ? 2 : prob <= 75 ? 3 : 4;
        const impactPct = netRev !== null && netRev > 0 ? impact / netRev * 100 : null;
        // If no revenue context, classify by absolute R$ thresholds (conservative)
        const iScore = impactPct !== null
          ? (impactPct < 5 ? 1 : impactPct < 20 ? 2 : impactPct < 50 ? 3 : 4)
          : (impact < 10000 ? 1 : impact < 50000 ? 2 : impact < 200000 ? 3 : 4);
        const zone = pScore * iScore;
        return zone === 1 ? "Baixo" : zone <= 4 ? "Médio" : zone <= 8 ? "Alto" : "Crítico";
      }

      const risks: Array<{
        name: string;
        probability: number;
        impact: number;
        expectedLoss: number;
        matrixZone: string;
        probabilityLabel: string;
        impactLabel: string;
      }> = [];

      for (let i = 1; i <= 3; i++) {
        const probKey = `risk${i}Probability`;  // 0–100 %
        const impKey  = `risk${i}Impact`;        // R$ impacto financeiro
        const nmKey   = `risk${i}Name`;
        const prob    = toNum(extra[probKey]);
        const impact  = toNum(extra[impKey]);
        const name    = (extra[nmKey] as string | undefined) ?? `Risco ${i}`;
        if (prob !== null && impact !== null) {
          // Valor Esperado de Perda = probabilidade (decimal) × impacto (R$)
          const expectedLoss = Math.round((prob / 100) * impact);
          const matrixZone = riskMatrixZone(prob, impact);
          const probabilityLabel = prob <= 25 ? "Baixa" : prob <= 50 ? "Média" : prob <= 75 ? "Alta" : "Muito Alta";
          const impactPct = netRev !== null && netRev > 0 ? impact / netRev * 100 : null;
          const impactLabel = impactPct !== null
            ? (impactPct < 5 ? "Baixo" : impactPct < 20 ? "Médio" : impactPct < 50 ? "Alto" : "Crítico")
            : (impact < 10000 ? "Baixo" : impact < 50000 ? "Médio" : impact < 200000 ? "Alto" : "Crítico");
          risks.push({ name, probability: prob, impact, expectedLoss, matrixZone, probabilityLabel, impactLabel });
        }
      }

      // Ordenar por perda esperada (maior exposição primeiro)
      risks.sort((a, b) => b.expectedLoss - a.expectedLoss);

      // Perda total esperada = soma das perdas esperadas dos riscos mapeados
      const totalExpectedLoss = risks.length > 0
        ? risks.reduce((acc, r) => acc + r.expectedLoss, 0) : null;
      // Perda esperada como % da receita
      const totalExpectedLossPct = totalExpectedLoss !== null && netRev !== null && netRev > 0
        ? parseFloat((totalExpectedLoss / netRev * 100).toFixed(1)) : null;

      // Exposição geral ao risco = nível mais alto dos riscos mapeados (pior caso)
      const exposureOrder = ["Crítico", "Alto", "Médio", "Baixo"];
      const highestZone = risks.length > 0
        ? risks.reduce((worst, r) =>
            exposureOrder.indexOf(r.matrixZone) < exposureOrder.indexOf(worst) ? r.matrixZone : worst,
            "Baixo")
        : null;

      // ── Score composto ───────────────────────────────────────────────────
      // Inadimplência (35%), Alavancagem (25%), Concentração (20%), Exposição a riscos (20%)
      // defaultRate stored as % (e.g. 2.1) → score: 20% = 0, 0% = 100, linear
      const defScore  = defaultRate !== null ? Math.max(0, 100 - defaultRate * 5) : null;
      const levScore  = operatingLeverage !== null ? Math.max(0, 100 - operatingLeverage) : null;
      const concScore = topClientPct !== null ? Math.max(0, 100 - topClientPct * 2) : null;
      const riskExposureScore = highestZone !== null
        ? (highestZone === "Baixo" ? 100 : highestZone === "Médio" ? 70 : highestZone === "Alto" ? 40 : 10)
        : null;

      const score = calcWeightedScore([
        { value: defScore,          weight: 0.35 },
        { value: levScore,          weight: 0.25 },
        { value: concScore,         weight: 0.20 },
        { value: riskExposureScore, weight: 0.20 },
      ]) ?? defScore;

      // Faixas nível de risco geral: ≥80 Baixo · ≥55 Médio · <55 Alto
      const riskLevel = score !== null
        ? (score >= 80 ? "Baixo" : score >= 55 ? "Médio" : "Alto") : null;

      return {
        defaultRate, defaultRisk, expectedDefaultLoss,
        churnRate: churn,
        operatingLeverage, leverageRisk,
        topClientConcentration: topClientPct, concentrationRisk,
        riskMatrix: risks,
        totalExpectedLoss,
        totalExpectedLossRevenuePercent: totalExpectedLossPct,
        overallExposure: highestZone,
        riskLevel,
        score,
      };
    }

    // ── MOTORES COM DADOS EXTERNOS ───────────────────────────────────────────
    case "innovation": {
      const extra = (data.additionalData ?? {}) as Record<string, unknown>;
      const processHoursPerMonth  = toNum(extra.manualProcessHours);   // h/mês em processo manual
      const hourlyCost            = toNum(extra.operatorHourlyCost);   // R$/h operador
      const automationInvestment  = toNum(extra.automationInvestment); // custo da automação
      const errorRatePct          = toNum(extra.errorRatePct);         // % erro no processo manual

      // Custo real do processo manual = horas × custo/h × (1 + taxa de retrabalho)
      const reworkFactor  = errorRatePct !== null ? 1 + errorRatePct / 100 : 1;
      const manualCostMo  = processHoursPerMonth !== null && hourlyCost !== null
        ? Math.round(processHoursPerMonth * hourlyCost * reworkFactor) : null;
      const manualCostYr  = manualCostMo !== null ? manualCostMo * 12 : null;

      // ROI de automação = ganho anual / investimento
      const automationRoi = manualCostYr !== null && automationInvestment !== null && automationInvestment > 0
        ? parseFloat((manualCostYr / automationInvestment).toFixed(2)) : null;
      const paybackMonths = manualCostMo !== null && automationInvestment !== null && manualCostMo > 0
        ? Math.ceil(automationInvestment / manualCostMo) : null;

      const hasData = manualCostMo !== null || automationRoi !== null;
      const score = automationRoi !== null
        ? Math.min(100, Math.round(automationRoi * 30)) : hasData ? 50 : null;

      return {
        manualProcessHours: processHoursPerMonth,
        operatorHourlyCost: hourlyCost,
        manualCostMonthly: manualCostMo,
        manualCostAnnual: manualCostYr,
        automationInvestment,
        automationRoi,
        paybackMonths,
        errorRatePct,
        note: hasData ? null : "Insira dados de automação na aba Dados → Inovação",
        score,
      };
    }

    case "market_intelligence": {
      const extra = (data.additionalData ?? {}) as Record<string, unknown>;
      const netRev        = toNum(data.netRevenue);
      const marketSize    = toNum(extra.marketSize);          // R$ tamanho total do mercado
      const marketGrowth  = toNum(extra.marketGrowthPct);     // % crescimento do mercado ao ano
      const companyGrowth = toNum(extra.companyGrowthPct);    // % crescimento da empresa

      // Market share
      const marketShare = netRev !== null && marketSize !== null && marketSize > 0
        ? parseFloat((netRev / marketSize * 100).toFixed(2)) : null;

      // Crescimento vs mercado
      const growthGap = companyGrowth !== null && marketGrowth !== null
        ? parseFloat((companyGrowth - marketGrowth).toFixed(1)) : null;
      const growthPosition = growthGap !== null
        ? (growthGap > 5 ? "Crescendo acima do mercado" : growthGap > -5 ? "Em linha com o mercado" : "Crescendo abaixo do mercado")
        : null;

      // Benchmark gap (additionalData pode ter benchmarkMargin, benchmarkConversion)
      const benchmarkMargin    = toNum(extra.benchmarkGrossMargin);
      const benchmarkConversion = toNum(extra.benchmarkConversion);

      const hasData = marketShare !== null || growthGap !== null;
      const score = growthGap !== null
        ? Math.min(100, Math.max(0, 60 + growthGap * 2)) : hasData ? 50 : null;

      return {
        marketShare, marketSize, marketGrowth,
        companyGrowth, growthGap, growthPosition,
        benchmarkGrossMargin: benchmarkMargin,
        benchmarkConversion,
        note: hasData ? null : "Insira dados de mercado na aba Dados → Mercado",
        score,
      };
    }

    case "network": {
      const extra = (data.additionalData ?? {}) as Record<string, unknown>;
      const networkScore  = toNum(extra.networkEfficiencyIndex);   // 0–100
      const gapToIdeal    = toNum(extra.gapToIdealModel);           // % gap
      const networkRank   = toNum(extra.networkRank);               // posição no ranking
      const totalUnits    = toNum(extra.totalNetworkUnits);

      const hasData = networkScore !== null || gapToIdeal !== null;
      return {
        networkEfficiencyIndex: networkScore,
        gapToIdealModel: gapToIdeal,
        networkRank,
        totalNetworkUnits: totalUnits,
        note: hasData ? null : "Requer pertencer a uma rede — dados comparativos inseridos pelo consultor",
        score: networkScore,
      };
    }

    // ── MOTOR ESTRATÉGICO ────────────────────────────────────────────────────
    case "strategy": {
      const extra  = (data.additionalData ?? {}) as Record<string, unknown>;
      const netRev = toNum(data.netRevenue);

      // Crescimento de receita (YoY%) — informado via additionalData
      const revenueGrowthPct      = toNum(extra.revenueGrowthPct);    // %
      // Concentração de portfólio — % da receita do produto/serviço principal
      const topProductPct         = toNum(extra.topProductPct);        // %
      // Inovação / novos mercados — % da receita oriunda de novos produtos ou mercados (< 2 anos)
      const newMarketsRevenuePct  = toNum(extra.newMarketsRevenuePct); // %
      // Posição competitiva subjetiva (1 = fraco, 10 = líder de mercado)
      const competitivePosition   = toNum(extra.competitivePosition);  // 1–10
      // Anos em operação
      const businessAgeYears      = toNum(extra.businessAgeYears);

      // ── Classificação de Crescimento ────────────────────────────────────
      const growthClass = revenueGrowthPct !== null
        ? revenueGrowthPct > 20 ? "Acelerada"
        : revenueGrowthPct > 10 ? "Sustentada"
        : revenueGrowthPct > 0  ? "Estável"
        : revenueGrowthPct > -10 ? "Regressão Leve"
        : "Regressão Severa"
        : null;

      // ── Risco de Concentração de Portfólio ──────────────────────────────
      const portfolioConcentrationRisk = topProductPct !== null
        ? topProductPct > 80 ? "Crítico"
        : topProductPct > 60 ? "Alto"
        : topProductPct > 40 ? "Médio"
        : "Baixo"
        : null;

      // ── Índice de Inovação — % da receita de novos mercados/produtos ────
      const innovationShareClass = newMarketsRevenuePct !== null
        ? newMarketsRevenuePct > 20 ? "Alto"
        : newMarketsRevenuePct > 10 ? "Médio"
        : "Baixo"
        : null;

      // ── Maturidade do Negócio ───────────────────────────────────────────
      const maturityClass = businessAgeYears !== null
        ? businessAgeYears < 2  ? "Startup"
        : businessAgeYears < 5  ? "Crescimento"
        : businessAgeYears < 10 ? "Consolidação"
        : "Maturidade"
        : null;

      // ── Score Estratégico (composto) ────────────────────────────────────
      const growthScore      = revenueGrowthPct !== null
        ? Math.min(100, Math.max(0, 50 + revenueGrowthPct * 2)) : null;
      const portfolioScore   = topProductPct !== null
        ? Math.max(0, 100 - topProductPct)  : null; // menor concentração = melhor
      const innovationScore  = newMarketsRevenuePct !== null
        ? Math.min(100, newMarketsRevenuePct * 3) : null; // 33% novo = score 100
      const competitiveScore = competitivePosition !== null
        ? Math.round(competitivePosition * 10) : null; // 1–10 → 10–100

      const score = calcScore([growthScore, portfolioScore, innovationScore, competitiveScore]);

      const hasData = revenueGrowthPct !== null || topProductPct !== null || newMarketsRevenuePct !== null;

      return {
        revenueGrowthPct,
        growthClassification:           growthClass,
        topProductConcentrationPct:     topProductPct,
        portfolioConcentrationRisk,
        newMarketsRevenuePct,
        innovationShareClassification:  innovationShareClass,
        competitivePosition,
        businessAgeYears,
        maturityClassification:         maturityClass,
        netRevenue:                     netRev !== null ? Math.round(netRev) : null,
        score,
        note: hasData ? null : "Insira dados estratégicos na aba Dados → Estratégia",
      };
    }

    default: return { score: null };
  }
}

function calcScore(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

// Weighted score: normalizes only by the sum of weights whose component is non-null.
// This ensures all-100 inputs → 100 and partial inputs are not penalized for missing weights.
// e.g. weights [0.3, 0.3, 0.25, 0.15] with first two = 100, rest null → (30+30)/(0.3+0.3) = 100
function calcWeightedScore(components: { value: number | null; weight: number }[]): number | null {
  const active = components.filter((c): c is { value: number; weight: number } => c.value !== null);
  if (active.length === 0) return null;
  const totalWeight = active.reduce((s, c) => s + c.weight, 0);
  if (totalWeight === 0) return null;
  return Math.round(active.reduce((s, c) => s + c.value * (c.weight / totalWeight), 0));
}

export function buildFindings(results: Record<string, unknown>, data: any, scoreThresholds?: unknown): any[] {
  const findings = [];
  for (const [engine, result] of Object.entries(results)) {
    const r = result as any;
    if (!r || r.status === "no_data") continue;
    const score = r.score ?? 50;
    const impact = scorePriority(score, scoreThresholds) ?? "medium";
    findings.push({
      engine,
      title: engineTitle(engine),
      impact,
      summary: buildSummary(engine, r),
      metrics: r,
    });
  }
  return findings;
}

export function buildBluf(findings: any[]): string {
  return buildPriorityBluf(findings);
}

function engineTitle(engine: string): string {
  const titles: Record<string, string> = {
    financial: "Desempenho Financeiro", commercial: "Resultados Comerciais",
    marketing: "Marketing & NPS", operations: "Eficiência Operacional",
    hr: "Recursos Humanos", risks: "Gestão de Riscos",
    innovation: "Inovação", market_intelligence: "Inteligência de Mercado",
    network: "Desempenho da Rede", strategy: "Posicionamento Estratégico",
  };
  return titles[engine] ?? engine;
}

function buildSummary(engine: string, result: any): string {
  if (engine === "financial") {
    const parts: string[] = [];
    if (result.contributionMarginPct != null) parts.push(`MC: ${result.contributionMarginPct.toFixed(1)}%`);
    if (result.ebitdaMargin != null)          parts.push(`EBITDA: ${result.ebitdaMargin.toFixed(1)}%`);
    if (result.safetyMarginClass)             parts.push(`Margem de segurança: ${result.safetyMarginClass}`);
    if (result.cashCycle != null)             parts.push(`Ciclo de caixa: ${result.cashCycle} dias`);
    return parts.length > 0 ? parts.join(" · ") : "Dados financeiros insuficientes para análise completa";
  }
  if (engine === "commercial") {
    const parts: string[] = [];
    // conversionRate and churnRate stored as % (e.g. 12.5 = 12.5%) — display directly, no * 100
    if (result.conversionRate != null) parts.push(`Conversão: ${Number(result.conversionRate).toFixed(1)}%`);
    if (result.averageTicket != null)  parts.push(`Ticket: R$ ${Number(result.averageTicket).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`);
    if (result.churnRate != null)      parts.push(`Churn: ${Number(result.churnRate).toFixed(1)}%`);
    if (result.estimatedLTV != null)   parts.push(`LTV: R$ ${result.estimatedLTV.toLocaleString("pt-BR")}`);
    if (result.cac != null)            parts.push(`CAC: R$ ${result.cac.toLocaleString("pt-BR")}`);
    if (result.ltvCacRatio != null)    parts.push(`LTV/CAC: ${result.ltvCacRatio}× (${result.ltvCacClassification})`);
    return parts.join(" · ") || "Dados comerciais insuficientes";
  }
  if (engine === "marketing") {
    const parts: string[] = [];
    if (result.npsClassification)       parts.push(`NPS: ${result.nps} pts (${result.npsClassification})`);
    if (result.ctr != null)             parts.push(`CTR: ${result.ctr}% (${result.ctrClassification})`);
    if (result.cpl != null)             parts.push(`CPL: R$ ${result.cpl.toLocaleString("pt-BR")}`);
    if (result.roas != null)            parts.push(`ROAS: ${result.roas}× (${result.roasClassification})`);
    if (result.roiMarketing != null)    parts.push(`ROI: ${result.roiMarketing > 0 ? "+" : ""}${result.roiMarketing}%`);
    if (result.ltvCacRatio != null)     parts.push(`LTV/CAC: ${result.ltvCacRatio}× (${result.ltvCacClassification})`);
    return parts.join(" · ") || "NPS não informado";
  }
  if (engine === "operations") {
    const parts: string[] = [];
    if (result.revenuePerEmployee != null)     parts.push(`Receita/col: R$ ${result.revenuePerEmployee.toLocaleString("pt-BR")}`);
    if (result.capacityUtilization != null)    parts.push(`Utilização: ${result.capacityUtilization}% (${result.utilizationClassification})`);
    if (result.oeeIndex != null)               parts.push(`OEE: ${result.oeeIndex}% (${result.oeeClassification})`);
    if (result.bottleneckStage)                parts.push(`Gargalo: ${result.bottleneckStage}`);
    if (result.qualityRate != null)            parts.push(`Qualidade: ${result.qualityRate}% (${result.qualityClassification})`);
    return parts.join(" · ") || "Dados operacionais insuficientes";
  }
  if (engine === "hr") {
    const parts: string[] = [];
    if (result.retentionRate != null)           parts.push(`Retenção: ${result.retentionRate}% (Turnover: ${result.turnoverClassification})`);
    if (result.turnoverCostTotal != null)       parts.push(`Custo turnover: R$ ${result.turnoverCostTotal.toLocaleString("pt-BR")}`);
    if (result.trainingRoi != null)             parts.push(`ROI treinamento: ${result.trainingRoi}× (${result.trainingRoiClassification})`);
    if (result.revenuePerEmployee != null)      parts.push(`Receita/col: R$ ${result.revenuePerEmployee.toLocaleString("pt-BR")}`);
    return parts.join(" · ") || "Dados de RH insuficientes";
  }
  if (engine === "risks") {
    const parts: string[] = [];
    if (result.riskLevel)                         parts.push(`Risco geral: ${result.riskLevel}`);
    if (result.defaultRisk)                       parts.push(`Inadimplência: ${result.defaultRisk}`);
    if (result.leverageRisk)                      parts.push(`Alavancagem: ${result.leverageRisk}`);
    if (result.concentrationRisk)                 parts.push(`Concentração: ${result.concentrationRisk}`);
    if (result.totalExpectedLoss != null)         parts.push(`Perda esperada: R$ ${result.totalExpectedLoss.toLocaleString("pt-BR")}`);
    if (result.overallExposure)                   parts.push(`Exposição: ${result.overallExposure}`);
    return parts.join(" · ") || "Dados de risco insuficientes";
  }
  if (engine === "innovation") {
    if (result.automationRoi != null)  return `ROI de automação: ${result.automationRoi}× · Payback: ${result.paybackMonths} meses`;
    if (result.manualCostAnnual != null) return `Custo manual anual: R$ ${result.manualCostAnnual.toLocaleString("pt-BR")}`;
    return result.note ?? "Dados de inovação não informados";
  }
  if (engine === "market_intelligence") {
    const parts: string[] = [];
    if (result.marketShare != null)  parts.push(`Market share: ${result.marketShare}%`);
    if (result.growthPosition)       parts.push(result.growthPosition);
    if (result.growthGap != null)    parts.push(`Gap vs mercado: ${result.growthGap > 0 ? "+" : ""}${result.growthGap}pp`);
    return parts.join(" · ") || result.note || "Dados de mercado não informados";
  }
  if (engine === "network") {
    if (result.networkEfficiencyIndex != null)
      return `Índice de Eficiência: ${result.networkEfficiencyIndex} · ${result.networkRank != null ? `Posição: #${result.networkRank}` : ""}`;
    return result.note ?? "Dados de rede não disponíveis";
  }
  if (engine === "strategy") {
    const parts: string[] = [];
    if (result.growthClassification)          parts.push(`Crescimento: ${result.growthClassification}`);
    if (result.portfolioConcentrationRisk)    parts.push(`Concentração de portfólio: ${result.portfolioConcentrationRisk}`);
    if (result.competitivePosition != null)   parts.push(`Posição competitiva: ${result.competitivePosition}/10`);
    if (result.maturityClassification)        parts.push(`Maturidade: ${result.maturityClassification}`);
    return parts.join(" · ") || result.note || "Dados estratégicos não informados";
  }
  return "Análise concluída. Verifique as métricas para detalhes.";
}

export default router;
