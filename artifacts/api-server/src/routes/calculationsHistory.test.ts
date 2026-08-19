import assert from "node:assert/strict";
import test from "node:test";
import { buildCalculationHistory, findLatestFullAnalysisRun } from "./calculationHistory.ts";

const ALL_ENGINES = [
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
];

test("partial history restores fresh metrics onto the full analysis that preceded it", () => {
  const history = buildCalculationHistory([
    {
      id: 3,
      companyId: 7,
      period: "2026-03",
      engines: ALL_ENGINES,
      status: "completed",
      createdAt: "2026-03-03T10:00:00.000Z",
      results: {
        findings: [
          { engine: "financial", title: "Financeiro", impact: "low", summary: "Nova análise", metrics: { score: 91 } },
        ],
        blufRecommendation: "Recomendação nova",
      },
    },
    {
      id: 2,
      companyId: 7,
      period: "2026-03",
      engines: ["financial", "commercial"],
      status: "completed",
      createdAt: "2026-03-02T10:00:00.000Z",
      results: {
        runType: "partial",
        engineResults: {
          financial: { score: 82, safetyMargin: 18 },
          commercial: { score: 66, conversionRate: 12 },
        },
      },
    },
    {
      id: 1,
      companyId: 7,
      period: "2026-03",
      engines: ALL_ENGINES,
      status: "completed",
      createdAt: "2026-03-01T10:00:00.000Z",
      results: {
        findings: [
          { engine: "financial", title: "Financeiro", impact: "medium", summary: "Base financeira", metrics: { score: 45 } },
          { engine: "commercial", title: "Comercial", impact: "low", summary: "Base comercial", metrics: { score: 71 } },
        ],
        blufRecommendation: "Recomendação da base",
      },
    },
  ]);

  const partialRun = history.find((run) => run.id === 2);
  const olderFullRun = history.find((run) => run.id === 1);

  assert.equal(partialRun?.isPartial, true);
  assert.equal(partialRun?.blufRecommendation, "Atenção necessária em: Comercial. Recomenda-se revisão dos indicadores e definição de plano de ação.");
  assert.deepEqual(partialRun?.engineLastRunAt, {
    financial: "2026-03-02T10:00:00.000Z",
    commercial: "2026-03-02T10:00:00.000Z",
    marketing: "2026-03-01T10:00:00.000Z",
    operations: "2026-03-01T10:00:00.000Z",
    hr: "2026-03-01T10:00:00.000Z",
    risks: "2026-03-01T10:00:00.000Z",
    innovation: "2026-03-01T10:00:00.000Z",
    market_intelligence: "2026-03-01T10:00:00.000Z",
    network: "2026-03-01T10:00:00.000Z",
    strategy: "2026-03-01T10:00:00.000Z",
  });
  assert.deepEqual(olderFullRun?.engineLastRunAt, {
    financial: "2026-03-01T10:00:00.000Z",
    commercial: "2026-03-01T10:00:00.000Z",
    marketing: "2026-03-01T10:00:00.000Z",
    operations: "2026-03-01T10:00:00.000Z",
    hr: "2026-03-01T10:00:00.000Z",
    risks: "2026-03-01T10:00:00.000Z",
    innovation: "2026-03-01T10:00:00.000Z",
    market_intelligence: "2026-03-01T10:00:00.000Z",
    network: "2026-03-01T10:00:00.000Z",
    strategy: "2026-03-01T10:00:00.000Z",
  });
  assert.deepEqual(partialRun?.findings, [
    { engine: "financial", title: "Financeiro", impact: "low", summary: "Base financeira", metrics: { score: 82, safetyMargin: 18 } },
    { engine: "commercial", title: "Comercial", impact: "medium", summary: "Base comercial", metrics: { score: 66, conversionRate: 12 } },
  ]);
});

test("an all-engine spot-check remains partial when it stores a partial payload", () => {
  const runs = [
    {
      id: 11,
      companyId: 7,
      period: "2026-04",
      engines: ALL_ENGINES,
      status: "completed",
      createdAt: "2026-04-02T10:00:00.000Z",
      results: {
        runType: "partial",
        engineResults: { financial: { score: 88 } },
      },
    },
    {
      id: 10,
      companyId: 7,
      period: "2026-04",
      engines: ALL_ENGINES,
      status: "completed",
      createdAt: "2026-04-01T10:00:00.000Z",
      results: {
        runType: "full",
        findings: [
          { engine: "financial", title: "Financeiro", impact: "medium", summary: "Base", metrics: { score: 44 } },
        ],
        blufRecommendation: "Recomendação da base",
      },
    },
  ];
  const history = buildCalculationHistory(runs);

  const spotCheck = history.find((run) => run.id === 11);

  assert.equal(spotCheck?.isPartial, true);
  assert.deepEqual(spotCheck?.findings[0]?.metrics, { score: 88 });
  assert.equal(findLatestFullAnalysisRun(runs)?.id, 10);
});

test("failed or pending executions never make an engine look freshly analyzed", () => {
  const history = buildCalculationHistory([
    {
      id: 41,
      companyId: 7,
      period: "2026-07",
      engines: ["financial"],
      status: "completed",
      createdAt: "2026-07-01T10:00:00.000Z",
      results: { runType: "partial", engineResults: { financial: { score: 60 } } },
    },
    {
      id: 42,
      companyId: 7,
      period: "2026-07",
      engines: ["commercial"],
      status: "failed",
      createdAt: "2026-07-02T10:00:00.000Z",
      results: null,
    },
  ]);

  const failedRun = history.find((run) => run.id === 42);
  assert.deepEqual(failedRun?.engineLastRunAt, {
    financial: "2026-07-01T10:00:00.000Z",
  });
});

test("partial history never falls back past the immediately preceding empty full analysis", () => {
  const history = buildCalculationHistory([
    {
      id: 22,
      companyId: 7,
      period: "2026-05",
      engines: ["financial"],
      status: "completed",
      createdAt: "2026-05-03T10:00:00.000Z",
      results: { runType: "partial", engineResults: { financial: { score: 88 } } },
    },
    {
      id: 21,
      companyId: 7,
      period: "2026-05",
      engines: ALL_ENGINES,
      status: "completed",
      createdAt: "2026-05-02T10:00:00.000Z",
      results: { runType: "full", findings: [], blufRecommendation: "" },
    },
    {
      id: 20,
      companyId: 7,
      period: "2026-05",
      engines: ALL_ENGINES,
      status: "completed",
      createdAt: "2026-05-01T10:00:00.000Z",
      results: {
        runType: "full",
        findings: [
          { engine: "financial", title: "Financeiro", impact: "medium", summary: "Resultado antigo", metrics: { score: 44 } },
        ],
        blufRecommendation: "Recomendação antiga",
      },
    },
  ]);

  const partialRun = history.find((run) => run.id === 22);

  assert.deepEqual(partialRun?.findings, []);
  assert.equal(partialRun?.blufRecommendation, "");
});

test("successive partial runs preserve earlier refreshed engines in the later snapshot", () => {
  const history = buildCalculationHistory([
    {
      id: 30,
      companyId: 7,
      period: "2026-06",
      engines: ALL_ENGINES,
      status: "completed",
      createdAt: "2026-06-01T10:00:00.000Z",
      results: {
        runType: "full",
        findings: [
          { engine: "financial", title: "Financeiro", impact: "medium", summary: "Base", metrics: { score: 40 } },
          { engine: "commercial", title: "Comercial", impact: "low", summary: "Base", metrics: { score: 50 } },
        ],
        blufRecommendation: "Base",
      },
    },
    {
      id: 31,
      companyId: 7,
      period: "2026-06",
      engines: ["financial"],
      status: "completed",
      createdAt: "2026-06-02T10:00:00.000Z",
      results: { runType: "partial", engineResults: { financial: { score: 82 } } },
    },
    {
      id: 32,
      companyId: 7,
      period: "2026-06",
      engines: ["commercial"],
      status: "completed",
      createdAt: "2026-06-03T10:00:00.000Z",
      results: { runType: "partial", engineResults: { commercial: { score: 66 } } },
    },
  ]);

  const laterPartial = history.find((run) => run.id === 32);

  assert.deepEqual(laterPartial?.findings.map((finding) => finding.metrics), [
    { score: 82 },
    { score: 66 },
  ]);
  assert.deepEqual(laterPartial?.engineLastRunAt, {
    financial: "2026-06-02T10:00:00.000Z",
    commercial: "2026-06-03T10:00:00.000Z",
    marketing: "2026-06-01T10:00:00.000Z",
    operations: "2026-06-01T10:00:00.000Z",
    hr: "2026-06-01T10:00:00.000Z",
    risks: "2026-06-01T10:00:00.000Z",
    innovation: "2026-06-01T10:00:00.000Z",
    market_intelligence: "2026-06-01T10:00:00.000Z",
    network: "2026-06-01T10:00:00.000Z",
    strategy: "2026-06-01T10:00:00.000Z",
  });
});