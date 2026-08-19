import { Router } from "express";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { networks, companies, companyData } from "@workspace/db/schema";
import { requireAuth } from "../middlewares/requireAuth";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import {
  computeBenchmark,
  computeGaps,
  computeGapsPct,
  computeGoldStandard,
  computeMetrics,
  findPreviousPeriod as findPreviousPeriodInList,
  METRIC_DEFS,
  type Metrics,
} from "./networksMetrics";
import { createGapHistoryRouter } from "./networkGapHistory";

const router = Router();

function canAccess(user: any, network: any): boolean {
  return user.role === "admin" || network.ownerId === user.id;
}

// ── GET /api/networks ────────────────────────────────────────────────────────
router.get("/", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const rows = await db.select().from(networks).orderBy(desc(networks.createdAt));
  const accessible = user.role === "admin" ? rows : rows.filter((n) => n.ownerId === user.id);
  const result = await Promise.all(accessible.map(async (n) => {
    const units = await db.select().from(companies).where(eq(companies.networkId, n.id));
    return { id: n.id, name: n.name, description: n.description, ownerId: n.ownerId, unitCount: units.length, createdAt: n.createdAt };
  }));
  res.json(result);
});

// ── POST /api/networks ───────────────────────────────────────────────────────
router.post("/", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const { name, description } = req.body;
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  const [network] = await db.insert(networks).values({ name, description, ownerId: user.id }).returning();
  res.status(201).json({ id: network.id, name: network.name, description: network.description, ownerId: network.ownerId, unitCount: 0, createdAt: network.createdAt });
});

// ── GET /api/networks/:id ────────────────────────────────────────────────────
router.get("/:id", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const [network] = await db.select().from(networks).where(eq(networks.id, id)).limit(1);
  if (!network) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccess(user, network)) { res.status(403).json({ error: "Forbidden" }); return; }
  const units = await db.select().from(companies).where(eq(companies.networkId, id));
  res.json({
    id: network.id, name: network.name, description: network.description, ownerId: network.ownerId,
    units: units.map((c) => ({ id: c.id, name: c.name, segment: c.segment, activity: c.activity, businessModel: c.businessModel, networkId: c.networkId, ownerId: c.ownerId, createdAt: c.createdAt })),
    createdAt: network.createdAt,
  });
});

// ── PATCH /api/networks/:id ──────────────────────────────────────────────────
router.patch("/:id", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const [network] = await db.select().from(networks).where(eq(networks.id, id)).limit(1);
  if (!network) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccess(user, network)) { res.status(403).json({ error: "Forbidden" }); return; }
  const { name, description } = req.body;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  const [updated] = await db.update(networks).set(updates).where(eq(networks.id, id)).returning();
  const units = await db.select().from(companies).where(eq(companies.networkId, id));
  res.json({ id: updated.id, name: updated.name, description: updated.description, ownerId: updated.ownerId, unitCount: units.length, createdAt: updated.createdAt });
});

// ── DELETE /api/networks/:id ─────────────────────────────────────────────────
router.delete("/:id", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const [network] = await db.select().from(networks).where(eq(networks.id, id)).limit(1);
  if (!network) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccess(user, network)) { res.status(403).json({ error: "Forbidden" }); return; }

  // Bloqueia exclusão se ainda há unidades vinculadas
  const linked = await db.select({ id: companies.id }).from(companies).where(eq(companies.networkId, id));
  if (linked.length > 0) {
    res.status(409).json({
      error: `Esta rede possui ${linked.length} unidade${linked.length > 1 ? "s" : ""} vinculada${linked.length > 1 ? "s" : ""}. Desvincule todas as unidades antes de excluir a rede.`,
    });
    return;
  }

  await db.delete(networks).where(eq(networks.id, id));
  res.status(204).end();
});

// ── GET /api/networks/:id/periods — períodos com dados por número de unidades ─
router.get("/:id/periods", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const [network] = await db.select().from(networks).where(eq(networks.id, id)).limit(1);
  if (!network) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccess(user, network)) { res.status(403).json({ error: "Forbidden" }); return; }
  const units = await db.select({ id: companies.id }).from(companies).where(eq(companies.networkId, id));
  if (!units.length) { res.json([]); return; }
  const unitIds = units.map((u) => u.id);
  const rows = await db
    .select({ period: companyData.period, unitCount: sql<number>`count(distinct ${companyData.companyId})::int` })
    .from(companyData)
    .where(inArray(companyData.companyId, unitIds))
    .groupBy(companyData.period)
    .orderBy(desc(companyData.period));
  res.json(rows);
});

// Calculation helpers are database-free so route-independent tests can cover
// the Padrão Ouro and gap rules without a Clerk session.

// ── Find the period immediately before `period` among the network's units ────
async function findPreviousPeriod(unitIds: number[], period: string): Promise<string | null> {
  if (!unitIds.length) return null;
  const rows = await db
    .selectDistinct({ period: companyData.period })
    .from(companyData)
    .where(inArray(companyData.companyId, unitIds));
  return findPreviousPeriodInList(rows.map((row) => row.period), period);
}

router.use(createGapHistoryRouter({
  database: db,
  authMiddleware: requireAuth,
  tables: { networks, companies, companyData },
}));

// ── GET /api/networks/:id/ranking ────────────────────────────────────────────
router.get("/:id/ranking", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const period = String(req.query.period ?? "");
  const [network] = await db.select().from(networks).where(eq(networks.id, id)).limit(1);
  if (!network) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccess(user, network)) { res.status(403).json({ error: "Forbidden" }); return; }

  const units = await db.select().from(companies).where(eq(companies.networkId, id));
  const prevPeriod = period ? await findPreviousPeriod(units.map((u) => u.id), period) : null;

  const unitsWithMetrics = await Promise.all(units.map(async (c) => {
    const [data] = period
      ? await db.select().from(companyData).where(and(eq(companyData.companyId, c.id), eq(companyData.period, period))).limit(1)
      : [];
    const [prev] = data && prevPeriod
      ? await db.select().from(companyData).where(and(eq(companyData.companyId, c.id), eq(companyData.period, prevPeriod))).limit(1)
      : [];
    return { companyId: c.id, companyName: c.name, metrics: data ? computeMetrics(data, prev) : null, hasData: !!data };
  }));

  const withData = unitsWithMetrics.filter((u) => u.hasData && u.metrics) as { companyId: number; companyName: string; metrics: Metrics; hasData: true }[];
  const goldStandard = computeGoldStandard(withData);
  const benchmark = computeBenchmark(withData);
  // idealModel: composite "ideal unit" made of the gold value per dimension
  const idealModel = Object.fromEntries(Object.entries(goldStandard).map(([k, v]) => [k, v.value]));

  const ranked = unitsWithMetrics.map((u) => {
    const gaps = u.hasData && u.metrics ? computeGaps(u.metrics, goldStandard) : null;
    return {
      companyId: u.companyId,
      companyName: u.companyName,
      hasData: u.hasData,
      metrics: u.metrics,
      gaps,
      gapsPct: gaps ? computeGapsPct(gaps, goldStandard) : null,
      rank: 0,
    };
  });

  // rank by netRevenue descending among units with data
  const withDataSorted = ranked.filter((u) => u.hasData && u.metrics?.netRevenue != null)
    .sort((a, b) => (b.metrics?.netRevenue ?? 0) - (a.metrics?.netRevenue ?? 0));
  withDataSorted.forEach((u, i) => { u.rank = i + 1; });

  res.json({ networkId: id, networkName: network.name, period, prevPeriod, unitCount: units.length, unitsWithData: withData.length, goldStandard, benchmark, idealModel, metricDefs: METRIC_DEFS, units: ranked });
});

// ── POST /api/networks/:id/diagnosis-ai — SSE narrativa IA ──────────────────
router.post("/:id/diagnosis-ai", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const { period } = req.body as { period: string };
  if (!period) { res.status(400).json({ error: "period required" }); return; }

  const [network] = await db.select().from(networks).where(eq(networks.id, id)).limit(1);
  if (!network) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccess(user, network)) { res.status(403).json({ error: "Forbidden" }); return; }

  const units = await db.select().from(companies).where(eq(companies.networkId, id));
  const prevPeriod = await findPreviousPeriod(units.map((u) => u.id), period);
  const dataRows = await Promise.all(units.map(async (c) => {
    const [data] = await db.select().from(companyData).where(and(eq(companyData.companyId, c.id), eq(companyData.period, period))).limit(1);
    const [prev] = data && prevPeriod
      ? await db.select().from(companyData).where(and(eq(companyData.companyId, c.id), eq(companyData.period, prevPeriod))).limit(1)
      : [];
    return { company: c, data: data ?? null, prev: prev ?? null };
  }));

  const withData = dataRows.filter((r) => r.data != null) as { company: typeof units[number]; data: NonNullable<typeof dataRows[number]["data"]> }[];
  if (withData.length < 2) {
    res.status(422).json({ error: "São necessárias pelo menos 2 unidades com dados para gerar a análise." }); return;
  }

  const unitsWithMetrics = withData.map((r) => ({ companyId: r.company.id, companyName: r.company.name, metrics: computeMetrics(r.data, (r as any).prev) }));
  const goldStandard = computeGoldStandard(unitsWithMetrics);
  const systemPrompt = buildNetworkContext(network.name, period, unitsWithMetrics, goldStandard);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const stream = anthropic.messages.stream({
      model: "claude-opus-4-5",
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: "user", content: "Gere o diagnóstico completo da rede agora." }],
    });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta")
        res.write(`data: ${JSON.stringify({ type: "text", text: event.delta.text })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
  }
  res.end();
});

// ── Build network context for IA ─────────────────────────────────────────────
function buildNetworkContext(
  networkName: string,
  period: string,
  units: { companyId: number; companyName: string; metrics: Metrics }[],
  gold: ReturnType<typeof computeGoldStandard>,
): string {
  const brl = (v: number | null) => v != null ? `R$ ${Math.round(v).toLocaleString("pt-BR")}` : "n/d";
  const pct = (v: number | null) => v != null ? `${v.toFixed(1)}%` : "n/d";
  const num = (v: number | null) => v != null ? v.toFixed(0) : "n/d";

  const header = `Você é GESAIA, consultor de inteligência gerencial especializado em análise de redes de franquias e multi-unidades.

REDE: ${networkName}
PERÍODO: ${period}
UNIDADES ANALISADAS: ${units.length}

PADRÃO OURO (melhor valor por dimensão):
- MC %: ${pct(gold.mcPct?.value ?? null)} (${gold.mcPct?.companyName ?? "n/d"})
- Margem Operacional: ${pct(gold.ebitPct?.value ?? null)} (${gold.ebitPct?.companyName ?? "n/d"})
- Margem Líquida: ${pct(gold.netProfitPct?.value ?? null)} (${gold.netProfitPct?.companyName ?? "n/d"})
- Ciclo de Caixa: ${num(gold.cashCycle?.value ?? null)} dias (${gold.cashCycle?.companyName ?? "n/d"})
- NPS: ${num(gold.nps?.value ?? null)} pts (${gold.nps?.companyName ?? "n/d"})
- Churn: ${pct(gold.churnPct?.value ?? null)} (${gold.churnPct?.companyName ?? "n/d"})
- Ticket Médio: ${brl(gold.averageTicket?.value ?? null)} (${gold.averageTicket?.companyName ?? "n/d"})
- Clientes Ativos (crescimento %): ${pct(gold.activeCustomersGrowthPct?.value ?? null)} (${gold.activeCustomersGrowthPct?.companyName ?? "n/d"})

DADOS POR UNIDADE:`;

  const unitBlocks = units.map((u) => {
    const m = u.metrics;
    const gaps = computeGaps(m, gold);
    const gapStr = (key: keyof typeof gaps) => {
      const v = gaps[key]; if (v == null) return "n/d";
      if (Math.abs(v) < 0.1) return "✓ no padrão ouro";
      return `${v.toFixed(1)} abaixo do ouro`;
    };
    return `
UNIDADE: ${u.companyName}
  Receita Líquida: ${brl(m.netRevenue)}
  MC %: ${pct(m.mcPct)} | Gap: ${gapStr("mcPct")}
  Margem Operacional: ${pct(m.ebitPct)} | Gap: ${gapStr("ebitPct")}
  Margem Líquida: ${pct(m.netProfitPct)} | Gap: ${gapStr("netProfitPct")}
  Ciclo de Caixa: ${num(m.cashCycle)} dias | Gap: ${gapStr("cashCycle")}
  NPS: ${num(m.nps)} | Gap: ${gapStr("nps")}
  Churn: ${pct(m.churnPct)} | Gap: ${gapStr("churnPct")}
  Ticket Médio: ${brl(m.averageTicket)} | Gap: ${gapStr("averageTicket")}
  Clientes Ativos (crescimento %): ${pct(m.activeCustomersGrowthPct)} | Gap: ${gapStr("activeCustomersGrowthPct")}`;
  }).join("\n");

  return `${header}${unitBlocks}

MISSÃO:
Gere um diagnóstico completo da rede no formato abaixo. Seja específico com números reais. Nomeie as unidades pelo nome.

**SAÚDE GERAL DA REDE**
Uma avaliação direta do estado atual da rede — dispersão de resultados, nível de padronização, pontos fortes coletivos.

**PADRÃO OURO — QUEM DEFINE O BENCHMARK**
Para cada dimensão relevante, explique qual unidade define o padrão e o que isso significa na prática para a rede.

**UNIDADES EM DESTAQUE**
As 1 ou 2 unidades que mais se sobressaem e por quê (mesmo que em dimensões diferentes).

**UNIDADES QUE PRECISAM DE ATENÇÃO**
As 1 ou 2 unidades com maiores gaps e quais dimensões específicas precisam de intervenção prioritária.

**RECOMENDAÇÕES PARA A REDE**
3 ações concretas e quantificadas para padronização e melhoria coletiva com base nos dados.

Responda em português brasileiro. Seja direto, quantitativo e acionável.`;
}

export default router;
