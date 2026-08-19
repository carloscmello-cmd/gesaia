/**
 * Pure request-identity helpers for AnalysisPanel spot-checks.
 *
 * Spot-check responses are only allowed to update the result that existed
 * when the request started. Keeping these checks outside the React component
 * makes the cancellation and stale-response behavior testable without a DOM.
 */

export interface SpotCheckRequest {
  token: symbol;
  abort: AbortController;
  companyId: number;
  period: string;
  resultIdentity: string;
}

export interface SpotCheckRequestRef {
  current: SpotCheckRequest | null;
}

/** Cancel the active request and make it impossible for it to remain current. */
export function cancelSpotCheckRequest(ref: SpotCheckRequestRef): void {
  ref.current?.abort.abort();
  ref.current = null;
}

/** Check whether a request still owns the active in-flight slot. */
export function ownsSpotCheckRequest(
  activeRequest: SpotCheckRequest | null,
  requestToken: symbol,
): boolean {
  return activeRequest?.token === requestToken;
}

/**
 * Check the response-level guard before merging returned metrics.
 *
 * Both the unique request token and the originating period must still match.
 * The token catches cancellation/replacement; the period catches a server
 * response that does not belong to the request's baseline.
 */
export function shouldApplySpotCheckResponse(
  activeRequest: SpotCheckRequest | null,
  requestToken: symbol,
  responsePeriod: string,
): boolean {
  return ownsSpotCheckRequest(activeRequest, requestToken)
    && activeRequest?.period === responsePeriod;
}

/** Check the final state-setter guard against a changed analysis baseline. */
export function matchesSpotCheckBaseline<
  TResult extends { period: string; executedAt?: string | null },
>(
  currentResult: TResult | null,
  request: Pick<SpotCheckRequest, "period" | "resultIdentity">,
): currentResult is TResult {
  return !!currentResult
    && currentResult.period === request.period
    && (currentResult.executedAt ?? "") === request.resultIdentity;
}