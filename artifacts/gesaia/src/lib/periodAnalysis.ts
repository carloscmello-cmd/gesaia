export type PeriodAnalysisStatus = {
  period: string;
  latestFullAnalysisAt: string | null;
};

export function hasCompletedFullAnalysisForPeriod(
  periods: PeriodAnalysisStatus[],
  period: string,
): boolean {
  return Boolean(
    periods.find((candidate) => candidate.period === period)?.latestFullAnalysisAt,
  );
}