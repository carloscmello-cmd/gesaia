import assert from "node:assert/strict";
import test from "node:test";

import { getReportSummary } from "./reportSummary.ts";

test("formats a complete report with period, KPIs, findings, and BLUF", () => {
  const result = getReportSummary({
    period: "Agosto 2025",
    kpis: [1, 2, 3],
    findings: [1, 2],
    blufRecommendation: "Reduzir custos variáveis e ampliar margem.",
  });
  assert.equal(
    result,
    "Agosto 2025 · 3 KPIs · 2 achados · Reduzir custos variáveis e ampliar margem.",
  );
});

test("uses singular labels when there is exactly 1 KPI and 1 finding", () => {
  const result = getReportSummary({
    period: "Janeiro 2024",
    kpis: [1],
    findings: [1],
    blufRecommendation: "Atenção ao fluxo de caixa.",
  });
  assert.equal(
    result,
    "Janeiro 2024 · 1 KPI · 1 achado · Atenção ao fluxo de caixa.",
  );
});

test("falls back to 'Período não informado' when period is missing", () => {
  const result = getReportSummary({
    kpis: [1, 2],
    findings: [],
  });
  assert.ok(result.startsWith("Período não informado ·"));
});

test("falls back to 'Período não informado' when period is an empty string", () => {
  const result = getReportSummary({
    period: "   ",
    kpis: [],
    findings: [],
  });
  assert.ok(result.startsWith("Período não informado ·"));
});

test("falls back to 'Período não informado' when period is not a string", () => {
  const result = getReportSummary({
    period: 2025,
    kpis: [],
    findings: [],
  });
  assert.ok(result.startsWith("Período não informado ·"));
});

test("counts 0 KPIs and 0 findings when those fields are missing", () => {
  const result = getReportSummary({ period: "Março 2025" });
  assert.equal(result, "Março 2025 · 0 KPIs · 0 achados");
});

test("counts 0 KPIs and 0 findings when those fields are not arrays", () => {
  const result = getReportSummary({
    period: "Março 2025",
    kpis: "three",
    findings: 5,
  });
  assert.equal(result, "Março 2025 · 0 KPIs · 0 achados");
});

test("omits BLUF segment when blufRecommendation is missing", () => {
  const result = getReportSummary({
    period: "Julho 2025",
    kpis: [1],
    findings: [1, 2],
  });
  assert.equal(result, "Julho 2025 · 1 KPI · 2 achados");
});

test("omits BLUF segment when blufRecommendation is not a string", () => {
  const result = getReportSummary({
    period: "Julho 2025",
    kpis: [],
    findings: [],
    blufRecommendation: { text: "something" },
  });
  assert.equal(result, "Julho 2025 · 0 KPIs · 0 achados");
});

test("truncates long BLUF to 80 characters with ellipsis", () => {
  const longBluf =
    "Esta é uma recomendação muito longa que excede o limite de oitenta caracteres permitido para a prévia.";
  const result = getReportSummary({
    period: "Junho 2025",
    kpis: [],
    findings: [],
    blufRecommendation: longBluf,
  });
  // Segment after last " · " must be ≤ 80 chars (77 visible + ellipsis)
  const blufSegment = result.split(" · ").at(-1)!;
  assert.ok(
    blufSegment.length <= 80,
    `BLUF preview too long: ${blufSegment.length} chars`,
  );
  assert.ok(blufSegment.endsWith("…"), "BLUF preview should end with ellipsis");
});

test("does not truncate BLUF that is exactly 80 characters", () => {
  const exactBluf = "A".repeat(80);
  const result = getReportSummary({
    period: "Maio 2025",
    kpis: [],
    findings: [],
    blufRecommendation: exactBluf,
  });
  const blufSegment = result.split(" · ").at(-1)!;
  assert.equal(blufSegment, exactBluf);
  assert.ok(!blufSegment.endsWith("…"), "80-char BLUF should not be truncated");
});

test("collapses internal whitespace in BLUF before measuring length", () => {
  const spaceyBluf = "Reduzir   custos   fixos   imediatamente.";
  const result = getReportSummary({
    period: "Abril 2025",
    kpis: [],
    findings: [],
    blufRecommendation: spaceyBluf,
  });
  assert.ok(result.includes("Reduzir custos fixos imediatamente."));
});

test("handles a completely empty content object without crashing", () => {
  assert.doesNotThrow(() => getReportSummary({}));
  const result = getReportSummary({});
  assert.equal(result, "Período não informado · 0 KPIs · 0 achados");
});
