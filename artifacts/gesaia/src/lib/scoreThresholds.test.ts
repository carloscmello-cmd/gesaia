import assert from "node:assert/strict";
import test from "node:test";

import { scoreRingColor } from "./scoreThresholds.ts";

test("score rings use the company score thresholds instead of fixed bands", () => {
  const thresholds = { greenMin: 60, yellowMin: 30 };

  assert.equal(scoreRingColor(60, thresholds), "#10b981");
  assert.equal(scoreRingColor(59, thresholds), "#f59e0b");
  assert.equal(scoreRingColor(29, thresholds), "#ef4444");
});