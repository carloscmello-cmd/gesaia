import assert from "node:assert/strict";
import test from "node:test";

import {
  cancelSpotCheckRequest,
  matchesSpotCheckBaseline,
  shouldApplySpotCheckResponse,
  type SpotCheckRequest,
} from "./spotCheckGuard.ts";

function request(period: string, resultIdentity: string): SpotCheckRequest {
  return {
    token: Symbol("spot-check"),
    abort: new AbortController(),
    companyId: 42,
    period,
    resultIdentity,
  };
}

test("period changes cancel the active request and discard its late response", () => {
  const firstRequest = request("2026-07", "run-july");
  const activeRef = { current: firstRequest };

  // This is the same invalidation performed before changing the displayed
  // period or selecting another history run.
  cancelSpotCheckRequest(activeRef);

  assert.equal(firstRequest.abort.signal.aborted, true);
  assert.equal(activeRef.current, null);
  assert.equal(
    shouldApplySpotCheckResponse(activeRef.current, firstRequest.token, "2026-07"),
    false,
    "a response from the old period must not merge after cancellation",
  );
});

test("a replaced request cannot merge even when it uses the same period", () => {
  const firstRequest = request("2026-07", "run-before");
  const replacementRequest = request("2026-07", "run-after");
  const activeRef = { current: replacementRequest };

  assert.equal(
    shouldApplySpotCheckResponse(activeRef.current, firstRequest.token, "2026-07"),
    false,
    "the old request token must not own the replacement request's response",
  );
  assert.equal(
    shouldApplySpotCheckResponse(activeRef.current, replacementRequest.token, "2026-08"),
    false,
    "a response for another period must not merge into the active request",
  );
});

test("the final merge guard rejects a changed baseline", () => {
  const firstRequest = request("2026-07", "run-before");

  assert.equal(
    matchesSpotCheckBaseline(
      { period: "2026-08", executedAt: "run-after" },
      firstRequest,
    ),
    false,
    "a late response must not merge into the newly displayed period",
  );
  assert.equal(
    matchesSpotCheckBaseline(
      { period: "2026-07", executedAt: "run-before" },
      firstRequest,
    ),
    true,
    "the unchanged originating baseline remains mergeable",
  );
});