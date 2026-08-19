import { Router } from "express";
import { eq, desc, count } from "drizzle-orm";
import { db } from "@workspace/db";
import { companies, networks, investigations, simulations, companyData } from "@workspace/db/schema";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

// GET /api/dashboard
router.get("/", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;

  const [companiesCount] = await db.select({ count: count() }).from(companies).where(eq(companies.ownerId, user.id));
  const [networksCount] = await db.select({ count: count() }).from(networks).where(eq(networks.ownerId, user.id));

  const userCompanies = await db.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, user.id));
  const companyIds = userCompanies.map((c) => c.id);

  let totalInvestigations = 0;
  let openInvestigations = 0;
  let totalSimulations = 0;

  if (companyIds.length > 0) {
    const invs = await db.select().from(investigations).where(
      companyIds.length === 1
        ? eq(investigations.companyId, companyIds[0])
        : eq(investigations.companyId, companyIds[0]) // simplified for now
    );
    totalInvestigations = invs.length;
    openInvestigations = invs.filter((i) => i.status === "open" || i.status === "in_progress").length;

    const sims = await db.select().from(simulations).where(eq(simulations.companyId, companyIds[0] ?? -1));
    totalSimulations = sims.length;
  }

  res.json({
    totalCompanies: Number(companiesCount.count),
    totalNetworks: Number(networksCount.count),
    totalInvestigations,
    openInvestigations,
    totalSimulations,
    recentActivity: [],
  });
});

// GET /api/companies/:id/dashboard
router.get("/companies/:id", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const period = String(req.query.period ?? "");

  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Not found" }); return; }
  if (user.role !== "admin" && company.ownerId !== user.id) { res.status(403).json({ error: "Forbidden" }); return; }

  // Get latest data
  const dataRows = await db.select().from(companyData).where(eq(companyData.companyId, id)).orderBy(desc(companyData.updatedAt));
  const latestData = period ? dataRows.find((r) => r.period === period) : dataRows[0];

  const kpis = buildKpis(latestData);
  const alerts = buildAlerts(latestData);

  const recentInvestigations = (await db.select().from(investigations).where(eq(investigations.companyId, id)).orderBy(desc(investigations.createdAt)).limit(5))
    .map((i) => ({ id: i.id, companyId: i.companyId, title: i.title, status: i.status, period: i.period, createdAt: i.createdAt }));

  const recentSimulations = (await db.select().from(simulations).where(eq(simulations.companyId, id)).orderBy(desc(simulations.createdAt)).limit(5))
    .map((s) => ({ id: s.id, companyId: s.companyId, name: s.name, type: s.type, parameters: s.parameters, results: s.results, createdAt: s.createdAt }));

  res.json({ companyId: id, period: latestData?.period ?? period, kpis, alerts, recentInvestigations, recentSimulations });
});

// GET /api/companies/:id/dashboard/kpi-history
router.get("/companies/:id/kpi-history", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);

  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Not found" }); return; }
  if (user.role !== "admin" && company.ownerId !== user.id) { res.status(403).json({ error: "Forbidden" }); return; }

  const rows = await db.select().from(companyData).where(eq(companyData.companyId, id)).orderBy(companyData.period);
  res.json(rows.map((r) => {
    const netRev = r.netRevenue != null ? Number(r.netRevenue) : null;
    const varC   = r.variableCosts != null ? Number(r.variableCosts) : null;
    const fixedC = r.fixedCosts != null ? Number(r.fixedCosts) : null;
    const mc     = netRev !== null && varC !== null ? netRev - varC : null;
    const mcPct  = mc !== null && netRev !== null && netRev > 0 ? (mc / netRev) * 100 : null;
    const pe     = mc !== null && netRev !== null && fixedC !== null && mc > 0 ? fixedC / (mc / netRev) : null;
    const safety = pe !== null && netRev !== null && netRev > 0 ? ((netRev - pe) / netRev) * 100 : null;
    return {
      period: r.period,
      netRevenue: netRev,
      grossMargin: r.grossRevenue && r.grossProfit ? Number(r.grossProfit) / Number(r.grossRevenue) * 100 : null,
      ebitdaMargin: netRev && r.ebitda ? Number(r.ebitda) / netRev * 100 : null,
      netMargin: netRev && r.netProfit ? Number(r.netProfit) / netRev * 100 : null,
      contributionMarginPct: mcPct,
      safetyMargin: safety,
      averageTicket: r.averageTicket != null ? Number(r.averageTicket) : null,
    };
  }));
});

function n(v: any) { return v != null ? Number(v) : null; }
function pctOf(a: number | null, b: number | null) {
  return a !== null && b !== null && b !== 0 ? (a / b) * 100 : null;
}

function buildKpis(data: any): any[] {
  if (!data) return [];
  const kpis: any[] = [];

  const netRev  = n(data.netRevenue);
  const grossRev = n(data.grossRevenue);
  const cogs    = n(data.cogs);
  const grossPr = n(data.grossProfit) ?? (netRev !== null && cogs !== null ? netRev - cogs : null);
  const varC    = n(data.variableCosts);
  const fixedC  = n(data.fixedCosts);
  const ebitda  = n(data.ebitda);
  const netPr   = n(data.netProfit);

  if (netRev !== null)
    kpis.push({ key: "netRevenue", label: "Receita Líquida", value: netRev, unit: "BRL", status: "neutral" });

  // Margem de Contribuição
  const mc    = netRev !== null && varC !== null ? netRev - varC : null;
  const mcPct = pctOf(mc, netRev);
  if (mcPct !== null)
    kpis.push({ key: "contributionMargin", label: "Margem de Contribuição", value: mcPct, unit: "%", status: mcPct >= 40 ? "good" : mcPct >= 20 ? "warning" : "critical" });

  // Margem bruta
  const grossMargin = pctOf(grossPr, grossRev ?? netRev);
  if (grossMargin !== null)
    kpis.push({ key: "grossMargin", label: "Margem Bruta", value: grossMargin, unit: "%", status: grossMargin >= 40 ? "good" : grossMargin >= 20 ? "warning" : "critical" });

  // Margem EBITDA
  const ebitdaMargin = pctOf(ebitda, netRev);
  if (ebitdaMargin !== null)
    kpis.push({ key: "ebitdaMargin", label: "Margem EBITDA", value: ebitdaMargin, unit: "%", status: ebitdaMargin >= 15 ? "good" : ebitdaMargin >= 5 ? "warning" : "critical" });

  // Margem líquida
  const netMargin = pctOf(netPr, netRev);
  if (netMargin !== null)
    kpis.push({ key: "netMargin", label: "Margem Líquida", value: netMargin, unit: "%", status: netMargin >= 10 ? "good" : netMargin >= 0 ? "warning" : "critical" });

  // Ponto de Equilíbrio
  if (mc !== null && netRev !== null && fixedC !== null && mc > 0) {
    const pe = fixedC / (mc / netRev);
    const safetyMargin = ((netRev - pe) / netRev) * 100;
    kpis.push({ key: "breakEven", label: "Ponto de Equilíbrio", value: Math.round(pe), unit: "BRL", status: safetyMargin >= 20 ? "good" : safetyMargin >= 5 ? "warning" : "critical" });
    kpis.push({ key: "safetyMargin", label: "Margem de Segurança", value: safetyMargin, unit: "%", status: safetyMargin >= 20 ? "good" : safetyMargin >= 0 ? "warning" : "critical" });
  }

  // NPS
  if (data.nps != null)
    kpis.push({ key: "nps", label: "NPS", value: n(data.nps), unit: "pts", status: n(data.nps)! >= 50 ? "good" : n(data.nps)! >= 0 ? "warning" : "critical" });

  // Ciclo de caixa (se disponível)
  const pmr = n(data.pmr), pmp = n(data.pmp), pme = n(data.pme);
  if (pmr !== null && pmp !== null && pme !== null) {
    const cashCycle = pme + pmr - pmp;
    kpis.push({ key: "cashCycle", label: "Ciclo de Caixa", value: cashCycle, unit: "dias", status: cashCycle <= 15 ? "good" : cashCycle <= 30 ? "warning" : "critical" });
  }

  return kpis;
}

function buildAlerts(data: any): any[] {
  if (!data) return [];
  const alerts: any[] = [];

  if (data.defaultRate != null && Number(data.defaultRate) > 0.05)
    alerts.push({ id: "default-rate-high", severity: "high", message: `Inadimplência em ${(Number(data.defaultRate) * 100).toFixed(1)}% — acima do limite de 5%`, engine: "risks" });

  if (data.churnRate != null && Number(data.churnRate) > 0.1)
    alerts.push({ id: "churn-high", severity: "medium", message: `Churn em ${(Number(data.churnRate) * 100).toFixed(1)}% — revise estratégias de retenção`, engine: "commercial" });

  // Alerta se receita < ponto de equilíbrio
  const netRev = n(data.netRevenue), varC = n(data.variableCosts), fixedC = n(data.fixedCosts);
  if (netRev !== null && varC !== null && fixedC !== null) {
    const mc = netRev - varC;
    if (mc > 0) {
      const pe = fixedC / (mc / netRev);
      if (netRev < pe)
        alerts.push({ id: "below-break-even", severity: "high", message: `Receita abaixo do ponto de equilíbrio (PE: R$ ${Math.round(pe).toLocaleString("pt-BR")})`, engine: "financial" });
    }
  }

  // Alerta margem de contribuição negativa
  if (data.netRevenue != null && data.variableCosts != null && Number(data.variableCosts) > Number(data.netRevenue))
    alerts.push({ id: "negative-mc", severity: "high", message: "Margem de contribuição negativa — custos variáveis excedem a receita líquida", engine: "financial" });

  return alerts;
}

export default router;
