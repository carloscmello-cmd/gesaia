import assert from "node:assert/strict";
import test from "node:test";

import {
  createComparisonRequestManager,
  type ComparisonRequestState,
} from "./comparisonRequest.ts";

type DeferredResponse = {
  resolve: (response: Response) => void;
  reject: (error: unknown) => void;
  signal: AbortSignal;
};

function deferredFetch(requests: DeferredResponse[]) {
  return (_url: string, init: RequestInit = {}) =>
    new Promise<Response>((resolve, reject) => {
      const request = {
        resolve,
        reject,
        signal: init.signal as AbortSignal,
      };
      requests.push(request);
      request.signal.addEventListener("abort", () => {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

test("reset on company navigation clears loading and ignores the old result", async () => {
  const requests: DeferredResponse[] = [];
  const states: ComparisonRequestState<{ company: string }>[] = [];
  const manager = createComparisonRequestManager<{ company: string }>(
    deferredFetch(requests),
  );

  manager.start(
    { companyId: 101, periodBase: "2025-06", periodComp: "2025-07" },
    (state) => states.push(state),
  );

  assert.equal(requests.length, 1);
  assert.equal(states.at(-1)?.loading, true);

  // This is the companyId effect's reset path while company A's request is
  // still in flight. It must make the new page idle immediately.
  manager.reset((state) => states.push(state));

  assert.equal(requests[0].signal.aborted, true);
  assert.deepEqual(states.at(-1), {
    loading: false,
    result: null,
    error: null,
  });

  // A late response from company A must not repopulate company B's page.
  requests[0].resolve(jsonResponse({ company: "Company A" }));
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(states.at(-1), {
    loading: false,
    result: null,
    error: null,
  });
  assert.equal(
    states.some((state) => state.result?.company === "Company A"),
    false,
  );
});