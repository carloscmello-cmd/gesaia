export interface OperationsBottleneck {
  stageCount: number;
  bottleneckStage: string | null;
  bottleneckCapacity: number | null;
  systemThroughput: number | null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isNaN(number) ? null : number;
}

/**
 * Finds the process stage that limits throughput using the saved operations
 * inputs. Keeping this mapping separate makes it safe to reuse wherever a
 * stored period is turned into an analysis result.
 */
export function findOperationsBottleneck(
  additionalData: Record<string, unknown>,
): OperationsBottleneck {
  const stages: Array<{ name: string; capacity: number }> = [];

  for (let index = 1; index <= 5; index += 1) {
    const capacity = toNumber(additionalData[`stageCap${index}`]);
    const stageName = additionalData[`stageName${index}`];
    const name = typeof stageName === "string" && stageName.trim() !== ""
      ? stageName
      : `Etapa ${index}`;

    if (capacity !== null) stages.push({ name, capacity });
  }

  if (stages.length < 2) {
    return {
      stageCount: stages.length,
      bottleneckStage: null,
      bottleneckCapacity: null,
      systemThroughput: null,
    };
  }

  const bottleneck = stages.reduce((current, stage) =>
    current.capacity <= stage.capacity ? current : stage,
  );

  return {
    stageCount: stages.length,
    bottleneckStage: bottleneck.name,
    bottleneckCapacity: bottleneck.capacity,
    systemThroughput: bottleneck.capacity,
  };
}