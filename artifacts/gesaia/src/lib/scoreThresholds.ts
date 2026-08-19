export interface ScoreThresholds {
  greenMin: number;
  yellowMin: number;
}

const DEFAULT_SCORE_THRESHOLDS: ScoreThresholds = {
  greenMin: 70,
  yellowMin: 40,
};

export function resolveScoreThresholds(thresholds?: ScoreThresholds | null): ScoreThresholds {
  if (
    thresholds &&
    Number.isFinite(thresholds.greenMin) &&
    Number.isFinite(thresholds.yellowMin) &&
    thresholds.yellowMin >= 0 &&
    thresholds.greenMin <= 100 &&
    thresholds.yellowMin < thresholds.greenMin
  ) {
    return thresholds;
  }
  return DEFAULT_SCORE_THRESHOLDS;
}

export function scoreRingColor(score: number, thresholds?: ScoreThresholds | null): string {
  const { greenMin, yellowMin } = resolveScoreThresholds(thresholds);
  if (score >= greenMin) return "#10b981";
  if (score >= yellowMin) return "#f59e0b";
  return "#ef4444";
}