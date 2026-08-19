import { INDICATOR_DEFS, type Threshold } from "./fullReportMetrics.ts";

export type ThresholdValidationResult =
  | { thresholds: Record<string, Threshold>; error?: never }
  | { thresholds?: never; error: string };

/**
 * Keeps only known scorecard indicator overrides and rejects malformed or
 * unreachable score bands before they are stored in report_settings.
 */
export function validateReportSettingsThresholds(value: unknown): ThresholdValidationResult {
  const thresholds: Record<string, Threshold> = {};
  if (value === undefined || value === null) return { thresholds };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { error: "Limiares devem ser um objeto." };
  }

  for (const definition of INDICATOR_DEFS) {
    const threshold = (value as Record<string, unknown>)[definition.key];
    if (!threshold) continue;
    if (
      typeof threshold !== "object" ||
      Array.isArray(threshold) ||
      !Array.isArray((threshold as { bounds?: unknown }).bounds) ||
      (threshold as { bounds: unknown[] }).bounds.length !== 4 ||
      (threshold as { bounds: unknown[] }).bounds.some((bound) => typeof bound !== "number" || !Number.isFinite(bound)) ||
      ((threshold as { direction?: unknown }).direction !== "higher" &&
        (threshold as { direction?: unknown }).direction !== "lower")
    ) {
      return { error: `Limiar inválido para ${definition.key}` };
    }

    const { bounds, direction } = threshold as Threshold;
    const [b0, b1, b2, b3] = bounds;
    const monotonic = direction === "higher"
      ? b0 <= b1 && b1 <= b2 && b2 <= b3
      : b0 >= b1 && b1 >= b2 && b2 >= b3;
    if (!monotonic) {
      return {
        error: `Limiares de "${definition.key}" fora de ordem: para indicadores onde ${
          direction === "higher" ? "maior é melhor, as faixas devem ser crescentes" : "menor é melhor, as faixas devem ser decrescentes"
        }.`,
      };
    }

    thresholds[definition.key] = { bounds, direction };
  }

  return { thresholds };
}