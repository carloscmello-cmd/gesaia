import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { companies, simulations } from "@workspace/db/schema";
import { requireAuth } from "../middlewares/requireAuth";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router = Router();

function canAccess(user: any, company: any) {
  return user.role === "admin" || company.ownerId === user.id;
}

// GET /api/companies/:id/simulations
router.get("/:id/simulations", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccess(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }
  const rows = await db.select().from(simulations).where(eq(simulations.companyId, id)).orderBy(desc(simulations.createdAt));
  res.json(rows.map((r) => ({ id: r.id, companyId: r.companyId, name: r.name, type: r.type, parameters: r.parameters, results: r.results, createdAt: r.createdAt })));
});

// POST /api/companies/:id/simulations
router.post("/:id/simulations", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccess(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }
  const { name, type, parameters, results } = req.body;
  if (!name || !type || !parameters || !results) { res.status(400).json({ error: "name, type, parameters, results required" }); return; }
  const [sim] = await db.insert(simulations).values({ companyId: id, name, type, parameters, results }).returning();
  res.status(201).json({ id: sim.id, companyId: sim.companyId, name: sim.name, type: sim.type, parameters: sim.parameters, results: sim.results, createdAt: sim.createdAt });
});

// GET /api/companies/:id/simulations/:simId
router.get("/:id/simulations/:simId", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const simId = Number(req.params.simId);
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccess(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }
  const [sim] = await db.select().from(simulations).where(eq(simulations.id, simId)).limit(1);
  if (!sim || sim.companyId !== id) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ id: sim.id, companyId: sim.companyId, name: sim.name, type: sim.type, parameters: sim.parameters, results: sim.results, createdAt: sim.createdAt });
});

// DELETE /api/companies/:id/simulations/:simId
router.delete("/:id/simulations/:simId", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const simId = Number(req.params.simId);
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccess(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }
  const [sim] = await db.select().from(simulations).where(eq(simulations.id, simId)).limit(1);
  if (!sim || sim.companyId !== id) { res.status(404).json({ error: "Not found" }); return; }
  await db.delete(simulations).where(eq(simulations.id, simId));
  res.status(204).send();
});

// POST /api/simulations/run — stateless simulation runner
router.post("/run", requireAuth, async (req, res) => {
  const { type, parameters } = req.body;
  if (!type || !parameters) { res.status(400).json({ error: "type and parameters required" }); return; }
  const outputs = runSimulation(type, parameters);
  res.json({ type, outputs, charts: [] });
});

// POST /api/simulations/ask — AI interprets a natural-language question and returns updated params
router.post("/ask", requireAuth, async (req, res) => {
  console.log("[simulations/ask] received request body keys:", Object.keys(req.body));
  const { type, simLabel, currentParams, paramDefs, question, currentResult } = req.body;
  if (!type || !question || !paramDefs) {
    console.log("[simulations/ask] missing fields:", { type: !!type, question: !!question, paramDefs: !!paramDefs });
    res.status(400).json({ error: "type, question and paramDefs required" });
    return;
  }

  const paramDefsText = (paramDefs as Array<{ key: string; label: string; default?: string }>)
    .map(p => `  - key: "${p.key}", label: "${p.label}", currentValue: ${currentParams?.[p.key] ?? p.default ?? "não informado"}`)
    .join("\n");

  const currentResultText = currentResult
    ? `\nResultado atual da simulação:\n${JSON.stringify(currentResult, null, 2)}`
    : "";

  const systemPrompt = `Você é o assistente de simulações da GESAIA, uma plataforma de inteligência empresarial para consultores.
Seu papel é interpretar perguntas em linguagem natural e traduzir para parâmetros numéricos de simulação.

Simulação atual: "${simLabel ?? type}"
Parâmetros disponíveis:
${paramDefsText}
${currentResultText}

REGRAS:
1. Retorne SOMENTE um objeto JSON válido, sem texto fora do JSON.
2. Inclua "updatedParams" com apenas os parâmetros que precisam ser alterados (os demais mantêm o valor atual).
3. Inclua "explanation" com uma frase curta em português explicando o que você interpretou e o que alterou.
4. Se a pergunta for sobre um resultado calculado (não sobre parâmetros), calcule a resposta analiticamente e coloque em "directAnswer" (string), e deixe "updatedParams" vazio {}.
5. Todos os valores numéricos em "updatedParams" devem ser strings (ex: "10", "150000").

Exemplo de resposta:
{
  "updatedParams": { "priceIncreasePct": "15", "volumeLossPct": "9.1" },
  "explanation": "Configurei aumento de preço para 15% e calculei a perda máxima tolerável de 9,1% para não prejudicar a receita.",
  "directAnswer": null
}`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: "user", content: question }],
    });

    const raw = (message.content[0] as any).text ?? "{}";
    // Extract JSON from response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      res.status(200).json({ updatedParams: {}, explanation: raw, directAnswer: null });
      return;
    }
    const parsed = JSON.parse(jsonMatch[0]);
    res.json({
      updatedParams: parsed.updatedParams ?? {},
      explanation: parsed.explanation ?? "",
      directAnswer: parsed.directAnswer ?? null,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao consultar IA", detail: err?.message });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   SIMULATION ENGINE — all 30+ calculators from the GESAIA catalog
───────────────────────────────────────────────────────────────────────────── */
function runSimulation(type: string, params: Record<string, unknown>): Record<string, unknown> {
  const n = (key: string, fallback = 0) => Number(params[key] ?? fallback);
  const pct = (key: string, fallback = 0) => n(key, fallback) / 100;

  switch (type) {

    /* ══════════════════════════════════════════════════════════════
       FINANCEIRO
    ══════════════════════════════════════════════════════════════ */

    case "dre": {
      const gross = n("grossRevenue");
      const cogs = n("cogs");
      const fixed = n("fixedCosts");
      const variable = n("variableCosts");
      const grossProfit = gross - cogs;
      const ebitda = grossProfit - fixed - variable;
      return {
        grossRevenue: gross, cogs, grossProfit, fixedCosts: fixed, variableCosts: variable,
        ebitda,
        grossMarginPct: gross > 0 ? (grossProfit / gross) * 100 : 0,
        ebitdaMarginPct: gross > 0 ? (ebitda / gross) * 100 : 0,
        breakEven: grossProfit > 0 ? (fixed / (grossProfit / gross)) : 0,
      };
    }

    case "price": {
      const cost = n("unitCost");
      const margin = pct("targetMarginPct", 30);
      const price = margin < 1 ? cost / (1 - margin) : 0;
      const markup = cost > 0 ? ((price - cost) / cost) * 100 : 0;
      return { suggestedPrice: price, unitCost: cost, marginPct: margin * 100, markupPct: markup };
    }

    case "price_elasticity": {
      // Aumentar preço X% e perder Y% dos clientes: vale a pena?
      const rev = n("currentRevenue");
      const Δp = pct("priceIncreasePct", 10);
      const Δv = pct("volumeLossPct", 10);
      const newRev = rev * (1 + Δp) * (1 - Δv);
      const delta = newRev - rev;
      const deltaPct = rev > 0 ? (delta / rev) * 100 : 0;
      // Ponto de indiferença: (1+Δp)(1-x)=1 → x = 1 - 1/(1+Δp)
      const maxVolumeLoss = (1 - 1 / (1 + Δp)) * 100;
      return {
        currentRevenue: Math.round(rev),
        newRevenue: Math.round(newRev),
        revenueDelta: Math.round(delta),
        revenueDeltaPct: deltaPct,
        isAdvantageous: newRev > rev,
        verdict: newRev > rev
          ? `Vantajoso: receita sobe R$ ${Math.round(delta).toLocaleString("pt-BR")} (+${deltaPct.toFixed(1)}%)`
          : `Desvantajoso: receita cai R$ ${Math.round(Math.abs(delta)).toLocaleString("pt-BR")} (${deltaPct.toFixed(1)}%)`,
        maxVolumeLoss,
        insight: `Com +${(Δp*100).toFixed(0)}% no preço, a perda máxima tolerável de clientes é ${maxVolumeLoss.toFixed(1)}%`,
      };
    }

    case "discount_impact": {
      // Impacto de um desconto e volume mínimo para compensar
      const rev = n("currentRevenue");
      const mcPct = pct("contributionMarginPct", 30); // MC%
      const disc = pct("discountPct", 10);
      // Nova receita sem compensar volume
      const newRev = rev * (1 - disc);
      const revLoss = rev - newRev;
      // Para manter MC absoluta: novo_preço × novo_volume × mcPct_nova = rev × mcPct
      // MC%_nova = (MC% - disc%) / (1 - disc%)
      const newMCPct = mcPct > disc ? (mcPct - disc) / (1 - disc) : 0;
      // Volume adicional necessário para manter o lucro absoluto
      const volIncreasePct = newMCPct > 0
        ? ((mcPct / newMCPct) - 1) * 100
        : Infinity;
      return {
        currentRevenue: Math.round(rev),
        revenueAfterDiscount: Math.round(newRev),
        revenueLoss: Math.round(revLoss),
        currentMarginPct: mcPct * 100,
        newMarginPctAfterDiscount: newMCPct * 100,
        volumeIncreaseNeeded: isFinite(volIncreasePct) ? volIncreasePct : null,
        verdict: isFinite(volIncreasePct)
          ? `Para compensar o desconto de ${(disc*100).toFixed(0)}%, o volume precisa crescer ${volIncreasePct.toFixed(1)}%`
          : `O desconto elimina toda a margem — inviável sem ajuste de custo`,
      };
    }

    case "discount_compensation_customers": {
      // Quantos novos clientes (1 unidade cada) são necessários para manter o
      // lucro líquido absoluto após aplicar desconto na base atual de clientes?
      //
      // Premissas:
      //   • Clientes atuais: compram o mesmo volume, mas ao preço com desconto
      //   • Novos clientes:  cada um compra exatamente 1 unidade ao preço com desconto
      //   • CAC: pago 1× por novo cliente, deduzido do lucro gerado por ele
      //   • Custos fixos: invariantes

      const price    = n("currentPrice");          // R$ preço atual unitário
      const varCost  = n("unitVariableCost");       // R$ custo variável unitário
      const volume   = n("currentVolume");          // unidades atuais/período
      const disc     = pct("discountPct", 20);      // 20 → 0.20
      const cac      = n("cacPerCustomer", 10);     // R$ CAC por novo cliente
      const fixedC   = n("currentFixedCosts", 0);  // R$ custos fixos totais

      // ── Cenário Atual ────────────────────────────────────────────────────
      const currentUnitMargin   = price - varCost;
      const currentGrossMargin  = currentUnitMargin * volume;
      const currentNetProfit    = currentGrossMargin - fixedC;

      // ── Perda gerada pelo desconto na base atual ─────────────────────────
      const newPrice            = price * (1 - disc);
      const newUnitMarginBase   = newPrice - varCost;          // margem/unidade dos atuais após desconto
      const marginLossPerUnit   = currentUnitMargin - newUnitMarginBase; // = disc × price
      const totalMarginLoss     = marginLossPerUnit * volume;            // "rombo"

      // ── Contribuição líquida de cada NOVO cliente ────────────────────────
      // Cada novo cliente compra 1 unidade a newPrice e gera CAC de custo
      const newCustomerNetContrib = newPrice - varCost - cac;

      // ── Novos clientes necessários ───────────────────────────────────────
      const newCustomersNeeded = newCustomerNetContrib > 0
        ? Math.ceil(totalMarginLoss / newCustomerNetContrib)
        : null;                                                // inviável se margem ≤ 0

      const totalCACInvestment  = newCustomersNeeded !== null ? newCustomersNeeded * cac : null;

      // ── Cenário Após (validação) ─────────────────────────────────────────
      const afterBaseMargin     = newUnitMarginBase * volume;
      const afterNewMargin      = newCustomersNeeded !== null
        ? newCustomerNetContrib * newCustomersNeeded : 0;
      const afterNetProfit      = afterBaseMargin + afterNewMargin - fixedC;

      // Diferença residual (arredondamento de ceiling)
      const profitDelta         = afterNetProfit - currentNetProfit;

      const viable = newCustomerNetContrib > 0;

      return {
        // ── Entradas confirmadas ─────────────────────────────────────────
        currentPrice:            price,
        discountApplied:         disc * 100,
        newPrice,
        unitVariableCost:        varCost,
        currentVolume:           volume,
        cacPerCustomer:          cac,
        currentFixedCosts:       fixedC,

        // ── Cenário Atual ────────────────────────────────────────────────
        currentUnitMargin,
        currentGrossMargin:      Math.round(currentGrossMargin),
        currentNetProfit:        Math.round(currentNetProfit),

        // ── Rombo do desconto ────────────────────────────────────────────
        marginLossPerUnit,
        totalMarginLoss:         Math.round(totalMarginLoss),

        // ── Novo cliente ─────────────────────────────────────────────────
        newCustomerUnitMargin:   newPrice - varCost,
        newCustomerNetContrib,

        // ── Resultado ────────────────────────────────────────────────────
        newCustomersNeeded,
        totalCACInvestment:      totalCACInvestment !== null ? Math.round(totalCACInvestment) : null,

        // ── Após compensação (validação) ─────────────────────────────────
        afterBaseMargin:         Math.round(afterBaseMargin),
        afterNetProfit:          Math.round(afterNetProfit),
        profitDelta:             Math.round(profitDelta),

        insight: viable && newCustomersNeeded !== null
          ? [
              `Rombo do desconto: R$ ${Math.round(totalMarginLoss).toLocaleString("pt-BR")}`,
              `Cada novo cliente gera R$ ${newCustomerNetContrib.toFixed(2)} líquido (já descontado CAC)`,
              `São necessários ${newCustomersNeeded.toLocaleString("pt-BR")} novos clientes`,
              `Investimento total em CAC: R$ ${Math.round(totalCACInvestment!).toLocaleString("pt-BR")}`,
            ].join(" · ")
          : `Inviável: com desconto de ${(disc*100).toFixed(0)}% e CAC de R$ ${cac}, cada novo cliente gera margem negativa (R$ ${newCustomerNetContrib.toFixed(2)}).`,

        verdict: viable && newCustomersNeeded !== null
          ? `Precisa de ${newCustomersNeeded.toLocaleString("pt-BR")} novos clientes para manter o lucro de R$ ${Math.round(currentNetProfit).toLocaleString("pt-BR")}`
          : "Margem por novo cliente negativa — o desconto não é compensável via aquisição de clientes nestas condições",
      };
    }

    case "max_discount": {
      // Desconto máximo dentro de uma margem mínima aceitável
      const price = n("currentPrice", 100);
      const cost = n("unitCost");
      const minMarginPct = pct("minAcceptableMarginPct", 10);
      const currentMargin = price > 0 ? (price - cost) / price : 0;
      // Preço mínimo = custo / (1 - minMargin)
      const minPrice = 1 - minMarginPct > 0 ? cost / (1 - minMarginPct) : cost;
      const maxDiscountAmt = Math.max(0, price - minPrice);
      const maxDiscountPct = price > 0 ? (maxDiscountAmt / price) * 100 : 0;
      return {
        currentPrice: price,
        unitCost: cost,
        currentMarginPct: currentMargin * 100,
        minAcceptableMarginPct: minMarginPct * 100,
        minViablePrice: minPrice,
        maxDiscountAmount: maxDiscountAmt,
        maxDiscountPct,
        verdict: `Você pode dar até ${maxDiscountPct.toFixed(1)}% de desconto (mínimo de R$ ${minPrice.toFixed(2)} por unidade)`,
      };
    }

    case "revenue_target": {
      // Quanto a receita precisa crescer para atingir margem ou lucro-alvo
      const rev = n("currentRevenue");
      const fixed = n("currentFixedCosts");
      const varCostPct = pct("variableCostPct", 40);
      const targetMarginPct = pct("targetMarginPct"); // optional
      const targetProfit = n("targetProfit");        // optional, R$
      const mcPct = 1 - varCostPct;

      // Resultado atual
      const currentContrib = rev * mcPct;
      const currentProfit = currentContrib - fixed;
      const currentMargin = rev > 0 ? (currentProfit / rev) * 100 : 0;

      // Para atingir margem-alvo: Lucro = Rev × targetMargin → Rev(mcPct - targetMargin) = fixed
      const revenueForMargin = targetMarginPct > 0 && mcPct > targetMarginPct
        ? fixed / (mcPct - targetMarginPct)
        : null;
      // Para atingir lucro-alvo em R$: (Rev × mcPct) - fixed = targetProfit → Rev = (fixed + targetProfit) / mcPct
      const revenueForProfit = targetProfit > 0 && mcPct > 0
        ? (fixed + targetProfit) / mcPct
        : null;

      const growthForMargin = revenueForMargin && rev > 0 ? ((revenueForMargin / rev) - 1) * 100 : null;
      const growthForProfit = revenueForProfit && rev > 0 ? ((revenueForProfit / rev) - 1) * 100 : null;

      return {
        currentRevenue: Math.round(rev),
        currentProfit: Math.round(currentProfit),
        currentMarginPct: currentMargin,
        revenueNeededForMarginTarget: revenueForMargin ? Math.round(revenueForMargin) : null,
        growthPctForMarginTarget: growthForMargin,
        revenueNeededForProfitTarget: revenueForProfit ? Math.round(revenueForProfit) : null,
        growthPctForProfitTarget: growthForProfit,
        insight: [
          revenueForMargin ? `Para atingir ${(targetMarginPct*100).toFixed(0)}% de margem: receita precisa ir a R$ ${Math.round(revenueForMargin).toLocaleString("pt-BR")} (+${growthForMargin?.toFixed(1)}%)` : "",
          revenueForProfit ? `Para lucro de R$ ${targetProfit.toLocaleString("pt-BR")}: receita precisa ir a R$ ${Math.round(revenueForProfit).toLocaleString("pt-BR")} (+${growthForProfit?.toFixed(1)}%)` : "",
        ].filter(Boolean).join(" | "),
      };
    }

    case "hire_impact": {
      // Efeito de contratar alguém no resultado
      const rev = n("currentRevenue");
      const currentProfit = n("currentProfit");
      const annualSalary = n("annualSalaryCost"); // salário + encargos anuais
      const revenueFromHire = n("estimatedRevenueContribution"); // receita que esse colaborador vai gerar
      const varCostPct = pct("variableCostPct", 40);
      const monthlySalary = annualSalary / 12;
      const monthlyRevContrib = revenueFromHire / 12;
      const monthlyMCContrib = monthlyRevContrib * (1 - varCostPct);
      const monthlyImpact = monthlyMCContrib - monthlySalary;
      const breakEvenMonths = monthlyImpact > 0 ? Math.ceil(annualSalary / 12 / monthlyMCContrib * 12) : null;
      return {
        currentRevenue: Math.round(rev),
        currentProfit: Math.round(currentProfit),
        annualSalaryCost: Math.round(annualSalary),
        estimatedRevenueContribution: Math.round(revenueFromHire),
        monthlySalaryCost: Math.round(monthlySalary),
        monthlyRevenueContribution: Math.round(monthlyRevContrib),
        monthlyNetImpact: Math.round(monthlyImpact),
        isWorthy: monthlyImpact > 0,
        verdict: monthlyImpact > 0
          ? `Contratação gera lucro de R$ ${Math.round(monthlyImpact).toLocaleString("pt-BR")}/mês — recomendada`
          : `Contratação gera prejuízo de R$ ${Math.round(Math.abs(monthlyImpact)).toLocaleString("pt-BR")}/mês — revisar premissas`,
        breakEvenMonths,
      };
    }

    case "free_scenario": {
      // Cenário livre: alterar receita, CMV e custo fixo livremente
      const rev = n("currentRevenue");
      const cogs = n("currentCOGS");
      const fixed = n("currentFixedCosts");
      const revChange = pct("revenueChangePct");
      const cogsChange = pct("cogsChangePct");
      const fixedChange = pct("fixedChangePct");
      const newRev = rev * (1 + revChange);
      const newCOGS = cogs * (1 + cogsChange);
      const newFixed = fixed * (1 + fixedChange);
      const newMC = newRev - newCOGS;
      const newProfit = newMC - newFixed;
      const currentProfit = (rev - cogs) - fixed;
      return {
        currentRevenue: Math.round(rev), newRevenue: Math.round(newRev),
        currentCOGS: Math.round(cogs), newCOGS: Math.round(newCOGS),
        currentFixedCosts: Math.round(fixed), newFixedCosts: Math.round(newFixed),
        currentProfit: Math.round(currentProfit), newProfit: Math.round(newProfit),
        profitDelta: Math.round(newProfit - currentProfit),
        newMarginPct: newRev > 0 ? (newProfit / newRev) * 100 : 0,
        verdict: newProfit > currentProfit
          ? `Cenário melhora o resultado em R$ ${Math.round(newProfit - currentProfit).toLocaleString("pt-BR")}`
          : `Cenário piora o resultado em R$ ${Math.round(Math.abs(newProfit - currentProfit)).toLocaleString("pt-BR")}`,
      };
    }

    case "fixed_cost_coverage": {
      // Quanto a mais preciso vender para suportar um aumento de custo fixo,
      // mantendo o lucro líquido atual inalterado?
      //
      // Fórmula central:
      //   ΔReceita necessária = ΔCusto Fixo ÷ MC%
      //   ΔUnidades necessárias = ΔReceita ÷ Preço Unitário (se informado)

      const mcPct          = pct("contributionMarginPct", 40);  // MC% (ex: 40 → 0.40)
      const fixedCostIncrease = n("fixedCostIncrease");          // R$ aumento de custo fixo
      const currentRevenue = n("currentRevenue", 0);             // opcional — para % relativa
      const unitPrice      = n("unitPrice", 0);                  // opcional — para calcular unidades
      const currentVolume  = n("currentVolume", 0);              // opcional — volume atual

      if (mcPct <= 0) {
        return { verdict: "Margem de contribuição zero ou negativa — impossível cobrir custos fixos com vendas adicionais." };
      }

      // ── Receita adicional necessária ──────────────────────────────────────
      const additionalRevenue = fixedCostIncrease / mcPct;

      // ── Unidades adicionais (se preço unitário informado) ─────────────────
      const additionalUnits = unitPrice > 0
        ? Math.ceil(additionalRevenue / unitPrice)
        : null;

      // ── % de crescimento necessário (se receita atual informada) ──────────
      const revenueGrowthPct = currentRevenue > 0
        ? (additionalRevenue / currentRevenue) * 100
        : null;

      // ── % de crescimento em unidades (se volume atual informado) ──────────
      const volumeGrowthPct = currentVolume > 0 && additionalUnits !== null
        ? (additionalUnits / currentVolume) * 100
        : null;

      // ── Custo fixo que cada real de MC adicional "compra" ────────────────
      // Contexto: com MC% de X%, cada R$ 1 de receita adicional contribui R$ X para cobrir o aumento
      const mcPerRealOfRevenue = mcPct;

      return {
        // ── Entradas ─────────────────────────────────────────────────────────
        contributionMarginPct:  mcPct * 100,
        fixedCostIncrease:      Math.round(fixedCostIncrease),
        currentRevenue:         currentRevenue > 0 ? Math.round(currentRevenue) : null,
        unitPrice:              unitPrice > 0 ? unitPrice : null,
        currentVolume:          currentVolume > 0 ? currentVolume : null,

        // ── Resultado principal ───────────────────────────────────────────────
        additionalRevenueNeeded: Math.round(additionalRevenue),
        additionalUnitsNeeded:   additionalUnits,

        // ── Contexto relativo ─────────────────────────────────────────────────
        revenueGrowthPct:       revenueGrowthPct !== null ? parseFloat(revenueGrowthPct.toFixed(1)) : null,
        volumeGrowthPct:        volumeGrowthPct !== null ? parseFloat(volumeGrowthPct.toFixed(1)) : null,

        verdict: [
          `Para absorver R$ ${Math.round(fixedCostIncrease).toLocaleString("pt-BR")} de custo fixo adicional com MC de ${(mcPct*100).toFixed(0)}%,`,
          `você precisa vender R$ ${Math.round(additionalRevenue).toLocaleString("pt-BR")} a mais`,
          additionalUnits ? `(${additionalUnits.toLocaleString("pt-BR")} unidades adicionais a R$ ${unitPrice.toLocaleString("pt-BR")})` : "",
          revenueGrowthPct ? `— um crescimento de ${revenueGrowthPct.toFixed(1)}% sobre a receita atual` : "",
        ].filter(Boolean).join(" "),
      };
    }

    case "growth_capital": {
      // Quanto capital de giro ADICIONAL será necessário para sustentar um crescimento planejado?
      //
      // Fórmula central:
      //   NCG = (PMR + PME − PMP) × (Receita Mensal ÷ 30)
      //   Capital Adicional = NCG_nova − NCG_atual
      //
      // Cenário B (opcional): e se otimizar prazos junto com o crescimento?

      const rev       = n("currentRevenue");          // receita mensal atual (R$)
      const growthPct = pct("plannedGrowthPct", 30);  // % de crescimento planejado
      const pmr       = n("pmr", 30);                 // prazo médio de recebimento (dias)
      const pme       = n("pme", 15);                 // prazo médio de estoque (dias)
      const pmp       = n("pmp", 30);                 // prazo médio de pagamento (dias)
      const varCostPct = pct("variableCostPct", 40);  // % custo variável (para estoque)
      const annualRate = pct("annualFinancingRatePct", 0); // taxa de juros ao ano (0 = sem custo)

      // Prazos otimizados (opcional — se zero, usa os atuais)
      const newPmr = n("newPmr", 0) || pmr;
      const newPme = n("newPme", 0) || pme;
      const newPmp = n("newPmp", 0) || pmp;

      // ── Ciclo financeiro atual ────────────────────────────────────────────
      const cashCycleCurrent = pmr + pme - pmp;          // dias

      // ── NCG atual e projetada ─────────────────────────────────────────────
      const dailyRev        = rev / 30;
      const ncgCurrent      = cashCycleCurrent * dailyRev;

      const projectedRev    = rev * (1 + growthPct);
      const dailyRevNew     = projectedRev / 30;
      const ncgProjected    = cashCycleCurrent * dailyRevNew; // mesmo ciclo, mais receita
      const additionalCapital = ncgProjected - ncgCurrent;

      // ── Custo financeiro mensal (se informada taxa) ───────────────────────
      const monthlyRate     = annualRate / 12;
      const monthlyCost     = monthlyRate > 0 ? additionalCapital * monthlyRate : null;
      const annualCost      = monthlyCost !== null ? monthlyCost * 12 : null;

      // ── Cenário B — crescimento + otimização de prazos ───────────────────
      const cashCycleOptimized = newPmr + newPme - newPmp;
      const ncgOptimized       = cashCycleOptimized * dailyRevNew;
      const additionalCapitalOptimized = ncgOptimized - ncgCurrent;
      const savingVsBase       = additionalCapital - additionalCapitalOptimized;
      const optimizationHelps  = cashCycleOptimized !== cashCycleCurrent;

      // ── Receita adicional mensal gerada pelo crescimento ─────────────────
      const revenueGain     = projectedRev - rev;
      const mcGain          = revenueGain * (1 - varCostPct);  // contribuição marginal adicional

      // Quantos meses de MC adicional para autofinanciar o capital? (se não usar crédito)
      const selfFinanceMonths = mcGain > 0 ? Math.ceil(additionalCapital / mcGain) : null;

      return {
        // ── Entradas ────────────────────────────────────────────────────────
        currentRevenue:        Math.round(rev),
        plannedGrowthPct:      growthPct * 100,
        projectedRevenue:      Math.round(projectedRev),
        pmr, pme, pmp,
        cashCycleCurrent,

        // ── NCG Cenário Base ─────────────────────────────────────────────
        ncgCurrent:            Math.round(ncgCurrent),
        ncgProjected:          Math.round(ncgProjected),
        additionalCapitalNeeded: Math.round(additionalCapital),

        // ── Custo financeiro ─────────────────────────────────────────────
        annualFinancingRatePct: annualRate * 100,
        monthlyCostOfCapital:  monthlyCost !== null ? Math.round(monthlyCost) : null,
        annualCostOfCapital:   annualCost  !== null ? Math.round(annualCost)  : null,

        // ── Autofinanciamento pela MC adicional ─────────────────────────
        revenueGain:           Math.round(revenueGain),
        mcGain:                Math.round(mcGain),
        selfFinanceMonths,

        // ── Cenário B: crescimento + otimização de prazos ───────────────
        ...(optimizationHelps ? {
          newPmr, newPme, newPmp,
          cashCycleOptimized,
          ncgOptimized:            Math.round(ncgOptimized),
          additionalCapitalOptimized: Math.round(additionalCapitalOptimized),
          capitalSavingFromOptimization: Math.round(savingVsBase),
        } : {}),

        verdict: [
          `Para crescer ${(growthPct*100).toFixed(0)}%, você precisará de R$ ${Math.round(additionalCapital).toLocaleString("pt-BR")} de capital de giro adicional`,
          selfFinanceMonths ? `(autofinanciável em ${selfFinanceMonths} meses com a MC gerada pelo crescimento)` : "",
          optimizationHelps && savingVsBase > 0
            ? `Otimizando prazos, reduz para R$ ${Math.round(additionalCapitalOptimized).toLocaleString("pt-BR")} (economia de R$ ${Math.round(savingVsBase).toLocaleString("pt-BR")})`
            : "",
        ].filter(Boolean).join(" · "),
      };
    }

    case "working_capital": {
      // Impacto de renegociar prazos de recebimento/pagamento/estoque
      const rev = n("monthlyRevenue");
      const purchases = n("monthlyPurchases");
      const currentPMR = n("currentPMR", 30);
      const newPMR = n("newPMR", 20);
      const currentPMP = n("currentPMP", 30);
      const newPMP = n("newPMP", 45);
      const currentPME = n("currentPME", 15);
      const newPME = n("newPME", 10);
      const dailyRev = rev / 30;
      const dailyPurch = purchases / 30;
      // NCG = (PMR + PME - PMP) × receita_diária (simplificado)
      const currentNCG = (currentPMR + currentPME - currentPMP) * dailyRev;
      const newNCG = (newPMR + newPME - newPMP) * dailyRev;
      const cashRelease = currentNCG - newNCG; // positivo = libera caixa
      return {
        currentPMR, newPMR, currentPMP, newPMP, currentPME, newPME,
        currentWorkingCapitalNeed: Math.round(currentNCG),
        newWorkingCapitalNeed: Math.round(newNCG),
        cashReleased: Math.round(cashRelease),
        verdict: cashRelease >= 0
          ? `Renegociação libera R$ ${Math.round(cashRelease).toLocaleString("pt-BR")} de caixa`
          : `Renegociação imobiliza R$ ${Math.round(Math.abs(cashRelease)).toLocaleString("pt-BR")} adicionais de capital`,
      };
    }

    case "pro_labore_target": {
      // Quanto crescer a receita (ou cortar custo fixo) para viabilizar um pró-labore desejado
      const rev = n("currentRevenue");
      const mcPct = pct("contributionMarginPct", 30);
      const currentFixed = n("currentFixedCosts"); // sem pro-labore
      const currentProLabore = n("currentProLabore");
      const targetProLabore = n("targetProLabore");
      const currentResult = rev * mcPct - currentFixed - currentProLabore;
      const gap = targetProLabore - currentProLabore; // quanto mais precisa cobrir
      // Opção A: crescer receita → ΔRev = gap / mcPct
      const revNeeded = mcPct > 0 ? gap / mcPct : null;
      const newRev = rev + (revNeeded ?? 0);
      const growthPct = rev > 0 && revNeeded ? (revNeeded / rev) * 100 : null;
      // Opção B: cortar custo fixo pelo mesmo valor
      const fixedCutNeeded = gap;
      return {
        currentRevenue: Math.round(rev), currentProLabore: Math.round(currentProLabore),
        targetProLabore: Math.round(targetProLabore), monthlyGap: Math.round(gap),
        optionA_RevenueNeeded: revNeeded ? Math.round(newRev) : null,
        optionA_RevenueGrowthPct: growthPct,
        optionB_FixedCostCutNeeded: Math.round(fixedCutNeeded),
        insight: [
          revNeeded ? `Opção A — crescer receita para R$ ${Math.round(newRev).toLocaleString("pt-BR")} (+${growthPct?.toFixed(1)}%)` : "",
          `Opção B — cortar R$ ${Math.round(fixedCutNeeded).toLocaleString("pt-BR")}/mês em custos fixos`,
        ].filter(Boolean).join(" | "),
      };
    }

    /* ══════════════════════════════════════════════════════════════
       COMERCIAL
    ══════════════════════════════════════════════════════════════ */

    case "funnel": {
      const leads = n("leads");
      const convRate = pct("conversionRate", 5);
      const ticket = n("averageTicket");
      const customers = Math.round(leads * convRate);
      const revenue = customers * ticket;
      return { leads, conversionRate: convRate * 100, customers, averageTicket: ticket, revenue };
    }

    case "funnel_stage": {
      // Melhorar uma etapa específica do funil
      const leads = n("monthlyLeads");
      const stage1Conv = pct("stage1ConvPct", 40);   // leads → propostas
      const stage2Conv = pct("stage2ConvPct", 30);   // propostas → negociações
      const stage3Conv = pct("stage3ConvPct", 50);   // negociações → fechamentos
      const ticket = n("averageTicket");
      const improveStage = String(params.improveStage ?? "1");
      const improvePct = pct("improvementPct", 20);

      const stages = [stage1Conv, stage2Conv, stage3Conv];
      const idx = Number(improveStage) - 1;
      const improvedStages = stages.map((s, i) => i === idx ? Math.min(1, s * (1 + improvePct)) : s);

      const currentCustomers = Math.round(leads * stage1Conv * stage2Conv * stage3Conv);
      const newCustomers     = Math.round(leads * improvedStages[0] * improvedStages[1] * improvedStages[2]);
      const currentRevenue   = currentCustomers * ticket;
      const newRevenue       = newCustomers * ticket;

      return {
        monthlyLeads: leads, averageTicket: ticket,
        currentCustomers, currentRevenue: Math.round(currentRevenue),
        newCustomers, newRevenue: Math.round(newRevenue),
        revenueGain: Math.round(newRevenue - currentRevenue),
        improvedStage: `Etapa ${improveStage}`,
        improvementApplied: improvePct * 100,
        verdict: `Melhorar conversão da Etapa ${improveStage} em ${(improvePct*100).toFixed(0)}% gera +${newCustomers - currentCustomers} clientes e +R$ ${Math.round(newRevenue - currentRevenue).toLocaleString("pt-BR")}/mês`,
      };
    }

    case "ticket_impact": {
      // Impacto de aumentar ou reduzir o ticket médio
      const clients = n("activeClients");
      const currentTicket = n("currentTicket");
      const newTicket = n("newTicket");
      const currentRevenue = clients * currentTicket;
      const newRevenue     = clients * newTicket;
      const delta = newRevenue - currentRevenue;
      return {
        activeClients: clients,
        currentTicket, newTicket,
        currentRevenue: Math.round(currentRevenue),
        newRevenue: Math.round(newRevenue),
        revenueDelta: Math.round(delta),
        revenueDeltaPct: currentRevenue > 0 ? (delta / currentRevenue) * 100 : 0,
        verdict: delta >= 0
          ? `Aumento de ticket gera +R$ ${Math.round(delta).toLocaleString("pt-BR")}/mês`
          : `Redução de ticket causa -R$ ${Math.round(Math.abs(delta)).toLocaleString("pt-BR")}/mês`,
      };
    }

    case "sales_team_sizing": {
      // Quantos vendedores são necessários para atingir uma meta
      const target = n("revenueTarget");
      const avgSale = n("avgSaleValue");
      const closingsPerSalesperson = n("closingsPerSalesperson", 10); // por mês
      const salesNeeded = avgSale > 0 ? Math.ceil(target / avgSale) : 0;
      const salespeopleNeeded = closingsPerSalesperson > 0 ? Math.ceil(salesNeeded / closingsPerSalesperson) : 0;
      const avgSalespersonRevenue = closingsPerSalesperson * avgSale;
      return {
        revenueTarget: Math.round(target),
        avgSaleValue: Math.round(avgSale),
        closingsPerSalesperson,
        salesNeededPerMonth: salesNeeded,
        salespeopleNeeded,
        avgSalespersonRevenue: Math.round(avgSalespersonRevenue),
        verdict: `Para receita de R$ ${Math.round(target).toLocaleString("pt-BR")}/mês são necessários ${salespeopleNeeded} vendedores`,
      };
    }

    /* ══════════════════════════════════════════════════════════════
       MARKETING
    ══════════════════════════════════════════════════════════════ */

    case "marketing_funnel": {
      const impressions = n("impressions");
      const ctr = pct("ctrPct", 3);
      const landingConv = pct("landingConvPct", 20);
      const salesConv = pct("salesConvPct", 5);
      const ticket = n("averageTicket");
      const adSpend = n("adSpend");
      const clicks = Math.round(impressions * ctr);
      const leads  = Math.round(clicks * landingConv);
      const sales  = Math.round(leads * salesConv);
      const revenue = sales * ticket;
      const cac = sales > 0 ? adSpend / sales : null;
      const roas = adSpend > 0 ? revenue / adSpend : null;
      return {
        impressions, ctrPct: ctr * 100, clicks,
        landingConvPct: landingConv * 100, leads,
        salesConvPct: salesConv * 100, sales,
        averageTicket: ticket, revenue: Math.round(revenue),
        adSpend: Math.round(adSpend),
        cac: cac ? Math.round(cac) : null,
        roas: roas ? roas : null,
        roi: adSpend > 0 ? ((revenue - adSpend) / adSpend) * 100 : null,
      };
    }

    case "channel_metrics": {
      const spend = n("adSpend");
      const clicks = n("clicks");
      const leads  = n("leads");
      const sales  = n("sales");
      const ticket = n("avgTicket");
      const revenue = sales * ticket;
      return {
        adSpend: Math.round(spend),
        clicks, leads, sales,
        ctr: clicks > 0 && spend > 0 ? (clicks / (spend / 0.01)) : null, // placeholder, usually impressions based
        cpl: leads > 0 ? spend / leads : null,
        cac: sales > 0 ? spend / sales : null,
        revenue: Math.round(revenue),
        roas: spend > 0 ? revenue / spend : null,
        roi: spend > 0 ? ((revenue - spend) / spend) * 100 : null,
        verdict: spend > 0 && revenue > spend ? `ROAS ${(revenue / spend).toFixed(2)}x — canal rentável` : `ROAS abaixo de 1 — canal deficitário`,
      };
    }

    case "ltv_cac": {
      const ticket = n("avgMonthlyTicket");
      const lifespan = n("avgLifespanMonths", 12);
      const cac = n("cac");
      const ltv = ticket * lifespan;
      const ratio = cac > 0 ? ltv / cac : null;
      let classification = "";
      if (ratio !== null) {
        if (ratio < 1) classification = "Crítico — perde dinheiro por cliente";
        else if (ratio < 2) classification = "Ruim — margem insuficiente para crescer";
        else if (ratio < 3) classification = "Aceitável — zona de atenção";
        else if (ratio < 5) classification = "Bom — modelo saudável";
        else classification = "Excelente — alta eficiência de aquisição";
      }
      return {
        avgMonthlyTicket: ticket, avgLifespanMonths: lifespan,
        ltv: Math.round(ltv), cac: Math.round(cac),
        ltvCacRatio: ratio,
        classification,
        paybackMonths: ticket > 0 ? Math.ceil(cac / ticket) : null,
        verdict: ratio ? `LTV/CAC = ${ratio.toFixed(2)}x — ${classification}` : "Informe o CAC para calcular",
      };
    }

    case "budget_reallocation": {
      // Redistribuir budget entre canais para minimizar CAC médio
      const budget1 = n("channel1Budget");
      const cac1    = n("channel1CAC");
      const budget2 = n("channel2Budget");
      const cac2    = n("channel2CAC");
      const budget3 = n("channel3Budget", 0);
      const cac3    = n("channel3CAC", 0);
      const totalBudget = budget1 + budget2 + budget3;
      // Clientes atuais por canal
      const clients1 = cac1 > 0 ? budget1 / cac1 : 0;
      const clients2 = cac2 > 0 ? budget2 / cac2 : 0;
      const clients3 = cac3 > 0 && budget3 > 0 ? budget3 / cac3 : 0;
      const totalClients = clients1 + clients2 + clients3;
      const avgCAC = totalClients > 0 ? totalBudget / totalClients : 0;
      // Alocar tudo para o canal com menor CAC
      const channels = [
        { name: "Canal 1", cac: cac1, budget: budget1, clients: clients1 },
        { name: "Canal 2", cac: cac2, budget: budget2, clients: clients2 },
        ...(budget3 > 0 ? [{ name: "Canal 3", cac: cac3, budget: budget3, clients: clients3 }] : []),
      ].sort((a, b) => a.cac - b.cac);
      const bestChannel = channels[0];
      const optimizedClients = bestChannel.cac > 0 ? totalBudget / bestChannel.cac : 0;
      return {
        totalBudget: Math.round(totalBudget),
        currentTotalClients: Math.round(totalClients),
        currentAvgCAC: Math.round(avgCAC),
        bestChannel: bestChannel.name,
        bestChannelCAC: Math.round(bestChannel.cac),
        optimizedClients: Math.round(optimizedClients),
        clientsGain: Math.round(optimizedClients - totalClients),
        verdict: `Concentrar budget em ${bestChannel.name} (CAC R$ ${Math.round(bestChannel.cac).toLocaleString("pt-BR")}) gera +${Math.round(optimizedClients - totalClients)} clientes extras`,
      };
    }

    /* ══════════════════════════════════════════════════════════════
       OPERAÇÕES
    ══════════════════════════════════════════════════════════════ */

    case "bottleneck": {
      // Identificar gargalo e simular melhoria de uma etapa
      const s1 = n("stage1Capacity", 100);
      const s2 = n("stage2Capacity", 80);
      const s3 = n("stage3Capacity", 120);
      const demand = n("currentDemand", 90);
      const capacities = [s1, s2, s3];
      const bottleneckCap = Math.min(...capacities);
      const bottleneckIdx = capacities.indexOf(bottleneckCap) + 1;
      const actualOutput = Math.min(bottleneckCap, demand);
      const utilizationPct = bottleneckCap > 0 ? (actualOutput / bottleneckCap) * 100 : 0;
      const unmetDemand = Math.max(0, demand - bottleneckCap);
      // Simular melhoria do gargalo em 20%
      const improvedBottleneck = bottleneckCap * 1.2;
      const newCapacities = capacities.map((c, i) => i === bottleneckIdx - 1 ? improvedBottleneck : c);
      const newBottleneck = Math.min(...newCapacities);
      const newOutput = Math.min(newBottleneck, demand);
      return {
        stage1Capacity: s1, stage2Capacity: s2, stage3Capacity: s3,
        currentDemand: demand,
        bottleneckStage: `Etapa ${bottleneckIdx}`,
        bottleneckCapacity: bottleneckCap,
        actualOutput: Math.round(actualOutput),
        utilizationPct,
        unmetDemand: Math.round(unmetDemand),
        outputWith20PctImprovement: Math.round(newOutput),
        demandGain: Math.round(newOutput - actualOutput),
        verdict: `Gargalo na Etapa ${bottleneckIdx} (${bottleneckCap} unid./período). Melhorar 20% aumenta output em ${Math.round(newOutput - actualOutput)} unidades`,
      };
    }

    case "capacity_utilization": {
      const maxCap = n("maxCapacity");
      const currentProd = n("currentProduction");
      const revenuePerUnit = n("revenuePerUnit");
      const utilization = maxCap > 0 ? (currentProd / maxCap) * 100 : 0;
      const idle = maxCap - currentProd;
      const potentialRevenue = idle * revenuePerUnit;
      return {
        maxCapacity: maxCap, currentProduction: Math.round(currentProd),
        utilizationPct: utilization,
        idleCapacity: Math.round(idle),
        idleCapacityPct: 100 - utilization,
        revenuePerUnit,
        potentialRevenueFromFullCapacity: Math.round(potentialRevenue),
        verdict: `Utilização atual: ${utilization.toFixed(1)}%. Explorar capacidade ociosa pode gerar +R$ ${Math.round(potentialRevenue).toLocaleString("pt-BR")}`,
      };
    }

    case "oee": {
      const availability = pct("availabilityPct", 90);
      const performance  = pct("performancePct", 85);
      const quality      = pct("qualityPct", 95);
      const oee = availability * performance * quality * 100;
      let classification = "";
      if (oee >= 85) classification = "Classe Mundial (≥85%)";
      else if (oee >= 65) classification = "Bom (65–84%)";
      else if (oee >= 45) classification = "Médio (45–64%)";
      else classification = "Baixo (<45%) — alto potencial de melhoria";
      return {
        availabilityPct: availability * 100,
        performancePct: performance * 100,
        qualityPct: quality * 100,
        oee,
        classification,
        gapToWorldClass: Math.max(0, 85 - oee),
        verdict: `OEE = ${oee.toFixed(1)}% — ${classification}`,
      };
    }

    case "ops_metric_improvement": {
      // Simular melhoria de uma métrica operacional genérica
      const current = n("currentMetricValue");
      const target  = n("targetMetricValue");
      const revenueImpactPerUnit = n("revenueImpactPerUnit", 0);
      const improvementAbs = target - current;
      const improvementPct = current !== 0 ? ((target - current) / Math.abs(current)) * 100 : 0;
      const revenueImpact  = Math.abs(improvementAbs) * revenueImpactPerUnit;
      return {
        currentMetricValue: current, targetMetricValue: target,
        improvementAbsolute: improvementAbs,
        improvementPct,
        revenueImpact: Math.round(revenueImpact),
        verdict: revenueImpactPerUnit > 0
          ? `Melhoria de ${Math.abs(improvementPct).toFixed(1)}% na métrica gera impacto de R$ ${Math.round(revenueImpact).toLocaleString("pt-BR")}`
          : `Melhoria de ${Math.abs(improvementPct).toFixed(1)}% na métrica (impacto financeiro não informado)`,
      };
    }

    /* ══════════════════════════════════════════════════════════════
       RH
    ══════════════════════════════════════════════════════════════ */

    case "turnover": {
      const employees    = n("employees", 1);
      const turnoverRate = pct("turnoverRate", 20);
      const costPerHire  = n("costPerHire", 5000);
      const avgSalary    = n("avgSalary", 0);
      // Custo total = custo de admissão + rescisão (~1 salário) + produtividade perdida (~3 meses)
      const rescission   = avgSalary > 0 ? avgSalary : 0;
      const rampingLoss  = avgSalary > 0 ? avgSalary * 3 : 0;
      const costPerTurnover = costPerHire + rescission + rampingLoss;
      const annualTurnoverCost = employees * turnoverRate * costPerTurnover;
      return {
        employees, turnoverRatePct: turnoverRate * 100,
        costPerHire, avgSalary,
        costPerTurnoverEvent: Math.round(costPerTurnover),
        annualTurnoverCost: Math.round(annualTurnoverCost),
        monthlyTurnoverCost: Math.round(annualTurnoverCost / 12),
        verdict: `Turnover custa R$ ${Math.round(annualTurnoverCost).toLocaleString("pt-BR")}/ano à empresa`,
      };
    }

    case "retention_program": {
      // Simular se um programa de retenção se paga
      const employees    = n("employees");
      const turnoverRate = pct("turnoverRate", 20);
      const costPerHire  = n("costPerHire", 5000);
      const programCost  = n("annualProgramCost");
      const expectedRetentionGain = pct("expectedRetentionImprovementPct", 30); // melhoria da taxa de retenção
      const currentTurnoverCost = employees * turnoverRate * costPerHire;
      const newTurnoverRate = turnoverRate * (1 - expectedRetentionGain);
      const newTurnoverCost = employees * newTurnoverRate * costPerHire;
      const annualSavings  = currentTurnoverCost - newTurnoverCost;
      const netBenefit     = annualSavings - programCost;
      const payback        = programCost > 0 && annualSavings > 0 ? (programCost / annualSavings) * 12 : null;
      return {
        employees, currentTurnoverRatePct: turnoverRate * 100,
        currentAnnualTurnoverCost: Math.round(currentTurnoverCost),
        expectedRetentionImprovementPct: expectedRetentionGain * 100,
        newTurnoverRatePct: newTurnoverRate * 100,
        newAnnualTurnoverCost: Math.round(newTurnoverCost),
        annualProgramCost: Math.round(programCost),
        annualSavings: Math.round(annualSavings),
        netAnnualBenefit: Math.round(netBenefit),
        paybackMonths: payback ? Math.ceil(payback) : null,
        isWorthy: netBenefit > 0,
        verdict: netBenefit > 0
          ? `Programa se paga em ${payback ? Math.ceil(payback) + " meses" : "—"} e gera R$ ${Math.round(netBenefit).toLocaleString("pt-BR")}/ano líquido`
          : `Programa NÃO se paga — custo supera a economia em R$ ${Math.round(Math.abs(netBenefit)).toLocaleString("pt-BR")}/ano`,
      };
    }

    case "workforce_sizing": {
      const totalWorkloadHours = n("totalMonthlyWorkloadHours");
      const productiveHours    = n("productiveHoursPerEmployee", 160);
      const needed = productiveHours > 0 ? Math.ceil(totalWorkloadHours / productiveHours) : 0;
      const currentEmployees = n("currentEmployees", 0);
      const surplus = currentEmployees - needed;
      return {
        totalMonthlyWorkloadHours: totalWorkloadHours,
        productiveHoursPerEmployee: productiveHours,
        employeesNeeded: needed,
        currentEmployees,
        surplus: surplus,
        verdict: surplus === 0
          ? "Equipe está dimensionada corretamente"
          : surplus > 0
          ? `Equipe ${surplus > 0 ? "excedente" : "deficitária"} em ${Math.abs(surplus)} colaborador(es)`
          : `Faltam ${Math.abs(surplus)} colaborador(es) para cobrir a carga de trabalho`,
      };
    }

    case "training_roi": {
      const trainingCost    = n("trainingCost");
      const employees       = n("employees");
      const avgSalary       = n("avgMonthlySalary");
      const productivityGain = pct("productivityGainPct", 10);
      const durationMonths  = n("benefitDurationMonths", 12);
      const monthlyGain = employees * avgSalary * productivityGain;
      const totalGain   = monthlyGain * durationMonths;
      const roi         = trainingCost > 0 ? ((totalGain - trainingCost) / trainingCost) * 100 : 0;
      const payback     = monthlyGain > 0 ? trainingCost / monthlyGain : null;
      return {
        trainingCost: Math.round(trainingCost), employees,
        avgMonthlySalary: Math.round(avgSalary),
        productivityGainPct: productivityGain * 100,
        monthlyProductivityGain: Math.round(monthlyGain),
        totalGainOverPeriod: Math.round(totalGain),
        roi,
        paybackMonths: payback ? Math.ceil(payback) : null,
        verdict: roi > 0
          ? `ROI de ${roi.toFixed(0)}% — payback em ${payback ? Math.ceil(payback) : "—"} meses`
          : `Treinamento não se paga dentro do período de ${durationMonths} meses`,
      };
    }

    /* ══════════════════════════════════════════════════════════════
       RISCOS
    ══════════════════════════════════════════════════════════════ */

    case "risk_matrix": {
      const probability = n("probability", 3); // 1–5
      const impact      = n("impact", 3);       // 1–5
      const score = probability * impact;
      let level = "";
      if (score <= 4)  level = "Baixo";
      else if (score <= 9)  level = "Médio";
      else if (score <= 16) level = "Alto";
      else level = "Crítico";
      return {
        probability, impact, riskScore: score,
        riskLevel: level,
        priorityAction: score >= 15
          ? "Ação imediata necessária — tratar como prioridade máxima"
          : score >= 10
          ? "Plano de mitigação deve ser criado em 30 dias"
          : score >= 5
          ? "Monitorar e revisar trimestralmente"
          : "Aceitar o risco e registrar",
        verdict: `Score ${score}/25 — Risco ${level}`,
      };
    }

    case "risk_expected_loss": {
      const probabilityPct = pct("probabilityPct", 20);
      const maxLoss        = n("maxLoss");
      const expectedLoss   = probabilityPct * maxLoss;
      const mitigationCost = n("mitigationCost", 0);
      const netBenefit     = expectedLoss - mitigationCost;
      return {
        probabilityPct: probabilityPct * 100, maxLoss: Math.round(maxLoss),
        expectedLoss: Math.round(expectedLoss),
        mitigationCost: Math.round(mitigationCost),
        netBenefitOfMitigation: Math.round(netBenefit),
        isMitigationWorthy: mitigationCost > 0 && netBenefit > 0,
        verdict: mitigationCost > 0
          ? netBenefit > 0
            ? `Mitigar vale a pena: economiza R$ ${Math.round(netBenefit).toLocaleString("pt-BR")} em valor esperado`
            : `Aceitar o risco é mais barato: mitigação custa R$ ${Math.round(mitigationCost - expectedLoss).toLocaleString("pt-BR")} a mais que a perda esperada`
          : `Perda esperada: R$ ${Math.round(expectedLoss).toLocaleString("pt-BR")}`,
      };
    }

    case "risk_response": {
      // Comparar estratégias: Aceitar / Reduzir / Transferir / Evitar
      const expectedLoss   = n("expectedLoss");
      const reduceCost     = n("reduceCost");
      const reduceResidual = n("reduceResidualLoss");
      const transferCost   = n("transferCost"); // seguro/terceiro
      const avoidCost      = n("avoidCost");    // custo de não fazer a atividade
      const strategies = [
        { name: "Aceitar",      totalCost: expectedLoss,                netCost: expectedLoss },
        { name: "Reduzir",      totalCost: reduceCost + reduceResidual, netCost: reduceCost + reduceResidual },
        { name: "Transferir",   totalCost: transferCost,                netCost: transferCost },
        { name: "Evitar",       totalCost: avoidCost,                   netCost: avoidCost },
      ].sort((a, b) => a.totalCost - b.totalCost);
      const best = strategies[0];
      return {
        expectedLoss: Math.round(expectedLoss),
        acceptCost: Math.round(expectedLoss),
        reduceCost: Math.round(reduceCost), reduceResidual: Math.round(reduceResidual),
        transferCost: Math.round(transferCost),
        avoidCost: Math.round(avoidCost),
        recommendedStrategy: best.name,
        strategyCostRanking: strategies.map(s => `${s.name}: R$ ${Math.round(s.totalCost).toLocaleString("pt-BR")}`).join(" | "),
        verdict: `Melhor estratégia: ${best.name} (custo total R$ ${Math.round(best.totalCost).toLocaleString("pt-BR")})`,
      };
    }

    case "risk_prioritization": {
      // Priorizar até 5 riscos por exposição financeira (prob × impacto)
      const risks = [1, 2, 3, 4, 5].map(i => ({
        name: String(params[`risk${i}Name`] ?? `Risco ${i}`),
        probability: pct(`risk${i}ProbabilityPct`, 0),
        maxLoss: n(`risk${i}MaxLoss`, 0),
      })).filter(r => r.maxLoss > 0);
      const scored = risks
        .map(r => ({ name: r.name, expectedLoss: Math.round(r.probability * r.maxLoss), probability: r.probability * 100, maxLoss: Math.round(r.maxLoss) }))
        .sort((a, b) => b.expectedLoss - a.expectedLoss);
      return {
        risksAnalyzed: scored.length,
        prioritizedList: scored.map((r, i) => `#${i+1} ${r.name} — Perda esperada R$ ${r.expectedLoss.toLocaleString("pt-BR")}`).join(" | "),
        highestPriorityRisk: scored[0]?.name ?? "—",
        totalExpectedLoss: scored.reduce((s, r) => s + r.expectedLoss, 0),
        ranked: scored,
      };
    }

    /* ══════════════════════════════════════════════════════════════
       INTELIGÊNCIA DE MERCADO
    ══════════════════════════════════════════════════════════════ */

    case "competitive_gap": {
      const companyValue   = n("companyValue");
      const benchmarkValue = n("benchmarkValue");
      const higherIsBetter = String(params.higherIsBetter ?? "true") !== "false";
      const gap = benchmarkValue !== 0 ? ((companyValue - benchmarkValue) / Math.abs(benchmarkValue)) * 100 : 0;
      const isAhead = higherIsBetter ? gap >= 0 : gap <= 0;
      return {
        companyValue, benchmarkValue,
        gapPct: gap,
        gapAbsolute: companyValue - benchmarkValue,
        isAheadOfBenchmark: isAhead,
        verdict: isAhead
          ? `Empresa está ${Math.abs(gap).toFixed(1)}% acima do benchmark — vantagem competitiva`
          : `Empresa está ${Math.abs(gap).toFixed(1)}% abaixo do benchmark — gap a fechar`,
      };
    }

    case "market_share": {
      const companyRev = n("companyRevenue");
      const totalMarket = n("totalMarketRevenue");
      const share = totalMarket > 0 ? (companyRev / totalMarket) * 100 : 0;
      const targetShare = pct("targetSharePct", 0);
      const revenueForTarget = targetShare > 0 ? totalMarket * targetShare : null;
      return {
        companyRevenue: Math.round(companyRev),
        totalMarketRevenue: Math.round(totalMarket),
        currentMarketSharePct: share,
        targetMarketSharePct: targetShare * 100,
        revenueNeededForTarget: revenueForTarget ? Math.round(revenueForTarget) : null,
        revenueGapToTarget: revenueForTarget ? Math.round(revenueForTarget - companyRev) : null,
        verdict: `Participação atual: ${share.toFixed(2)}% do mercado total`,
      };
    }

    case "market_growth": {
      const companyGrowth = pct("companyGrowthPct");
      const marketGrowth  = pct("marketGrowthPct");
      const relative = companyGrowth - marketGrowth;
      let verdict = "";
      if (relative > 0.02) verdict = `Empresa cresce ${(relative*100).toFixed(1)}pp acima do mercado — ganhando participação`;
      else if (relative < -0.02) verdict = `Empresa cresce ${(Math.abs(relative)*100).toFixed(1)}pp abaixo do mercado — perdendo participação`;
      else verdict = "Empresa cresce na mesma velocidade que o mercado — participação estável";
      return {
        companyGrowthPct: companyGrowth * 100,
        marketGrowthPct: marketGrowth * 100,
        relativeGrowthPp: relative * 100,
        isGainingShare: relative > 0,
        verdict,
      };
    }

    /* ══════════════════════════════════════════════════════════════
       INOVAÇÃO
    ══════════════════════════════════════════════════════════════ */

    case "process_automation": {
      const hourlyRate     = n("hourlyRate");
      const hoursPerMonth  = n("hoursPerMonth");
      const errorRate      = pct("errorRatePct", 5);
      const costPerError   = n("costPerError");
      const automationCost = n("automationCost"); // custo único de implantação
      const monthlyMaint   = n("monthlyMaintenanceCost", 0);
      const manualCost     = hourlyRate * hoursPerMonth;
      const errorCost      = manualCost * errorRate * costPerError;
      const totalManual    = manualCost + errorCost;
      const savings        = totalManual - monthlyMaint;
      const payback        = savings > 0 ? Math.ceil(automationCost / savings) : null;
      const annualROI      = automationCost > 0 && savings > 0 ? ((savings * 12 - automationCost) / automationCost) * 100 : 0;
      return {
        manualHourlyCost: hourlyRate, hoursPerMonth,
        monthlyLaborCost: Math.round(manualCost),
        monthlyErrorCost: Math.round(errorCost),
        totalMonthlyManualCost: Math.round(totalManual),
        automationCost: Math.round(automationCost),
        monthlyMaintenanceCost: Math.round(monthlyMaint),
        monthlySavings: Math.round(savings),
        paybackMonths: payback,
        annualROI,
        verdict: payback
          ? `Automação se paga em ${payback} meses com ROI anual de ${annualROI.toFixed(0)}%`
          : `Automação não se paga — revisar premissas`,
      };
    }

    /* ══════════════════════════════════════════════════════════════
       REDE/FRANQUIAS
    ══════════════════════════════════════════════════════════════ */

    /* ══════════════════════════════════════════════════════════════
       ESTRATÉGIA
    ══════════════════════════════════════════════════════════════ */

    case "growth_scenario": {
      // Projeção de crescimento planejado: receita-alvo, investimento e resultado projetado
      const rev         = n("currentRevenue");
      const growthPct   = pct("targetGrowthPct", 20);    // crescimento esperado %
      const mcPct       = pct("contributionMarginPct", 30);
      const fixedBase   = n("currentFixedCosts");
      const expansion   = n("expansionInvestment", 0);   // investimento único de expansão
      const newFixedPct = pct("expansionFixedCostPct", 0); // % a mais em custos fixos pelo crescimento

      const projRev     = rev * (1 + growthPct);
      const projMC      = projRev * mcPct;
      const newFixed    = fixedBase * (1 + newFixedPct) + expansion;
      const projResult  = projMC - newFixed;
      const currentResult = rev * mcPct - fixedBase;
      const netGain     = projResult - currentResult;
      const payback     = expansion > 0 && netGain > 0 ? Math.ceil(expansion / (netGain / 12)) : null;

      return {
        currentRevenue:   Math.round(rev),
        projectedRevenue: Math.round(projRev),
        projectedMC:      Math.round(projMC),
        projectedFixedCosts: Math.round(newFixed),
        projectedResult:  Math.round(projResult),
        currentResult:    Math.round(currentResult),
        netGain:          Math.round(netGain),
        paybackMonths:    payback,
        verdict: netGain >= 0
          ? `Cenário viável: resultado operacional sobe R$ ${Math.round(netGain).toLocaleString("pt-BR")} com crescimento de ${(growthPct*100).toFixed(0)}%`
          : `Crescimento não cobre os custos de expansão — resultado cai R$ ${Math.round(Math.abs(netGain)).toLocaleString("pt-BR")}`,
      };
    }

    case "product_mix": {
      // Impacto de mudança no mix de produtos/serviços na margem blended
      const totalRev       = n("totalRevenue");
      const prodAPct       = pct("productARevenuePct", 60);   // % atual do produto A
      const prodAMargin    = pct("productAMarginPct", 40);    // MC% do produto A
      const prodBPct       = 1 - prodAPct;
      const prodBMargin    = pct("productBMarginPct", 20);    // MC% do produto B
      const newProdAPct    = pct("newProductARevenuePct", 70); // novo % do produto A
      const newProdBPct    = 1 - newProdAPct;

      // Margem blended atual e nova
      const currentBlended = prodAPct * prodAMargin + prodBPct * prodBMargin;
      const newBlended     = newProdAPct * prodAMargin + newProdBPct * prodBMargin;
      const marginDelta    = (newBlended - currentBlended) * 100;
      const revImpact      = totalRev * (newBlended - currentBlended);

      return {
        totalRevenue:           Math.round(totalRev),
        currentProductAShare:   prodAPct * 100,
        currentProductBShare:   prodBPct * 100,
        productAMarginPct:      prodAMargin * 100,
        productBMarginPct:      prodBMargin * 100,
        currentBlendedMarginPct: currentBlended * 100,
        newProductAShare:        newProdAPct * 100,
        newProductBShare:        newProdBPct * 100,
        newBlendedMarginPct:     newBlended * 100,
        marginDeltaPp:           marginDelta,
        revenueImpact:           Math.round(revImpact),
        verdict: marginDelta > 0
          ? `Mix otimizado eleva a margem blended em ${marginDelta.toFixed(1)}pp → ganho de R$ ${Math.round(revImpact).toLocaleString("pt-BR")}/período`
          : `Novo mix reduz a margem blended em ${Math.abs(marginDelta).toFixed(1)}pp → impacto negativo de R$ ${Math.round(Math.abs(revImpact)).toLocaleString("pt-BR")}/período`,
      };
    }

    case "break_even_new_product": {
      // Ponto de equilíbrio de um novo produto/serviço antes de lançar
      const price        = n("newProductPrice");
      const unitCost     = n("newProductUnitCost");
      const fixedCosts   = n("newProductFixedCosts");
      const targetMonths = n("targetMonths", 12);

      const mcUnit = price - unitCost;
      const mcPctNew = price > 0 ? mcUnit / price : 0;

      // Unidades para cobrir fixos
      const beUnits   = mcUnit > 0 ? Math.ceil(fixedCosts / mcUnit) : null;
      const beRevenue = beUnits !== null ? beUnits * price : null;
      // Unidades mensais necessárias para fechar no targetMonths
      const monthlyUnits = beUnits !== null && targetMonths > 0 ? Math.ceil(beUnits / targetMonths) : null;
      // Receita mensal mínima
      const monthlyRevMin = monthlyUnits !== null ? monthlyUnits * price : null;

      return {
        newProductPrice:   price,
        newProductUnitCost: unitCost,
        unitContributionMargin: Math.round(mcUnit),
        contributionMarginPct:  mcPctNew * 100,
        newProductFixedCosts:   Math.round(fixedCosts),
        breakEvenUnits:         beUnits,
        breakEvenRevenue:       beRevenue !== null ? Math.round(beRevenue) : null,
        targetMonths,
        monthlyUnitsNeeded:     monthlyUnits,
        monthlyRevenueNeeded:   monthlyRevMin !== null ? Math.round(monthlyRevMin) : null,
        verdict: beUnits !== null
          ? `Ponto de equilíbrio em ${beUnits.toLocaleString("pt-BR")} unidades (R$ ${Math.round(beRevenue!).toLocaleString("pt-BR")}). Para cobrir em ${targetMonths} meses: ${monthlyUnits?.toLocaleString("pt-BR")} unid./mês`
          : "Margem unitária negativa — produto inviável no preço atual",
      };
    }

    case "network": {
      const units = n("units", 1);
      const avgRevenue = n("avgUnitRevenue");
      const totalRevenue = units * avgRevenue;
      return { units, avgUnitRevenue: Math.round(avgRevenue), networkRevenue: Math.round(totalRevenue) };
    }

    default:
      return { error: `Tipo de simulação desconhecido: ${type}` };
  }
}

export default router;
