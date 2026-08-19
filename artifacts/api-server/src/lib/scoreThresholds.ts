export interface ScoreThresholds {
  greenMin: number;
  yellowMin: number;
}

export type ScorePriority = "high" | "medium" | "low";

export const DEFAULT_SCORE_THRESHOLDS: ScoreThresholds = {
  greenMin: 70,
  yellowMin: 40,
};

export function isScoreThresholds(value: unknown): value is ScoreThresholds {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const { greenMin, yellowMin } = value as Record<string, unknown>;
  return (
    typeof greenMin === "number" &&
    typeof yellowMin === "number" &&
    Number.isFinite(greenMin) &&
    Number.isFinite(yellowMin) &&
    yellowMin >= 0 &&
    greenMin <= 100 &&
    yellowMin < greenMin
  );
}

export function resolveScoreThresholds(thresholds?: unknown): ScoreThresholds {
  return isScoreThresholds(thresholds) ? thresholds : DEFAULT_SCORE_THRESHOLDS;
}

export function scorePriority(score: unknown, thresholds?: unknown): ScorePriority | null {
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  const { greenMin, yellowMin } = resolveScoreThresholds(thresholds);
  if (score >= greenMin) return "low";
  if (score >= yellowMin) return "medium";
  return "high";
}

type PriorityFinding = object;

export function applyFindingPriorities<T extends object>(
  findings: T[],
  thresholds?: unknown,
  getScore: (finding: T) => unknown = (finding) => {
    const metrics = (finding as { metrics?: unknown }).metrics;
    return typeof metrics === "object" && metrics !== null
      ? (metrics as Record<string, unknown>).score
      : undefined;
  },
): T[] {
  return findings.map((finding) => {
    const impact = scorePriority(getScore(finding), thresholds);
    return impact ? { ...finding, impact } : finding;
  });
}

export function buildPriorityBluf(findings: PriorityFinding[]): string {
  if (findings.length === 0) return "";
  const valueOf = (finding: PriorityFinding) => finding as {
    title?: unknown;
    impact?: unknown;
  };
  const high = findings.filter((finding) => valueOf(finding).impact === "high");
  const medium = findings.filter((finding) => valueOf(finding).impact === "medium");
  if (high.length === 0 && medium.length === 0) {
    return "Todos os indicadores analisados estão dentro de faixas aceitáveis. Mantenha o monitoramento contínuo dos KPIs financeiros e operacionais.";
  }
  if (high.length === 0) {
    return `Atenção necessária em: ${medium.map((finding) => String(valueOf(finding).title ?? "")).join(", ")}. Recomenda-se revisão dos indicadores e definição de plano de ação.`;
  }
  return `Ação imediata requerida em: ${high.map((finding) => String(valueOf(finding).title ?? "")).join(", ")}. ${medium.length > 0 ? `Atenção também para: ${medium.map((finding) => String(valueOf(finding).title ?? "")).join(", ")}.` : ""}`;
}