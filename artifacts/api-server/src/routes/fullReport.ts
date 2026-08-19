import { Router } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { companies, companyData, reports, reportSettings } from "@workspace/db/schema";
import { requireAuth } from "../middlewares/requireAuth";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { runEngines, buildFindings, buildBluf } from "./calculations";
import { buildFinancialContext } from "./investigations";
import {
  BASE_THRESHOLDS,
  buildChecklist,
  buildScorecard,
  ENGINE_NAMES,
  INDICATOR_DEFS,
  type Threshold,
} from "./fullReportMetrics";
import { validateReportSettingsThresholds } from "./reportSettingsThresholds";
import { generateNarrativeWithRetry } from "./fullReportNarrative";
import type { PdfFinancialIndicators } from "../lib/generatePdfReport";
import { buildPdfDiagnosticIndicators } from "../lib/generatePdfReport";

export { buildChecklist, buildScorecard, classify } from "./fullReportMetrics";
export { extractNarrativeJson, parseNarrativeJson } from "./fullReportNarrative";
export type { Threshold } from "./fullReportMetrics";
export { findPreviousPeriod, isScorecard } from "./fullReportComparison";
export type { Scorecard, ScorecardComparison } from "./fullReportComparison";

const router = Router({ mergeParams: true });

function canAccess(user: any, company: any): boolean {
  return user.role === "admin" || company.ownerId === user.id;
}

// Ajustes por setor sobre a base (o consultor pode editar tudo depois)
const SECTOR_PRESETS: Record<string, Partial<Record<string, Threshold>>> = {
  geral: {},
  varejo: {
    mcPct: { bounds: [10, 20, 30, 45], direction: "higher" },
    conversionRate: { bounds: [5, 10, 20, 35], direction: "higher" },
    cashCycle: { bounds: [45, 25, 10, 0], direction: "lower" },
  },
  servicos: {
    mcPct: { bounds: [30, 45, 60, 75], direction: "higher" },
    churnRate: { bounds: [8, 5, 3, 1], direction: "lower" },
  },
  industria: {
    mcPct: { bounds: [15, 25, 40, 55], direction: "higher" },
    cashCycle: { bounds: [90, 60, 30, 10], direction: "lower" },
    ebitdaMargin: { bounds: [0, 6, 12, 22], direction: "higher" },
  },
  tecnologia: {
    mcPct: { bounds: [40, 55, 70, 80], direction: "higher" },
    churnRate: { bounds: [7, 4, 2, 1], direction: "lower" },
  },
};

export const SECTOR_OPTIONS = ["geral", "varejo", "servicos", "industria", "tecnologia"];

function thresholdsForSector(sector: string): Record<string, Threshold> {
  return { ...BASE_THRESHOLDS, ...(SECTOR_PRESETS[sector] ?? {}) } as Record<string, Threshold>;
}

import {
  findPreviousPeriod,
  isScorecard,
  type Scorecard,
  type ScorecardComparison,
} from "./fullReportComparison.ts";

/**
 * Find the scorecard for the closest earlier period with data.
 *
 * Saved full diagnostic reports are preferred because they preserve the
 * thresholds used when that report was generated. If that period has data
 * but no saved report, calculate a scorecard from the stored data so the
 * current report can still show a useful comparison.
 */
async function getPreviousScorecard(
  companyId: number,
  period: string,
  thresholds: Record<string, Threshold>,
): Promise<ScorecardComparison | null> {
  const periodRows = await db.select({ period: companyData.period })
    .from(companyData)
    .where(eq(companyData.companyId, companyId))
    .orderBy(desc(companyData.period));

  const periodsWithData = [...new Set(periodRows.map((row) => row.period))];
  const previousPeriod = findPreviousPeriod(periodsWithData, period);
  if (!previousPeriod) return null;

  const [savedPreviousRow] = await db.select({ content: reports.content })
    .from(reports)
    .where(and(
      eq(reports.companyId, companyId),
      eq(reports.type, "full_analysis"),
      sql`${reports.content} ->> 'reportKind' = 'full_diagnostic'`,
      sql`${reports.content} ->> 'period' = ${previousPeriod}`,
    ))
    .limit(1);
  const savedPrevious = savedPreviousRow?.content as { scorecard?: unknown } | undefined;

  if (isScorecard(savedPrevious?.scorecard)) {
    return {
      period: previousPeriod,
      source: "saved_report",
      scorecard: savedPrevious.scorecard,
    };
  }

  const [previousData] = await db.select().from(companyData)
    .where(and(eq(companyData.companyId, companyId), eq(companyData.period, previousPeriod)))
    .limit(1);
  if (!previousData) return null;

  const previousEngineResults = runEngines([...ENGINE_NAMES], previousData) as Record<string, any>;
  return {
    period: previousPeriod,
    source: "calculated_from_data",
    scorecard: buildScorecard(previousData, previousEngineResults, thresholds),
  };
}

// ── Settings helpers ─────────────────────────────────────────────────────────
async function getOrDefaultSettings(companyId: number, companySegment: string | null) {
  const [row] = await db.select().from(reportSettings).where(eq(reportSettings.companyId, companyId)).limit(1);
  if (row) {
    const merged = { ...thresholdsForSector(row.sector), ...((row.thresholds as Record<string, Threshold>) ?? {}) };
    return { sector: row.sector, thresholds: merged, saved: true };
  }
  // infer sector from company segment when possible
  const seg = (companySegment ?? "").toLowerCase();
  const sector = seg.includes("varej") || seg.includes("comérc") || seg.includes("comerc") ? "varejo"
    : seg.includes("serv") ? "servicos"
    : seg.includes("indús") || seg.includes("indus") ? "industria"
    : seg.includes("tec") || seg.includes("soft") || seg.includes("saas") ? "tecnologia"
    : "geral";
  return { sector, thresholds: thresholdsForSector(sector), saved: false };
}

// ── GET /api/companies/:id/report-settings ──────────────────────────────────
router.get("/:id/report-settings", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }
  if (!canAccess(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }

  const settings = await getOrDefaultSettings(id, company.segment);
  const sectorDefaults = Object.fromEntries(SECTOR_OPTIONS.map((s) => [s, thresholdsForSector(s)]));
  res.json({ ...settings, sectorOptions: SECTOR_OPTIONS, indicatorDefs: INDICATOR_DEFS, sectorDefaults });
});

// ── PUT /api/companies/:id/report-settings ──────────────────────────────────
router.put("/:id/report-settings", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }
  if (!canAccess(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }

  const { sector, thresholds } = req.body ?? {};
  if (!sector || !SECTOR_OPTIONS.includes(sector)) {
    res.status(400).json({ error: `sector inválido — use um de: ${SECTOR_OPTIONS.join(", ")}` });
    return;
  }
  const validatedThresholds = validateReportSettingsThresholds(thresholds);
  if (validatedThresholds.error) {
    res.status(400).json({ error: validatedThresholds.error });
    return;
  }
  const clean = validatedThresholds.thresholds;

  await db.insert(reportSettings)
    .values({ companyId: id, sector, thresholds: clean, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: reportSettings.companyId,
      set: { sector, thresholds: clean, updatedAt: new Date() },
    });

  const settings = await getOrDefaultSettings(id, company.segment);
  const sectorDefaults = Object.fromEntries(SECTOR_OPTIONS.map((s) => [s, thresholdsForSector(s)]));
  res.json({ ...settings, sectorOptions: SECTOR_OPTIONS, indicatorDefs: INDICATOR_DEFS, sectorDefaults });
});

// ── GET /api/companies/:id/full-report/preflight?period=X ───────────────────
router.get("/:id/full-report/preflight", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const period = req.query.period ? String(req.query.period) : null;
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }
  if (!canAccess(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }
  if (!period) { res.status(400).json({ error: "period obrigatório" }); return; }

  const [dataRow] = await db.select().from(companyData)
    .where(and(eq(companyData.companyId, id), eq(companyData.period, period)))
    .limit(1);

  const checklist = buildChecklist(dataRow);
  const missingCount = checklist.reduce((acc, g) => acc + g.fields.filter((f) => !f.filled).length, 0);
  const totalCount = checklist.reduce((acc, g) => acc + g.fields.length, 0);
  res.json({ period, hasData: !!dataRow, checklist, missingCount, totalCount });
});

// ── GET /api/companies/:id/full-report/latest?period=X ──────────────────────
router.get("/:id/full-report/latest", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const period = req.query.period ? String(req.query.period) : null;
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }
  if (!canAccess(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }

  const rows = await db.select().from(reports)
    .where(and(eq(reports.companyId, id), eq(reports.type, "full_analysis"), sql`${reports.content} ->> 'reportKind' = 'full_diagnostic'`))
    .orderBy(desc(reports.createdAt))
    .limit(50);

  const match = period ? rows.find((r) => (r.content as any)?.period === period) : rows[0];
  if (!match) { res.status(404).json({ error: "Nenhum relatório salvo" }); return; }
  const savedContent = match.content as any;
  const { thresholds: savedThresholds } = await getOrDefaultSettings(id, company.segment);
  const comparison = await getPreviousScorecard(
    id,
    savedContent.period ?? period ?? "",
    savedContent.thresholds ?? savedThresholds,
  );
  res.json({ id: match.id, title: match.title, createdAt: match.createdAt, report: savedContent, comparison });
});

// ── POST /api/companies/:id/full-report ─────────────────────────────────────
router.post("/:id/full-report", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }
  if (!canAccess(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }

  const { period, save } = req.body ?? {};
  if (!period) { res.status(400).json({ error: "period obrigatório" }); return; }

  const [dataRow] = await db.select().from(companyData)
    .where(and(eq(companyData.companyId, id), eq(companyData.period, period)))
    .limit(1);

  if (!dataRow) {
    res.status(422).json({ error: `Nenhum dado cadastrado para o período ${period}. Cadastre dados na aba Dados.` });
    return;
  }

  const settings = await getOrDefaultSettings(id, company.segment);

  // 1) Motores + findings
  const engineResults = runEngines([...ENGINE_NAMES], dataRow) as Record<string, any>;
  const financialResult = (engineResults.financial ?? {}) as Record<string, unknown>;
  const toNullableNumber = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  };
  const financialIndicators: PdfFinancialIndicators = {
    contributionMargin: toNullableNumber(financialResult.contributionMargin),
    breakEvenRevenue: toNullableNumber(financialResult.breakEvenRevenue),
    safetyMargin: toNullableNumber(financialResult.safetyMargin),
    safetyMarginClass: typeof financialResult.safetyMarginClass === "string"
      ? financialResult.safetyMarginClass
      : null,
    cashCycle: toNullableNumber(financialResult.cashCycle),
  };
  const findings = buildFindings(engineResults, dataRow);
  const blufRecommendation = buildBluf(findings);

  // 2) Scorecard
  const scorecard = buildScorecard(dataRow, engineResults, settings.thresholds);
  const checklist = buildChecklist(dataRow);
  const missingFields = checklist.flatMap((g) => g.fields.filter((f) => !f.filled).map((f) => f.label));

  // 3) Narrativa por seção via IA (voltada ao empresário)
  let narrative: any = null;
  let aiError: string | null = null;
  try {
    const financialCtx = buildFinancialContext(company.name, { title: "Relatório Completo de Diagnóstico", period }, dataRow);
    const scoreCtx = JSON.stringify({
      setor: settings.sector,
      indicadores: scorecard.indicators.map((i) => ({ indicador: i.label, valor: i.value, classificacao: i.levelLabel })),
      motores: scorecard.engines.map((e) => ({ motor: e.label, score: e.score, classificacao: e.levelLabel })),
      achados: findings.map((f: any) => ({ area: f.title, impacto: f.impact, resumo: f.summary })),
      dadosNaoInformados: missingFields,
    }, null, 1);

    const systemPrompt = `${financialCtx}

SCORECARD E RESULTADO DOS MOTORES DE ANÁLISE (já calculados — use como base factual):
${scoreCtx}

MISSÃO:
Escreva a narrativa de um RELATÓRIO COMPLETO DE DIAGNÓSTICO voltado ao EMPRESÁRIO (dono do negócio), não ao consultor.
Linguagem acessível, sem jargão técnico sem explicação. Para cada dimensão com dados: explique o resultado, as causas prováveis, sugestões concretas de melhoria e o impacto esperado de cada ação. Onde não houver dados, diga apenas "Dados não informados" e o que ganhar ao informá-los.

RESPONDA ESTRITAMENTE COM UM JSON VÁLIDO (sem markdown, sem texto fora do JSON) neste formato:
{
  "executiveSummary": "2-4 frases resumindo a situação geral da empresa em linguagem de dono de negócio",
  "sections": [
    {
      "key": "identificador-curto",
      "title": "Título da seção (ex.: Saúde Financeira)",
      "narrative": "explicação acessível do resultado desta dimensão com os números reais",
      "causes": ["causa provável 1", "causa provável 2"],
      "suggestions": [
        { "action": "ação concreta com meta numérica", "expectedImpact": "impacto esperado quantificado quando possível" }
      ]
    }
  ],
  "nextSteps": "orientação objetiva do que fazer primeiro, em 2-3 frases"
}

Crie uma seção para cada dimensão relevante com dados (financeira, comercial, marketing, operações, pessoas, riscos etc.), priorizando as piores classificações primeiro. 4 a 8 seções. Responda em português brasileiro.`;

    narrative = await generateNarrativeWithRetry(async (retry) => {
      const msg = await anthropic.messages.create({
        model: "claude-opus-4-5",
        max_tokens: 8000,
        system: systemPrompt,
        messages: [{
          role: "user",
          content: retry
            ? "A resposta anterior não pôde ser lida como JSON. Gere novamente um JSON completo, válido e mais conciso, estritamente no formato solicitado."
            : "Gere o JSON do relatório agora.",
        }],
      });

      return msg.content
        .filter((block: any) => block.type === "text")
        .map((block: any) => block.text)
        .join("");
    });
  } catch (err: any) {
    aiError = `Falha ao gerar a narrativa por IA: ${err?.message ?? "erro desconhecido"}. O scorecard abaixo foi calculado normalmente — tente atualizar o relatório para gerar a narrativa.`;
  }

  const report = {
    reportKind: "full_diagnostic",
    companyId: id,
    companyName: company.name,
    period,
    sector: settings.sector,
    thresholds: settings.thresholds,
    generatedAt: new Date().toISOString(),
    financialIndicators,
    scorecard,
    diagnosticIndicators: buildPdfDiagnosticIndicators(engineResults),
    checklist,
    missingFields,
    findings,
    blufRecommendation,
    narrative,
    aiError,
  };

  // 4) Salvar (padrão: salva; save=false gera sem salvar)
  let savedReportId: number | null = null;
  if (save !== false) {
    // substitui relatório anterior do mesmo período (mantém 1 por período, atualizável)
    const existing = await db.select().from(reports)
      .where(and(eq(reports.companyId, id), eq(reports.type, "full_analysis"), sql`${reports.content} ->> 'reportKind' = 'full_diagnostic'`, sql`${reports.content} ->> 'period' = ${period}`));
    if (existing.length > 0) {
      const [updated] = await db.update(reports)
        .set({ content: report, title: `Relatório Completo de Diagnóstico — ${company.name} (${period})`, createdAt: new Date() })
        .where(eq(reports.id, existing[0].id))
        .returning();
      savedReportId = updated.id;
    } else {
      const [inserted] = await db.insert(reports).values({
        companyId: id,
        title: `Relatório Completo de Diagnóstico — ${company.name} (${period})`,
        type: "full_analysis",
        content: report,
      }).returning();
      savedReportId = inserted.id;
    }
  }

  const comparison = await getPreviousScorecard(id, period, settings.thresholds);
  res.json({ reportId: savedReportId, report, comparison });
});

export default router;
