import { Router } from "express";
import { eq, desc, and, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { companies, investigations, conversations, messages, companyData } from "@workspace/db/schema";
import { requireAuth } from "../middlewares/requireAuth";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { validateBridgePeriodOrder } from "./calculationsBridge";

const router = Router();

function canAccess(user: any, company: any) {
  return user.role === "admin" || company.ownerId === user.id;
}

// GET /api/companies/:id/investigations
router.get("/:id/investigations", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccess(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }

  const rows = await db.select().from(investigations).where(eq(investigations.companyId, id)).orderBy(desc(investigations.createdAt));
  res.json(rows.map((r) => ({ id: r.id, companyId: r.companyId, title: r.title, status: r.status, period: r.period, createdAt: r.createdAt })));
});

// POST /api/companies/:id/investigations
router.post("/:id/investigations", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccess(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }

  const { title, period } = req.body;
  if (!title) { res.status(400).json({ error: "title required" }); return; }

  // Create linked conversation
  const [conv] = await db.insert(conversations).values({ title, companyId: id }).returning();
  const [inv] = await db.insert(investigations).values({ companyId: id, title, period: period ?? null, status: "open", conversationId: conv.id }).returning();
  res.status(201).json({ id: inv.id, companyId: inv.companyId, title: inv.title, status: inv.status, period: inv.period, conversationId: inv.conversationId, messages: [], createdAt: inv.createdAt });
});

// GET /api/companies/:id/investigations/:invId
router.get("/:id/investigations/:invId", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const invId = Number(req.params.invId);
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccess(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }

  const [inv] = await db.select().from(investigations).where(eq(investigations.id, invId)).limit(1);
  if (!inv || inv.companyId !== id) { res.status(404).json({ error: "Not found" }); return; }

  let msgs: any[] = [];
  if (inv.conversationId) {
    msgs = await db.select().from(messages).where(eq(messages.conversationId, inv.conversationId));
  }

  res.json({ id: inv.id, companyId: inv.companyId, title: inv.title, status: inv.status, period: inv.period, conversationId: inv.conversationId, messages: msgs, createdAt: inv.createdAt });
});

// PATCH /api/companies/:id/investigations/:invId
router.patch("/:id/investigations/:invId", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const invId = Number(req.params.invId);
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccess(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }

  const [inv] = await db.select().from(investigations).where(eq(investigations.id, invId)).limit(1);
  if (!inv || inv.companyId !== id) { res.status(404).json({ error: "Not found" }); return; }

  const { title, status } = req.body;
  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = title;
  if (status !== undefined) updates.status = status;

  const [updated] = await db.update(investigations).set(updates).where(eq(investigations.id, invId)).returning();
  res.json({ id: updated.id, companyId: updated.companyId, title: updated.title, status: updated.status, period: updated.period, createdAt: updated.createdAt });
});

// POST /api/companies/:id/investigations/:invId/messages — SSE streaming with company context
router.post("/:id/investigations/:invId/messages", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const companyId = Number(req.params.id);
  const invId = Number(req.params.invId);

  const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccess(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }

  const [inv] = await db.select().from(investigations).where(eq(investigations.id, invId)).limit(1);
  if (!inv || inv.companyId !== companyId) { res.status(404).json({ error: "Not found" }); return; }
  if (!inv.conversationId) { res.status(400).json({ error: "Investigation has no conversation" }); return; }

  const { content } = req.body;
  if (!content) { res.status(400).json({ error: "content required" }); return; }

  // ── Buscar dados financeiros da empresa (período vinculado ou mais recente)
  const dataRows = await db.select().from(companyData)
    .where(eq(companyData.companyId, companyId))
    .orderBy(desc(companyData.updatedAt));
  const data = inv.period
    ? (dataRows.find((r) => r.period === inv.period) ?? dataRows[0])
    : dataRows[0];

  // ── Calcular indicadores financeiros para o contexto
  const ctx = buildFinancialContext(company.name, inv, data);

  // ── Persistir mensagem do usuário
  await db.insert(messages).values({ conversationId: inv.conversationId, role: "user", content });

  // ── Histórico completo da conversa
  const history = await db.select().from(messages).where(eq(messages.conversationId, inv.conversationId));
  const claudeMessages = history.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  // ── SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let fullResponse = "";

  try {
    const stream = anthropic.messages.stream({
      model: "claude-opus-4-5",
      max_tokens: 2048,
      system: ctx,
      messages: claudeMessages,
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        const text = event.delta.text;
        fullResponse += text;
        res.write(`data: ${JSON.stringify({ type: "text", text })}\n\n`);
      }
    }

    await db.insert(messages).values({ conversationId: inv.conversationId, role: "assistant", content: fullResponse });
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
  }

  res.end();
});

// POST /api/companies/:id/quick-diagnosis — diagnóstico rápido condicional (SSE)
router.post("/:id/quick-diagnosis", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);

  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccess(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }

  // Dados mais recentes
  const dataRows = await db.select().from(companyData)
    .where(eq(companyData.companyId, id))
    .orderBy(desc(companyData.updatedAt));
  const data = dataRows[0] ?? null;

  // ── Determinar lucratividade com os dados disponíveis ─────────────────────
  const n = (v: any) => (v != null ? Number(v) : null);
  const netRev = data ? n(data.netRevenue) : null;
  const cogs   = data ? n(data.cogs) : null;
  const fixedC = data ? n(data.fixedCosts) : null;
  const varC   = data ? n(data.variableCosts) : null;
  const ebitda = data ? n(data.ebitda) : null;

  // Calcular lucro da forma mais confiável possível
  const mc   = (netRev != null && varC != null) ? netRev - varC : null;
  const result = (mc != null && fixedC != null)
    ? mc - fixedC
    : ebitda;

  const status: "profit" | "loss" | "unknown" =
    result == null ? "unknown" : result > 0 ? "profit" : "loss";

  // ── Prompt condicional ────────────────────────────────────────────────────
  const fakeInv = { title: "Diagnóstico Rápido", period: data?.period ?? null };
  const dataContext = buildFinancialContext(company.name, fakeInv, data);

  const conditionalInstruction = status === "unknown"
    ? `Não há dados financeiros suficientes para determinar a lucratividade. Informe quais dados são necessários e oriente o consultor a cadastrá-los na aba Dados antes de refazer o diagnóstico.`
    : status === "loss"
    ? `A empresa ESTÁ EM PREJUÍZO (resultado estimado: ${result != null ? `R$ ${Math.round(result).toLocaleString("pt-BR")}` : "negativo"}). Seu diagnóstico deve:
1. Identificar as causas-raiz do prejuízo com base nos dados (custo fixo alto? margem insuficiente? volume baixo? ciclo de caixa destruindo o caixa?)
2. Propor 2 a 3 alavancas PRIORITÁRIAS e CONCRETAS para tornar a empresa viável — com metas numéricas específicas (ex: "reduzir custo fixo em R$ X", "aumentar MC% de Y% para Z%", "captar N novos clientes")
3. Indicar qual simulador no GESAIA pode ajudar a quantificar cada alavanca (ex: "use o simulador Ponto de Equilíbrio", "use o simulador Venda Adicional para Cobrir Custo Fixo")`
    : `A empresa ESTÁ LUCRATIVA (resultado estimado: ${result != null ? `R$ ${Math.round(result).toLocaleString("pt-BR")}` : "positivo"}). Seu diagnóstico deve:
1. Identificar o GARGALO atual mais relevante que limita o crescimento ou a rentabilidade
2. Propor 2 a 3 alavancas para MELHORAR o desempenho — sempre com metas numéricas (ex: "elevar MC% de X% para Y%", "reduzir churn de A% para B%", "crescer receita em Z% sem aumentar custo fixo")
3. Indicar qual especialista ou simulador no GESAIA aprofunda cada oportunidade identificada`;

  const systemPrompt = `${dataContext}

MISSÃO DESTE DIAGNÓSTICO:
${conditionalInstruction}

FORMATO OBRIGATÓRIO DA RESPOSTA (use exatamente estas seções com os títulos em negrito):

**VEREDICTO**
Uma frase direta sobre a situação financeira atual, com o número principal.

**DIAGNÓSTICO**
Análise das causas-raiz em 3–5 linhas, referenciando os indicadores reais fornecidos.

**ALAVANCAS PRIORITÁRIAS**
Liste 2 ou 3 ações concretas, cada uma com:
- O problema que resolve
- A meta numérica específica
- O simulador ou especialista do GESAIA mais útil para aprofundar

**PRÓXIMOS PASSOS**
Uma instrução objetiva de onde o consultor deve ir agora dentro do GESAIA.

Responda em português brasileiro. Seja direto, quantitativo e acionável.`;

  // ── SSE ──────────────────────────────────────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Emitir o status antes do streaming para o frontend poder mostrar o banner
  res.write(`data: ${JSON.stringify({ type: "status", status, result: result != null ? Math.round(result) : null })}\n\n`);

  try {
    const stream = anthropic.messages.stream({
      model: "claude-opus-4-5",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: "Gere o diagnóstico agora." }],
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        res.write(`data: ${JSON.stringify({ type: "text", text: event.delta.text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
  }

  res.end();
});

// POST /api/companies/:id/bridge-analysis-ai — análise de evolução por IA (SSE)
router.post("/:id/bridge-analysis-ai", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const { periodBase, periodComp } = req.body as { periodBase: string; periodComp: string };

  if (!periodBase || !periodComp) {
    res.status(400).json({ error: "periodBase e periodComp são obrigatórios" }); return;
  }

  const periodOrderError = validateBridgePeriodOrder(periodBase, periodComp);
  if (periodOrderError) {
    res.status(400).json({ error: periodOrderError }); return;
  }

  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccess(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }

  const dataRows = await db.select().from(companyData)
    .where(and(eq(companyData.companyId, id), inArray(companyData.period, [periodBase, periodComp])));

  const dataBase = dataRows.find(r => r.period === periodBase) ?? null;
  const dataComp = dataRows.find(r => r.period === periodComp) ?? null;

  if (!dataBase || !dataComp) {
    res.status(422).json({ error: "Dados não encontrados para um ou ambos os períodos selecionados" }); return;
  }

  const systemPrompt = `${buildComparisonContext(company.name, dataBase, dataComp)}

MISSÃO DESTA ANÁLISE:
Explique o que mudou entre os dois períodos, por que provavelmente mudou, e o que o consultor deve fazer a respeito.

FORMATO OBRIGATÓRIO DA RESPOSTA (use exatamente estas seções com os títulos em negrito):

**RESUMO DA EVOLUÇÃO**
Uma frase direta sobre a direção geral (melhorou, piorou, ou ficou estável) com os números principais.

**O QUE MUDOU E POR QUÊ**
Analise as 2 ou 3 variações de maior impacto explicando prováveis causas com base nos dados. Seja específico com os números.

**ALERTAS**
Pontos de atenção — indicadores que pioraram ou que representam risco mesmo quando o resultado geral melhorou.

**RECOMENDAÇÕES**
2 ou 3 ações concretas e quantificadas para o próximo período com base no que os dados revelam.

Responda em português brasileiro. Seja direto, quantitativo e acionável.`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const stream = anthropic.messages.stream({
      model: "claude-opus-4-5",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: "Gere a análise de evolução agora." }],
    });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        res.write(`data: ${JSON.stringify({ type: "text", text: event.delta.text })}\n\n`);
      }
    }
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
  }
  res.end();
});

// ── Monta contexto comparativo entre dois períodos para a IA ─────────────────
function buildComparisonContext(companyName: string, base: any, comp: any): string {
  const n = (v: any) => (v != null ? Number(v) : null);
  const brl = (v: number | null) => (v != null ? `R$ ${Math.round(v).toLocaleString("pt-BR")}` : "não informado");
  const pct = (v: number | null) => (v != null ? `${v.toFixed(1)}%` : "não informado");
  const d   = (a: number | null, b: number | null) => (a != null && b != null ? b - a : null);
  const dPct= (a: number | null, b: number | null) => (a != null && b != null && a !== 0 ? ((b - a) / Math.abs(a)) * 100 : null);
  const sign= (v: number | null) => v == null ? "n/d" : `${v >= 0 ? "+" : ""}${brl(Math.abs(v))}${v < 0 ? " (queda)" : " (alta)"}`;
  const sp  = (v: number | null) => v == null ? "" : ` (${v >= 0 ? "+" : ""}${v.toFixed(1)}%)`;

  const row = (label: string, bv: number | null, cv: number | null, invert = false) => {
    const delta = d(bv, cv); const dp = dPct(bv, cv);
    const dir = delta == null ? "" : (invert ? (delta < 0 ? "▼ melhor" : "▲ pior") : (delta >= 0 ? "▲ melhor" : "▼ pior"));
    return `${label}: ${brl(bv)} → ${brl(cv)} | Δ ${sign(delta)}${sp(dp)} ${dir}`;
  };

  const netB = n(base.netRevenue),    netC = n(comp.netRevenue);
  const cogsB= n(base.cogs),          cogsC= n(comp.cogs);
  const fixB = n(base.fixedCosts),    fixC = n(comp.fixedCosts);
  const varB = n(base.variableCosts), varC = n(comp.variableCosts);
  const daB  = n(base.depreciationAmortization), daC = n(comp.depreciationAmortization);
  const netPrB= n(base.netProfit),    netPrC= n(comp.netProfit);
  const grossPrB = netB != null && cogsB != null ? netB - cogsB : null;
  const grossPrC = netC != null && cogsC != null ? netC - cogsC : null;
  const mcB  = netB != null && varB != null ? netB - varB : null;
  const mcC  = netC != null && varC != null ? netC - varC : null;
  const mcPctB = mcB != null && netB != null && netB > 0 ? (mcB / netB) * 100 : null;
  const mcPctC = mcC != null && netC != null && netC > 0 ? (mcC / netC) * 100 : null;
  const ebitB  = grossPrB != null && fixB != null && varB != null ? grossPrB - fixB - varB : null;
  const ebitC  = grossPrC != null && fixC != null && varC != null ? grossPrC - fixC - varC : null;
  const ebitdaB= ebitB != null ? ebitB + (daB ?? 0) : null;
  const ebitdaC= ebitC != null ? ebitC + (daC ?? 0) : null;
  const pmrB = n(base.pmr), pmrC = n(comp.pmr);
  const pmpB = n(base.pmp), pmpC = n(comp.pmp);
  const pmeB = n(base.pme), pmeC = n(comp.pme);
  const cashCyB = pmrB != null && pmpB != null && pmeB != null ? pmrB + pmeB - pmpB : null;
  const cashCyC = pmrC != null && pmpC != null && pmeC != null ? pmrC + pmeC - pmpC : null;
  const deltaMcPct = d(mcPctB, mcPctC);

  return `Você é GESAIA, consultor de inteligência gerencial especializado em análise de evolução de desempenho para PMEs brasileiras.

EMPRESA: ${companyName}
ANÁLISE DE EVOLUÇÃO: ${base.period} → ${comp.period}

DRE COMPARATIVO:
${row("Receita Bruta", n(base.grossRevenue), n(comp.grossRevenue))}
${row("Receita Líquida", netB, netC)}
${row("CMV/CPV", cogsB, cogsC, true)}
${row("Lucro Bruto", grossPrB, grossPrC)}
${row("Custos Variáveis", varB, varC, true)}
${row("Margem de Contribuição", mcB, mcC)}
MC %: ${pct(mcPctB)} → ${pct(mcPctC)} | Δ ${deltaMcPct != null ? `${deltaMcPct >= 0 ? "+" : ""}${deltaMcPct.toFixed(1)}pp` : "n/d"}
${row("Custos Fixos", fixB, fixC, true)}
${row("EBIT / Resultado Operacional", ebitB, ebitC)}
${ebitdaB != null || ebitdaC != null ? row("EBITDA", ebitdaB, ebitdaC) : ""}
${netPrB != null || netPrC != null ? row("Lucro Líquido", netPrB, netPrC) : ""}

CICLO FINANCEIRO:
PMR: ${pmrB ?? "n/d"} → ${pmrC ?? "n/d"} dias | Δ ${pmrB != null && pmrC != null ? (pmrC - pmrB > 0 ? "+" : "") + (pmrC - pmrB) + " dias" : "n/d"}
PMP: ${pmpB ?? "n/d"} → ${pmpC ?? "n/d"} dias | Δ ${pmpB != null && pmpC != null ? (pmpC - pmpB > 0 ? "+" : "") + (pmpC - pmpB) + " dias" : "n/d"}
PME: ${pmeB ?? "n/d"} → ${pmeC ?? "n/d"} dias | Δ ${pmeB != null && pmeC != null ? (pmeC - pmeB > 0 ? "+" : "") + (pmeC - pmeB) + " dias" : "n/d"}
Ciclo de Caixa: ${cashCyB ?? "n/d"} → ${cashCyC ?? "n/d"} dias

INDICADORES COMERCIAIS:
Clientes Ativos: ${n(base.activeCustomers) ?? "n/d"} → ${n(comp.activeCustomers) ?? "n/d"}
Ticket Médio: ${brl(n(base.averageTicket))} → ${brl(n(comp.averageTicket))}
Churn: ${n(base.churnRate) != null ? pct(n(base.churnRate)! * 100) : "n/d"} → ${n(comp.churnRate) != null ? pct(n(comp.churnRate)! * 100) : "n/d"}
NPS: ${n(base.nps) ?? "n/d"} → ${n(comp.nps) ?? "n/d"} pts
Inadimplência: ${n(base.defaultRate) != null ? pct(n(base.defaultRate)! * 100) : "n/d"} → ${n(comp.defaultRate) != null ? pct(n(comp.defaultRate)! * 100) : "n/d"}

INSTRUÇÕES:
- Foque nos movimentos de MAIOR IMPACTO. Ignore variações pequenas sem relevância estratégica.
- Quando um indicador melhorou no absoluto mas piorou na margem (ou vice-versa), destaque isso.
- Use os números reais do contexto acima. Se um dado não estiver disponível, pule-o.`;
}

// ── Monta o system prompt contextualizado com dados reais da empresa
export function buildFinancialContext(companyName: string, inv: any, data: any): string {
  const n = (v: any) => (v != null ? Number(v) : null);
  const brl = (v: number | null) =>
    v != null ? `R$ ${Math.round(v).toLocaleString("pt-BR")}` : "não informado";
  const pct = (v: number | null) => (v != null ? `${v.toFixed(1)}%` : "não informado");
  const days = (v: number | null) => (v != null ? `${Math.round(v)} dias` : "não informado");

  let financialSection = "Nenhum dado financeiro cadastrado para esta empresa ainda.";

  if (data) {
    const netRev  = n(data.netRevenue);
    const grossRev = n(data.grossRevenue);
    const cogs    = n(data.cogs);
    const fixedC  = n(data.fixedCosts);
    const varC    = n(data.variableCosts);
    const ebitda  = n(data.ebitda);
    const netPr   = n(data.netProfit);
    const ded     = n(data.deductions);
    const da      = n(data.depreciationAmortization);
    const finExp  = n(data.financialExpenses);
    const itax    = n(data.incomeTax);
    const pmr     = n(data.pmr);
    const pmp     = n(data.pmp);
    const pme     = n(data.pme);

    // Indicadores calculados
    const grossPr  = (netRev != null && cogs != null) ? netRev - cogs : null;
    const mc       = (netRev != null && varC != null) ? netRev - varC : null;
    const mcPct    = (mc != null && netRev != null && netRev > 0) ? (mc / netRev) * 100 : null;
    const pe       = (mc != null && fixedC != null && netRev != null && mc > 0) ? fixedC / (mc / netRev) : null;
    const safety   = (pe != null && netRev != null && netRev > 0) ? ((netRev - pe) / netRev) * 100 : null;
    const safetyLabel = safety == null ? "não calculado"
      : safety < 0 ? "Péssimo" : safety < 10 ? "Ruim" : safety < 20 ? "Aceitável" : safety < 35 ? "Bom" : "Excelente";
    const opCycle  = (pmr != null && pme != null) ? pmr + pme : null;
    const cashCy   = (opCycle != null && pmp != null) ? opCycle - pmp : null;
    const wcNeed   = (cashCy != null && netRev != null) ? Math.round(cashCy * (netRev / 30)) : null;

    // Recalculate chain with new fields
    const ebit     = (grossPr != null && fixedC != null && varC != null) ? grossPr - fixedC - varC : null;
    const ebitdaCalc = ebit != null ? ebit + (da ?? 0) : ebitda; // prefer recalculated, fall back to stored
    const lair     = (ebit != null && finExp != null) ? ebit - finExp : null;

    const ebitdaMarg = (ebitdaCalc != null && netRev != null && netRev > 0) ? (ebitdaCalc / netRev) * 100 : null;
    const netMarg    = (netPr != null && netRev != null && netRev > 0) ? (netPr / netRev) * 100 : null;
    const grossMarg  = (grossPr != null && (grossRev ?? netRev) != null) ? (grossPr / (grossRev ?? netRev)!) * 100 : null;

    financialSection = `
DADOS DO PERÍODO ${data.period}:

DRE (Demonstração de Resultado):
- Receita Bruta: ${brl(grossRev)}${ded != null ? `\n- Deduções da Receita: ${brl(ded)}` : ""}
- Receita Líquida: ${brl(netRev)}
- CMV/CPV: ${brl(cogs)}
- Lucro Bruto: ${brl(grossPr)} (Margem Bruta: ${pct(grossMarg)})
- Custos Variáveis: ${brl(varC)}
- Custos Fixos: ${brl(fixedC)}${da != null ? ` (inclui D&A de ${brl(da)})` : ""}
- Resultado Operacional / EBIT: ${brl(ebit)}
- EBITDA: ${brl(ebitdaCalc)} (Margem EBITDA: ${pct(ebitdaMarg)})${finExp != null ? `\n- Despesas Financeiras: ${brl(finExp)}` : ""}${lair != null ? `\n- LAIR (Lucro Antes do IR): ${brl(lair)}` : ""}${itax != null ? `\n- IR + CSLL: ${brl(itax)}` : ""}
- Lucro Líquido: ${brl(netPr)} (Margem Líquida: ${pct(netMarg)})

Margem de Contribuição e Ponto de Equilíbrio:
- Margem de Contribuição: ${brl(mc)} (${pct(mcPct)})
- Ponto de Equilíbrio: ${brl(pe)}
- Margem de Segurança: ${pct(safety)} → Classificação: ${safetyLabel}

Ciclo Financeiro:
- PMR (Prazo Médio de Recebimento): ${days(pmr)}
- PMP (Prazo Médio de Pagamento): ${days(pmp)}
- PME (Prazo Médio de Estoque): ${days(pme)}
- Ciclo Operacional: ${days(opCycle)}
- Ciclo de Caixa: ${days(cashCy)}
- Necessidade de Capital de Giro: ${brl(wcNeed)}

Indicadores Comerciais e Operacionais:
- Clientes Ativos: ${n(data.activeCustomers) ?? "não informado"}
- Ticket Médio: ${brl(n(data.averageTicket))}
- Taxa de Conversão: ${n(data.conversionRate) != null ? pct(n(data.conversionRate)! * 100) : "não informado"}
- Churn: ${n(data.churnRate) != null ? pct(n(data.churnRate)! * 100) : "não informado"}
- NPS: ${n(data.nps) ?? "não informado"} pts
- Inadimplência: ${n(data.defaultRate) != null ? pct(n(data.defaultRate)! * 100) : "não informado"}
- Total de Colaboradores: ${n(data.totalEmployees) ?? "não informado"}
- Pró-labore dos Sócios: ${brl(n(data.proLabore))}`.trim();
  }

  return `Você é GESAIA, um consultor de inteligência gerencial especialista em diagnóstico financeiro, análise de KPIs e estratégia para pequenas e médias empresas brasileiras.

EMPRESA EM ANÁLISE: ${companyName}
INVESTIGAÇÃO: ${inv.title}${inv.period ? ` | Período: ${inv.period}` : ""}

${financialSection}

INSTRUÇÕES:
- Responda SEMPRE com base nos dados reais acima. Se um indicador estiver como "não informado", diga que o dado não foi cadastrado e sugira que o consultor o inclua na aba Dados.
- Use os cálculos já feitos (Margem de Contribuição, Ponto de Equilíbrio, Margem de Segurança, Ciclo de Caixa) como ponto de partida — não os recalcule manualmente a menos que seja para mostrar o raciocínio.
- Seja direto, quantitativo e orientado a ação. Priorize achados com maior impacto no negócio.
- Responda no mesmo idioma do consultor (PT ou EN).
- Quando identificar um problema, proponha ao menos uma ação corretiva concreta.`;
}

export default router;
