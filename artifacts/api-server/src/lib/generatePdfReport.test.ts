import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildPdfDiagnosticIndicators,
  groupDiagnosticIndicators,
  buildScorecardEngineRows,
  generateFullDiagnosticPdf,
  generatePdfReport,
  normalizePdfScorecard,
  scoreColor,
  scorecardDeltaLabel,
} from "./generatePdfReport.ts";
import { createReportDownloadHandler } from "./reportDownloadHandler.ts";
import {
  applyFindingPriorities,
  buildPriorityBluf,
  resolveScoreThresholds,
} from "./scoreThresholds.ts";

test("uses the configured company score thresholds for scorecard colors", () => {
  const thresholds = resolveScoreThresholds({ greenMin: 60, yellowMin: 30 });

  assert.equal(scoreColor(60, thresholds), "#16a34a");
  assert.equal(scoreColor(59, thresholds), "#ca8a04");
  assert.equal(scoreColor(30, thresholds), "#ca8a04");
  assert.equal(scoreColor(29, thresholds), "#dc2626");
});

test("falls back to the legacy thresholds when no valid company setting exists", () => {
  const thresholds = resolveScoreThresholds(null);

  assert.deepEqual(thresholds, { greenMin: 70, yellowMin: 40 });
  assert.equal(scoreColor(70, thresholds), "#16a34a");
  assert.equal(scoreColor(40, thresholds), "#ca8a04");
  assert.equal(scoreColor(39, thresholds), "#dc2626");
});

test("reclassifies current and historical findings with the active company thresholds", () => {
  const findings = applyFindingPriorities([
    { title: "Financeiro", impact: "medium", metrics: { score: 60 } },
    { title: "Comercial", impact: "low", metrics: { score: 29 } },
  ], { greenMin: 60, yellowMin: 30 });

  assert.deepEqual(findings.map((finding) => finding.impact), ["low", "high"]);
  assert.match(buildPriorityBluf(findings), /Comercial/);
});

test("a regenerated report uses the active policy for both its scorecard and recommendation", () => {
  const report = normalizePdfScorecard({
    companyName: "Empresa",
    blufRecommendation: "Atenção necessária em: Financeiro.",
    scoreThresholds: { greenMin: 60, yellowMin: 30 },
    findings: [{ title: "Financeiro", impact: "medium", summary: "", score: 60 }],
  });

  assert.equal(report.findings[0].impact, "low");
  assert.match(report.blufRecommendation ?? "", /Todos os indicadores/);
});

test("renders the four financial KPIs in a full diagnostic PDF", async () => {
  const pdf = await generateFullDiagnosticPdf({
    companyName: "Empresa Financeira",
    period: "2026-08",
    sector: "geral",
    generatedAt: "19/08/2026",
    financialIndicators: {
      contributionMargin: 75000,
      breakEvenRevenue: 40000,
      safetyMargin: 42.5,
      safetyMarginClass: "Excelente",
      cashCycle: 12,
    },
    scorecard: { indicators: [], engines: [] },
    narrative: null,
  });

  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  assert.ok(pdf.length > 1_000);
});

test("groups full diagnostic indicators by engine and puts missing values last", () => {
  const groups = groupDiagnosticIndicators([
    { engine: "hr", label: "Treinamento", value: null, level: null },
    { key: "ebitdaMargin", label: "Margem EBITDA", value: null, level: null },
    { engine: "financial", label: "Margem de Segurança", value: 42, level: 4 },
    { engine: "hr", label: "Turnover", value: 3, level: 3 },
    { engine: "commercial", label: "Conversão", value: 8, level: 3 },
  ]);

  assert.deepEqual(groups.map((group) => group.label), ["Financeiro", "Comercial", "Pessoas"]);
  assert.deepEqual(groups[0].items.map((item) => item.label), ["Margem de Segurança", "Margem EBITDA"]);
  assert.deepEqual(groups[2].items.map((item) => item.label), ["Turnover", "Treinamento"]);
});

test("renders the five named engine groups in the full diagnostic PDF", async () => {
  const indicators = [
    ["safetyMargin", "Margem de Segurança", "financial"],
    ["ebitdaMargin", "Margem EBITDA", "financial"],
    ["mcPct", "Margem de Contribuição", "financial"],
    ["cashCycle", "Ciclo de Caixa", "financial"],
    ["markupOnCogs", "Markup sobre CMV", "financial"],
    ["churnRate", "Churn mensal", "commercial"],
    ["conversionRate", "Taxa de Conversão", "commercial"],
    ["ltvCacRatio", "LTV:CAC", "commercial"],
    ["nps", "NPS", "marketing"],
    ["defaultRate", "Inadimplência", "marketing"],
    ["roas", "ROAS", "marketing"],
    ["oeeIndex", "OEE", "operations"],
    ["capacityUtilization", "Utilização de Capacidade", "operations"],
    ["turnoverCostRevenuePct", "Custo de Turnover (% rec.)", "hr"],
    ["trainingRoi", "ROI de Treinamento", "hr"],
  ].map(([key, label, engine], index) => ({
    key,
    label,
    engine,
    unit: "%",
    value: index === 1 || index === 13 ? null : index + 1,
    level: index === 1 || index === 13 ? null : 2,
  }));
  const pdf = await generateFullDiagnosticPdf({
    companyName: "Empresa com Scorecard Agrupado",
    period: "2026-08",
    sector: "Serviços",
    generatedAt: "19/08/2026",
    scorecard: { indicators, engines: [{ label: "Financeiro", score: 70, level: 3 }] },
    narrative: null,
  });
  const directory = mkdtempSync(join(tmpdir(), "gesaia-grouped-scorecard-"));
  const pdfPath = join(directory, "scorecard.pdf");
  try {
    writeFileSync(pdfPath, pdf);
    const renderedText = execFileSync("pdftotext", [pdfPath, "-"], { encoding: "utf8" });
    const groupLabels = ["Financeiro", "Comercial", "Marketing", "Operações", "Pessoas"];
    const positions = groupLabels.map((label) => renderedText.indexOf(label));
    assert.ok(positions.every((position) => position >= 0), "all engine group headers must be rendered");
    assert.deepEqual([...positions].sort((a, b) => a - b), positions);
    assert.match(renderedText, /Dados não informados/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the full diagnostic download route renders the complete PDF and its four financial KPI cards", async () => {
  const savedReport = {
    id: 42,
    companyId: 7,
    content: {
      reportKind: "full_diagnostic",
      companyName: "Empresa de Diagnóstico",
      period: "2026-08",
      sector: "Varejo",
      generatedAt: "19/08/2026",
      financialIndicators: {
        contributionMargin: 75_000,
        breakEvenRevenue: 40_000,
        safetyMargin: 42.5,
        safetyMarginClass: "Excelente",
        cashCycle: 12,
      },
      diagnosticIndicators: {
        risks: {
          riskMatrix: [],
          totalExpectedLoss: 0,
          overallExposure: "Baixo",
        },
      },
      scorecard: {
        indicators: [{ label: "Margem EBITDA", value: 18, unit: "%", level: 3 }],
        engines: [{ label: "Financeiro", score: 82, level: 3 }],
      },
       findings: [{
         engine: "financial",
         title: "Financeiro",
         impact: "medium",
         summary: "A margem de contribuição sustenta o crescimento.",
         score: 82,
       }],
      narrative: {
        executiveSummary: "A operação apresenta boa saúde financeira.",
        sections: [{
          title: "Financeiro",
          narrative: "A margem de contribuição sustenta o crescimento.",
          causes: ["Custos variáveis controlados"],
          suggestions: [{ action: "Preservar a disciplina de caixa", expectedImpact: "Maior liquidez" }],
        }],
        nextSteps: "Acompanhar os indicadores mensalmente.",
      },
    },
  };
  const company = {
    id: 7,
    name: "Empresa de Diagnóstico",
    ownerId: 1,
  };
  let fullDiagnosticCalls = 0;
  let standardReportCalls = 0;
  const downloadHandler = createReportDownloadHandler({
    findReport: async () => savedReport,
    findCompany: async () => company,
    computeFinancialIndicators: async () => {
      throw new Error("Saved financial indicators must be used");
    },
    computeDiagnosticIndicators: async () => {
      throw new Error("Saved diagnostic indicators must be used");
    },
    generateFullDiagnosticPdf: async (data) => {
      fullDiagnosticCalls += 1;
      return generateFullDiagnosticPdf(data);
    },
    generatePdfReport: async () => {
      standardReportCalls += 1;
      throw new Error("Full diagnostic downloads must not use generatePdfReport");
    },
  });

  const headers = new Map<string, string | number>();
  let pdfBuffer: Buffer | undefined;
  const response = {
    setHeader(name: string, value: string | number) {
      headers.set(name, value);
    },
    send(body: Buffer) {
      pdfBuffer = body;
    },
  };

  await downloadHandler(
    { params: { id: String(savedReport.id) }, dbUser: { id: 1, role: "consultant" } } as any,
    response as any,
  );

  assert.equal(headers.get("Content-Type"), "application/pdf");
  assert.equal(fullDiagnosticCalls, 1, "full diagnostic reports must use generateFullDiagnosticPdf");
  assert.equal(standardReportCalls, 0, "full diagnostic reports must not use generatePdfReport");
  assert.ok(pdfBuffer, "the route must send the generated PDF");
  assert.equal(pdfBuffer.subarray(0, 4).toString(), "%PDF");
  assert.ok(pdfBuffer.length > 1_000, "the full diagnostic PDF must contain rendered content");

  const directory = mkdtempSync(join(tmpdir(), "gesaia-full-diagnostic-download-"));
  const pdfPath = join(directory, "diagnostic.pdf");
  try {
    writeFileSync(pdfPath, pdfBuffer);
    const renderedText = execFileSync("pdftotext", [pdfPath, "-"], { encoding: "utf8" });

    assert.match(renderedText, /RELATÓRIO COMPLETO DE DIAGNÓSTICO/);
    assert.match(renderedText, /RESUMO EXECUTIVO/);
    assert.match(renderedText, /Margem de Contribuição/);
    assert.match(renderedText, /Ponto de Equilíbrio/);
    assert.match(renderedText, /Margem de Segurança/);
    assert.match(renderedText, /Ciclo de Caixa/);
    assert.match(renderedText, /Análise detalhada/);
    assert.match(renderedText, /PRÓXIMOS PASSOS/);
    assert.match(renderedText, /Scorecard/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the legacy analysis download route uses the standard PDF renderer and returns PDF headers", async () => {
  const savedReport = {
    id: 43,
    companyId: 8,
    content: {
      companyName: "Empresa Legada",
      segment: "Varejo",
      activity: "Comércio",
      businessModel: "B2C",
      period: "2026-07",
      generatedAt: "19/07/2026",
      kpis: [{ label: "Receita", value: "R$ 75.000" }],
      alerts: [],
      findings: [],
      previousFindings: [],
      blufRecommendation: "Manter o acompanhamento mensal.",
      financialIndicators: null,
    },
  };
  const company = {
    name: "Empresa Legada",
    ownerId: 1,
  };
  const generatedPdf = Buffer.from("%PDF-legacy-analysis");
  let fullDiagnosticCalls = 0;
  let standardReportCalls = 0;

  const downloadHandler = createReportDownloadHandler({
    findReport: async () => savedReport,
    findCompany: async () => company,
    computeFinancialIndicators: async () => null,
    computeDiagnosticIndicators: async () => null,
    generateFullDiagnosticPdf: async () => {
      fullDiagnosticCalls += 1;
      throw new Error("Legacy analysis downloads must not use generateFullDiagnosticPdf");
    },
    generatePdfReport: async () => {
      standardReportCalls += 1;
      return generatedPdf;
    },
  });

  const headers = new Map<string, string | number>();
  let pdfBuffer: Buffer | undefined;
  const response = {
    setHeader(name: string, value: string | number) {
      headers.set(name, value);
    },
    send(body: Buffer) {
      pdfBuffer = body;
    },
  };

  await downloadHandler(
    { params: { id: String(savedReport.id) }, dbUser: { id: 1, role: "consultant" } } as any,
    response as any,
  );

  assert.equal(standardReportCalls, 1, "legacy analysis reports must use generatePdfReport");
  assert.equal(fullDiagnosticCalls, 0, "legacy analysis reports must not use generateFullDiagnosticPdf");
  assert.equal(pdfBuffer, generatedPdf, "the generated PDF must be sent in the response");
  assert.equal(headers.get("Content-Type"), "application/pdf");
  assert.equal(
    headers.get("Content-Disposition"),
    'attachment; filename="GESAIA_Empresa_Legada_2026-07.pdf"',
  );
  assert.equal(headers.get("Content-Length"), generatedPdf.length);
});

test("keeps every long risk-matrix row and its columns together across PDF page breaks", async () => {
  const risks = Array.from({ length: 18 }, (_, index) => {
    const id = String(index + 1).padStart(2, "0");
    return {
      name: `RISK-${id} Um risco operacional com descrição longa para confirmar que a linha inteira permanece legível quando a matriz atravessa uma quebra de página no relatório`,
      probability: 12.5 + index,
      probabilityLabel: `P-${id}`,
      impact: 12_000 + index * 1_000,
      impactLabel: `I-${id}`,
      expectedLoss: 1_500 + index * 100,
      matrixZone: `E-${id}`,
    };
  });
  const pdf = await generateFullDiagnosticPdf({
    companyName: "Empresa com Matriz Extensa",
    period: "2026-08",
    sector: "geral",
    generatedAt: "19/08/2026",
    diagnosticIndicators: {
      risks: {
        riskMatrix: risks,
        totalExpectedLoss: risks.reduce((total, risk) => total + risk.expectedLoss, 0),
        overallExposure: "Alto",
      },
    },
    scorecard: { indicators: [], engines: [] },
    narrative: null,
  });
  const directory = mkdtempSync(join(tmpdir(), "gesaia-risk-matrix-"));
  const pdfPath = join(directory, "risk-matrix.pdf");

  try {
    writeFileSync(pdfPath, pdf);
    const pages = Number(execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" })
      .match(/^Pages:\s+(\d+)/m)?.[1]);
    const extractedPages = execFileSync("pdftotext", ["-layout", pdfPath, "-"], { encoding: "utf8" })
      .split("\f")
      .filter((page) => page.trim().length > 0);

    assert.ok(pages >= 2, "the test matrix must span multiple pages");
    assert.equal(extractedPages.length, pages);
    assert.match(extractedPages.join("\n"), /Risco/);
    assert.match(extractedPages.join("\n"), /Probabilidade/);
    assert.match(extractedPages.join("\n"), /Impacto/);
    assert.match(extractedPages.join("\n"), /Perda esperada/);
    assert.match(extractedPages.join("\n"), /Exposição/);
    for (const page of extractedPages) {
      assert.match(page, /Risco/);
      assert.match(page, /Probabilidade/);
      assert.match(page, /Impacto/);
      assert.match(page, /Perda esperada/);
      assert.match(page, /Exposição/);
    }

    for (const risk of risks) {
      const id = risk.name.match(/RISK-\d+/)?.[0];
      const rowPage = extractedPages.find((page) => page.includes(id ?? ""));
      assert.ok(rowPage, `risk ${id} must be present in the extracted PDF`);
      assert.match(rowPage, new RegExp(risk.probabilityLabel));
      assert.match(rowPage, new RegExp(risk.impactLabel));
      assert.match(rowPage, new RegExp(risk.matrixZone));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps every long narrative section and recommendation across PDF page breaks", async () => {
  const narrativeParagraph = [
    "A operação apresenta sinais consistentes de evolução, mas a equipe precisa transformar os dados disponíveis em uma rotina de decisão mais disciplinada.",
    "Os resultados devem ser acompanhados em conjunto, porque uma melhoria isolada pode esconder um gargalo em outra etapa da jornada.",
    "A análise mensal deve registrar as hipóteses adotadas, os responsáveis por cada ação e a evidência usada para confirmar ou revisar a decisão.",
    "Esse acompanhamento contínuo reduz decisões reativas e cria uma base comparável para os próximos ciclos de planejamento.",
  ].join(" ");
  const sections = [
    {
      title: "Diagnóstico financeiro de longo prazo",
      completionMarker: "Marcador final financeiro: a previsão de caixa deve orientar as decisões de investimento.",
      narrative: `${narrativeParagraph} ${narrativeParagraph} ${narrativeParagraph} Marcador final financeiro: a previsão de caixa deve orientar as decisões de investimento.`,
      causes: [
        "Oscilações de caixa ainda não são acompanhadas por uma previsão semanal consolidada.",
        "As despesas variáveis precisam ser relacionadas ao volume de vendas antes de cada revisão.",
      ],
      suggestions: [{
        action: "Implantar uma reunião semanal de fluxo de caixa com responsáveis e prazos registrados",
        expectedImpact: "Maior previsibilidade para financiar o crescimento sem comprometer a liquidez",
      }],
    },
    {
      title: "Diagnóstico comercial de longo prazo",
      completionMarker: "Marcador final comercial: a qualidade do funil deve ser revisada por canal.",
      narrative: `${narrativeParagraph} ${narrativeParagraph} ${narrativeParagraph} Marcador final comercial: a qualidade do funil deve ser revisada por canal.`,
      causes: [
        "O funil comercial ainda concentra oportunidades sem uma priorização uniforme entre os vendedores.",
        "A conversão por canal precisa ser comparada com o custo de aquisição em cada período.",
      ],
      suggestions: [{
        action: "Revisar semanalmente o funil por canal e priorizar oportunidades com maior probabilidade de fechamento",
        expectedImpact: "Aumento da conversão com melhor uso do esforço da equipe comercial",
      }],
    },
    {
      title: "Diagnóstico operacional de longo prazo",
      completionMarker: "Marcador final operacional: os gargalos devem ser tratados antes da próxima demanda.",
      narrative: `${narrativeParagraph} ${narrativeParagraph} ${narrativeParagraph} Marcador final operacional: os gargalos devem ser tratados antes da próxima demanda.`,
      causes: [
        "A capacidade dos pontos críticos varia durante o mês e nem sempre é refletida no plano de produção.",
        "As causas de retrabalho são registradas de forma diferente por cada área.",
      ],
      suggestions: [{
        action: "Padronizar o registro de gargalos e revisar a capacidade antes de aceitar novas demandas",
        expectedImpact: "Menos retrabalho e maior cumprimento dos prazos acordados com clientes",
      }],
    },
    {
      title: "Diagnóstico de pessoas de longo prazo",
      completionMarker: "Marcador final de pessoas: cada aprendizado precisa ter um responsável pela aplicação.",
      narrative: `${narrativeParagraph} ${narrativeParagraph} ${narrativeParagraph} Marcador final de pessoas: cada aprendizado precisa ter um responsável pela aplicação.`,
      causes: [
        "A distribuição de responsabilidades não está documentada para todas as atividades essenciais.",
        "Os investimentos em treinamento ainda não têm uma métrica de aplicação acompanhada pelos gestores.",
      ],
      suggestions: [{
        action: "Definir responsáveis e indicadores de aplicação para cada trilha de desenvolvimento",
        expectedImpact: "Maior retenção de conhecimento e execução mais consistente dos processos",
      }],
    },
  ];
  const pdf = await generateFullDiagnosticPdf({
    companyName: "Empresa com Narrativas Extensas",
    period: "2026-08",
    sector: "Serviços",
    generatedAt: "19/08/2026",
    scorecard: { indicators: [], engines: [] },
    narrative: {
      executiveSummary: "Resumo executivo para uma empresa que precisa manter a qualidade das decisões enquanto as narrativas detalhadas ocupam várias páginas.",
      sections,
      nextSteps: "Revisar os responsáveis e os indicadores no próximo ciclo de acompanhamento.",
    },
  });
  const directory = mkdtempSync(join(tmpdir(), "gesaia-long-narratives-"));
  const pdfPath = join(directory, "long-narratives.pdf");

  try {
    writeFileSync(pdfPath, pdf);
    const pages = Number(execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" })
      .match(/^Pages:\s+(\d+)/m)?.[1]);
    const extractedPages = execFileSync("pdftotext", ["-layout", pdfPath, "-"], { encoding: "utf8" })
      .split("\f")
      .filter((page) => page.trim().length > 0);
    const extractedPageText = extractedPages.map((page) => page.replace(/\s+/g, " "));
    const renderedText = extractedPageText.join("\n");

    assert.ok(pages >= 2, "the long narrative fixture must span multiple pages");
    assert.equal(extractedPages.length, pages);
    for (const page of extractedPageText) {
      assert.match(page, /Empresa com Narrativas Extensas/);
      assert.match(page, /Período: 2026-08/);
    }

    for (const section of sections) {
      assert.match(renderedText, new RegExp(section.title));
      assert.match(renderedText, new RegExp(section.completionMarker));
      for (const cause of section.causes) {
        assert.match(renderedText, new RegExp(cause));
      }
      for (const suggestion of section.suggestions) {
        assert.match(renderedText, new RegExp(suggestion.action));
        assert.match(renderedText, new RegExp(suggestion.expectedImpact));
      }
    }

    const narrativePageIndexes = sections.map((section) =>
      extractedPageText.findIndex((page) => page.includes(section.title)),
    );
    assert.ok(
      narrativePageIndexes.some((pageIndex) => pageIndex > 0),
      "at least one narrative section must continue onto a later PDF page",
    );
    const recommendationPageIndexes = sections.flatMap((section) =>
      section.suggestions.map((suggestion) =>
        extractedPageText.findIndex((page) => page.includes(suggestion.action)),
      ),
    );
    assert.ok(
      recommendationPageIndexes.some((pageIndex) => pageIndex > 0),
      "at least one narrative recommendation must be readable on a later PDF page",
    );
    assert.match(renderedText, /PRÓXIMOS PASSOS/);
    assert.match(renderedText, /Revisar os responsáveis e os indicadores/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("normalizes the detailed commercial, marketing, operations, HR, and risk engine results for the PDF", () => {
  const indicators = buildPdfDiagnosticIndicators({
    commercial: {
      cac: 600,
      estimatedLTV: 2400,
      ltvCacRatio: 4,
      ltvCacClassification: "Saudável",
    },
    marketing: {
      ctr: 3.25,
      ctrClassification: "Bom",
      cpl: 85,
      roas: 2.5,
      roasClassification: "Bom",
      roiMarketing: 150,
      roiClassification: "Bom",
    },
    operations: {
      oeeIndex: 78,
      oeeClassification: "Bom",
      capacitySlack: 22,
      bottleneckStage: "Expedição",
    },
    hr: {
      turnoverCostTotal: 18000,
      trainingRoi: 1.8,
      trainingRoiClassification: "Bom",
      trainingPaybackMonths: 7,
    },
    risks: {
      totalExpectedLoss: 12000,
      overallExposure: "Alto",
      riskMatrix: [{
        name: "Fornecedor crítico",
        probability: 60,
        probabilityLabel: "Alta",
        impact: 50000,
        impactLabel: "Alto",
        expectedLoss: 30000,
        matrixZone: "Alto",
      }],
    },
  });

  assert.deepEqual(indicators.commercial, {
    cac: 600,
    ltv: 2400,
    ltvCacRatio: 4,
    ltvCacClassification: "Saudável",
  });
  assert.equal(indicators.marketing?.ctrClassification, "Bom");
  assert.equal(indicators.operations?.bottleneckStage, "Expedição");
  assert.equal(indicators.hr?.trainingPaybackMonths, 7);
  assert.deepEqual(indicators.risks, {
    totalExpectedLoss: 12000,
    overallExposure: "Alto",
    riskMatrix: [{
      name: "Fornecedor crítico",
      probability: 60,
      probabilityLabel: "Alta",
      impact: 50000,
      impactLabel: "Alto",
      expectedLoss: 30000,
      matrixZone: "Alto",
    }],
  });
});

test("scorecardDeltaLabel returns the correct variation indicator for each case", () => {
  // improved
  assert.equal(scorecardDeltaLabel(80, 65), "▲ +15");
  // worsened
  assert.equal(scorecardDeltaLabel(50, 70), "▼ -20");
  // stable (exactly equal)
  assert.equal(scorecardDeltaLabel(60, 60), "— 0");
  // rounds fractional delta correctly
  assert.equal(scorecardDeltaLabel(70.7, 60.2), "▲ +11");
});

test("scorecardDeltaLabel returns null when either score is absent", () => {
  // no previous data → no variation indicator
  assert.equal(scorecardDeltaLabel(75, null), null);
  assert.equal(scorecardDeltaLabel(75, undefined), null);
  // no current score → no variation indicator
  assert.equal(scorecardDeltaLabel(null, 60), null);
  assert.equal(scorecardDeltaLabel(undefined, 60), null);
  // both absent
  assert.equal(scorecardDeltaLabel(null, null), null);
});

test("scorecard rows include correct variation indicators for improved, worsened and stable engines", () => {
  const rows = buildScorecardEngineRows({
    companyName: "Empresa Teste",
    segment: "Varejo",
    activity: "B2C",
    businessModel: "Produto",
    generatedAt: "19/08/2026",
    findings: [
      { engine: "financeiro",  title: "Financeiro",  impact: "low",    summary: "Bom resultado", score: 80 },
      { engine: "comercial",   title: "Comercial",   impact: "medium", summary: "Queda notada",  score: 50 },
      { engine: "operacional", title: "Operacional", impact: "low",    summary: "Estável",        score: 65 },
    ],
    previousFindings: [
      { engine: "financeiro",  title: "Financeiro",  impact: "medium", summary: "", score: 65 }, // improved: +15
      { engine: "comercial",   title: "Comercial",   impact: "low",    summary: "", score: 70 }, // worsened: -20
      { engine: "operacional", title: "Operacional", impact: "low",    summary: "", score: 65 }, // stable: 0
    ],
  });

  const byEngine = Object.fromEntries(rows.map((r) => [r.engine, r]));

  assert.equal(byEngine["financeiro"].deltaLabel,  "▲ +15", "improved engine should show upward arrow");
  assert.equal(byEngine["comercial"].deltaLabel,   "▼ -20", "worsened engine should show downward arrow");
  assert.equal(byEngine["operacional"].deltaLabel, "— 0",   "stable engine should show dash");
});

test("scorecard rows omit variation indicators when previousFindings is absent", () => {
  const rows = buildScorecardEngineRows({
    companyName: "Empresa Sem Histórico",
    segment: "Indústria",
    activity: "B2B",
    businessModel: "Serviço",
    generatedAt: "19/08/2026",
    findings: [
      { engine: "financeiro", title: "Financeiro", impact: "low", summary: "Bom resultado", score: 75 },
      { engine: "comercial",  title: "Comercial",  impact: "low", summary: "Estável",       score: 60 },
    ],
    // no previousFindings → all deltaLabels must be null
  });

  for (const row of rows) {
    assert.equal(row.deltaLabel, null, `engine "${row.engine}" must not show a variation when there is no prior period`);
  }
});

test("scorecard rows omit variation only for engines absent from previousFindings", () => {
  // One engine has history; the other does not — only the one with history gets a label.
  const rows = buildScorecardEngineRows({
    companyName: "Empresa Parcial",
    segment: "Serviços",
    activity: "B2B",
    businessModel: "Assinatura",
    generatedAt: "19/08/2026",
    findings: [
      { engine: "financeiro", title: "Financeiro", impact: "low",    summary: "", score: 72 },
      { engine: "comercial",  title: "Comercial",  impact: "medium", summary: "", score: 48 },
    ],
    previousFindings: [
      // only financeiro has a previous score
      { engine: "financeiro", title: "Financeiro", impact: "low", summary: "", score: 60 },
    ],
  });

  const byEngine = Object.fromEntries(rows.map((r) => [r.engine, r]));
  assert.equal(byEngine["financeiro"].deltaLabel, "▲ +12", "engine with prior score shows variation");
  assert.equal(byEngine["comercial"].deltaLabel,  null,    "engine without prior score shows no variation");
});

test("generated scorecard PDF pairs current and previous findings by engine", async () => {
  const pdf = await generatePdfReport({
    companyName: "Empresa com Histórico",
    segment: "Serviços",
    activity: "B2B",
    businessModel: "Assinatura",
    generatedAt: "19/08/2026",
    findings: [
      {
        engine: "financial",
        title: "Financeiro atual",
        impact: "low",
        summary: "",
        score: 80,
      },
    ],
    previousFindings: [
      {
        // The title changed, but the stable engine key is unchanged.
        engine: "financial",
        title: "Nome anterior",
        impact: "medium",
        summary: "",
        score: 65,
      },
    ],
  });
  const directory = mkdtempSync(join(tmpdir(), "gesaia-scorecard-delta-"));
  const pdfPath = join(directory, "scorecard.pdf");

  try {
    writeFileSync(pdfPath, pdf);
    const renderedText = execFileSync("pdftotext", [pdfPath, "-"], { encoding: "utf8" });
    assert.match(renderedText, /Financeiro atual/);
    // pdftotext may decode the embedded arrow font glyph differently, but the
    // numeric delta proves that the scorecardDeltaLabel path rendered a label.
    assert.match(renderedText, /\+15/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("generated scorecard PDF omits variation when engine names do not match", async () => {
  const pdf = await generatePdfReport({
    companyName: "Empresa sem Correspondência",
    segment: "Serviços",
    activity: "B2B",
    businessModel: "Assinatura",
    generatedAt: "19/08/2026",
    findings: [
      {
        engine: "commercial",
        title: "Comercial",
        impact: "low",
        summary: "",
        score: 80,
      },
    ],
    previousFindings: [
      {
        // Matching title must not create a match when the engine key differs.
        engine: "financial",
        title: "Comercial",
        impact: "medium",
        summary: "",
        score: 65,
      },
    ],
  });
  const directory = mkdtempSync(join(tmpdir(), "gesaia-scorecard-delta-mismatch-"));
  const pdfPath = join(directory, "scorecard.pdf");

  try {
    writeFileSync(pdfPath, pdf);
    const renderedText = execFileSync("pdftotext", [pdfPath, "-"], { encoding: "utf8" });
    assert.match(renderedText, /Comercial/);
    assert.doesNotMatch(renderedText, /\+15|-15|— 0/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
