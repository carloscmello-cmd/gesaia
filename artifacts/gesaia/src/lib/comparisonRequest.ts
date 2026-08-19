export type ComparisonRequestState<T> = {
  loading: boolean;
  result: T | null;
  error: string | null;
};

export type ComparisonRequestParams = {
  companyId: number;
  periodBase: string;
  periodComp: string;
};

type StateListener<T> = (state: ComparisonRequestState<T>) => void;
type FetchLike = typeof fetch;

const initialState = <T>(): ComparisonRequestState<T> => ({
  loading: true,
  result: null,
  error: null,
});

/**
 * Owns the cancellation and response-ownership rules for period comparisons.
 *
 * A company navigation calls reset(), which aborts the old request and emits
 * an idle state. A response is only allowed to update the page while its
 * request is still the active request.
 */
export function createComparisonRequestManager<T>(
  fetchFn: FetchLike = fetch,
) {
  let activeRequest: AbortController | null = null;

  const cancel = () => {
    activeRequest?.abort();
    activeRequest = null;
  };

  const reset = (onStateChange: StateListener<T>) => {
    cancel();
    onStateChange({
      loading: false,
      result: null,
      error: null,
    });
  };

  const start = (
    params: ComparisonRequestParams,
    onStateChange: StateListener<T>,
  ) => {
    cancel();

    const controller = new AbortController();
    activeRequest = controller;
    onStateChange(initialState<T>());

    fetchFn(`/api/companies/${params.companyId}/compare-periods`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        periodBase: params.periodBase,
        periodComp: params.periodComp,
      }),
      signal: controller.signal,
    })
      .then((response) =>
        response.ok
          ? response.json()
          : response.json().then((body) =>
              Promise.reject(body.error ?? `Erro ${response.status}`),
            ),
      )
      .then((data: T) => {
        if (activeRequest !== controller || controller.signal.aborted) return;
        activeRequest = null;
        onStateChange({
          loading: false,
          result: data,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        if (activeRequest !== controller || controller.signal.aborted) return;
        activeRequest = null;
        onStateChange({
          loading: false,
          result: null,
          error: String(error),
        });
      });

    return () => {
      if (activeRequest === controller) {
        controller.abort();
        activeRequest = null;
      }
    };
  };

  return { start, reset, cancel };
}