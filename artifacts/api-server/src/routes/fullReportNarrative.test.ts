import assert from "node:assert/strict";
import test from "node:test";
import {
  NarrativeJsonParseError,
  extractNarrativeJson,
  parseNarrativeJson,
  generateNarrativeWithRetry,
} from "./fullReportNarrative.ts";

test("extractNarrativeJson keeps an object surrounded by text or Markdown", () => {
  const raw = "Aqui está o relatório:\\n```json\\n{\"executiveSummary\":\"Tudo bem\"}\\n```\\nFim.";

  assert.equal(extractNarrativeJson(raw), "{\"executiveSummary\":\"Tudo bem\"}");
  assert.deepEqual(parseNarrativeJson(raw), { executiveSummary: "Tudo bem" });
});

test("parseNarrativeJson reports an incomplete object as a parse failure", () => {
  assert.throws(
    () => parseNarrativeJson("{\"executiveSummary\":\"resposta truncada\""),
    NarrativeJsonParseError,
  );
});

// ── generateNarrativeWithRetry ────────────────────────────────────────────────

const VALID_NARRATIVE = {
  executiveSummary: "Situação financeira razoável.",
  sections: [],
  nextSteps: "Monitore mensalmente.",
};

test("generateNarrativeWithRetry: returns narrative directly when first AI response is valid JSON", async () => {
  let callCount = 0;
  const result = await generateNarrativeWithRetry(async (_retry) => {
    callCount++;
    return JSON.stringify(VALID_NARRATIVE);
  });

  assert.equal(callCount, 1, "only one AI call when the first response is valid");
  assert.deepEqual(result, VALID_NARRATIVE);
});

test("generateNarrativeWithRetry: retries exactly once when first response is truncated and second is valid", async () => {
  let callCount = 0;
  const retryFlags: boolean[] = [];

  const result = await generateNarrativeWithRetry(async (retry) => {
    callCount++;
    retryFlags.push(retry);
    if (callCount === 1) {
      // Truncated JSON — no closing brace
      return '{"executiveSummary": "resposta truncada sem fechar';
    }
    return JSON.stringify(VALID_NARRATIVE);
  });

  assert.equal(callCount, 2, "exactly two AI calls — original + one retry");
  assert.equal(retryFlags[0], false, "first call uses retry=false");
  assert.equal(retryFlags[1], true, "retry call uses retry=true so the caller can send a different prompt");
  assert.deepEqual(result, VALID_NARRATIVE, "the recovered narrative from the retry is returned");
});

test("generateNarrativeWithRetry: throws NarrativeJsonParseError when both attempts return invalid JSON", async () => {
  let callCount = 0;

  await assert.rejects(
    () =>
      generateNarrativeWithRetry(async (_retry) => {
        callCount++;
        return '{"executiveSummary": "ainda truncado';
      }),
    NarrativeJsonParseError,
  );

  assert.equal(callCount, 2, "exactly two AI calls — no further retries after second failure");
});

test("generateNarrativeWithRetry: non-parse errors are re-thrown immediately without retrying", async () => {
  let callCount = 0;
  const networkError = new Error("Network timeout");

  await assert.rejects(
    () =>
      generateNarrativeWithRetry(async (_retry) => {
        callCount++;
        throw networkError;
      }),
    (err: unknown) => err === networkError,
  );

  assert.equal(callCount, 1, "non-parse errors cause immediate re-throw with no retry");
});
