type CalculationRunForFreshness = {
  status: string;
  createdAt: Date | string;
  results: unknown;
};

function isFullAnalysisRun(results: unknown): boolean {
  if (typeof results !== "object" || results === null || Array.isArray(results)) {
    return false;
  }

  const record = results as Record<string, unknown>;
  if (record.runType === "full") return true;
  if (record.runType === "partial") return false;

  // Older full analyses were stored before runType existed, with findings.
  return Array.isArray(record.findings);
}

export function latestCompletedFullAnalysisAt(
  runs: CalculationRunForFreshness[],
): Date | string | null {
  return runs
    .filter((run) => run.status === "completed" && isFullAnalysisRun(run.results))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
    ?.createdAt ?? null;
}

export function needsReanalysis(
  dataUpdatedAt: Date | string,
  latestFullAnalysisAt: Date | string | null | undefined,
): boolean {
  if (!latestFullAnalysisAt) return true;

  const dataUpdatedAtMs = new Date(dataUpdatedAt).getTime();
  const latestFullAnalysisAtMs = new Date(latestFullAnalysisAt).getTime();

  return Number.isFinite(dataUpdatedAtMs)
    && Number.isFinite(latestFullAnalysisAtMs)
    && dataUpdatedAtMs > latestFullAnalysisAtMs;
}
