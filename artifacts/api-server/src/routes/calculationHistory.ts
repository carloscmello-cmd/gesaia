export const FULL_ANALYSIS_ENGINE_NAMES = [
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
] as const;

import { applyFindingPriorities, buildPriorityBluf } from "../lib/scoreThresholds.ts";

type HistoryRun = {
  id: number;
  companyId: number;
  period: string;
  engines: string[];
  status: string;
  createdAt: Date | string;
  results: unknown;
};

type HistoryFinding = {
  engine?: unknown;
  metrics?: unknown;
  [key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function analysisPayload(results: unknown): { findings: HistoryFinding[]; blufRecommendation: string } {
  if (!isRecord(results)) return { findings: [], blufRecommendation: "" };

  return {
    findings: Array.isArray(results.findings) ? results.findings as HistoryFinding[] : [],
    blufRecommendation: typeof results.blufRecommendation === "string" ? results.blufRecommendation : "",
  };
}

function isFullAnalysisPayload(results: unknown): boolean {
  return isRecord(results) && Array.isArray(results.findings);
}

function runKind(results: unknown): "full" | "partial" {
  if (isRecord(results) && results.runType === "full") return "full";
  if (isRecord(results) && results.runType === "partial") return "partial";

  // Existing runs predate the explicit discriminator: full analyses save
  // findings, while selective runs save raw engine metrics.
  return isFullAnalysisPayload(results) ? "full" : "partial";
}

function isFullAnalysisRun(results: unknown): boolean {
  return runKind(results) === "full";
}

function partialEngineResults(results: unknown): unknown {
  if (isRecord(results) && isRecord(results.engineResults)) {
    return results.engineResults;
  }

  // Existing selective runs stored engine metrics directly in results.
  return results;
}

function mergePartialMetrics(
  findings: HistoryFinding[],
  engineResults: unknown,
): HistoryFinding[] {
  if (!isRecord(engineResults)) return findings;

  return findings.map((finding) => {
    const engine = typeof finding.engine === "string" ? finding.engine : null;
    if (!engine || !Object.hasOwn(engineResults, engine)) return finding;

    return { ...finding, metrics: engineResults[engine] };
  });
}

function createdAtMs(run: HistoryRun): number {
  return new Date(run.createdAt).getTime();
}

export function findLatestFullAnalysisRun(runs: HistoryRun[]): HistoryRun | undefined {
  return [...runs]
    .sort((a, b) => createdAtMs(b) - createdAtMs(a))
    .find((run) => isFullAnalysisRun(run.results));
}

/**
 * Reconstructs partial spot-checks from the most recent full analysis for the
 * same period that existed when the spot-check ran. A partial run only stores
 * refreshed engine metrics, so pairing it with that baseline lets history
 * restore the complete diagnostic as it looked at that time.
 */
export function buildCalculationHistory(runs: HistoryRun[], scoreThresholds?: unknown) {
  const chronologicalRuns = [...runs].sort((a, b) => createdAtMs(a) - createdAtMs(b));
  const currentByPeriod = new Map<string, { findings: HistoryFinding[]; blufRecommendation: string }>();
  const engineLastRunAtByPeriod = new Map<string, Record<string, string>>();

  const enrichedRuns = chronologicalRuns.map((run) => {
    const isPartial = runKind(run.results) === "partial";
    const rawPayload = analysisPayload(run.results);
    const payload = {
      findings: applyFindingPriorities(rawPayload.findings, scoreThresholds),
      blufRecommendation: "",
    };
    payload.blufRecommendation = buildPriorityBluf(payload.findings);
    const engineLastRunAt = {
      ...(engineLastRunAtByPeriod.get(run.period) ?? {}),
    };

    if (run.status === "completed") {
      for (const engine of run.engines) {
        engineLastRunAt[engine] = new Date(run.createdAt).toISOString();
      }
      engineLastRunAtByPeriod.set(run.period, engineLastRunAt);
    }

    if (!isPartial) {
      currentByPeriod.set(run.period, payload);
      return {
        id: run.id,
        companyId: run.companyId,
        period: run.period,
        engines: run.engines,
        status: run.status,
        createdAt: run.createdAt,
        isPartial: false,
        engineLastRunAt,
        findings: payload.findings,
        blufRecommendation: payload.blufRecommendation,
      };
    }

    const baselinePayload = currentByPeriod.get(run.period)
      ?? { findings: [], blufRecommendation: "" };
    const mergedFindings = mergePartialMetrics(
      baselinePayload.findings,
      partialEngineResults(run.results),
    );
    const normalizedFindings = applyFindingPriorities(mergedFindings, scoreThresholds);
    const mergedPayload = {
      findings: normalizedFindings,
      blufRecommendation: buildPriorityBluf(normalizedFindings),
    };
    currentByPeriod.set(run.period, mergedPayload);

    return {
      id: run.id,
      companyId: run.companyId,
      period: run.period,
      engines: run.engines,
      status: run.status,
      createdAt: run.createdAt,
      isPartial: true,
      engineLastRunAt,
        findings: normalizedFindings,
      blufRecommendation: mergedPayload.blufRecommendation,
    };
  });

  return enrichedRuns.reverse().slice(0, 50);
}