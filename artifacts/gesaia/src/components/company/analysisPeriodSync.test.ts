import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  derivePeriodOptions,
  deriveEffectivePeriod,
  syncPeriodFromHistoryRun,
} from "./analysisPeriodSync.ts";
import AnalysisPanel from "./AnalysisPanel.tsx";
import { buildDataEntryPayload } from "./dataEntryPayload.ts";
import { hydrateAdditionalData } from "./riskPersistence.ts";
import { findOperationsBottleneck } from "../../../../api-server/src/lib/operationsBottleneck.ts";

// ---------------------------------------------------------------------------
// company change reset
// ---------------------------------------------------------------------------

type DeferredResponse = {
  resolve: (response: Response) => void;
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

function period(periodName: string) {
  return {
    period: periodName,
    hasData: true,
    updatedAt: "2026-08-19T12:00:00.000Z",
    latestFullAnalysisAt: "2026-08-19T12:00:00.000Z",
    needsReanalysis: false,
  };
}

function analysisRun(
  companyId: number,
  periodName: string,
  id: number,
  findings: Array<Record<string, unknown>> = [],
) {
  return {
    id,
    companyId,
    period: periodName,
    engines: findings.map((finding) => finding.engine),
    status: "completed",
    createdAt: "2026-08-19T12:00:00.000Z",
    isPartial: false,
    engineLastRunAt: {},
    findings,
    blufRecommendation: `Recommendation for ${periodName}`,
  };
}

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    url: "http://localhost/",
  });
  const globals = globalThis as Record<string, unknown>;
  const keys = [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Node",
    "Event",
    "MouseEvent",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "IS_REACT_ACT_ENVIRONMENT",
  ];
  const originals = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globals, key)]));
  const setGlobal = (key: string, value: unknown) => {
    Object.defineProperty(globals, key, {
      configurable: true,
      writable: true,
      value,
    });
  };

  setGlobal("window", dom.window);
  setGlobal("document", dom.window.document);
  setGlobal("navigator", dom.window.navigator);
  setGlobal("HTMLElement", dom.window.HTMLElement);
  setGlobal("Node", dom.window.Node);
  setGlobal("Event", dom.window.Event);
  setGlobal("MouseEvent", dom.window.MouseEvent);
  setGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  setGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(callback, 0) as unknown as number);
  setGlobal("cancelAnimationFrame", clearTimeout);
  setGlobal("IS_REACT_ACT_ENVIRONMENT", true);

  return {
    rootElement: dom.window.document.getElementById("root") as HTMLDivElement,
    cleanup: () => {
      for (const key of keys) {
        const original = originals.get(key);
        if (original) Object.defineProperty(globals, key, original);
        else delete globals[key];
      }
      dom.window.close();
    },
  };
}

async function waitFor(assertion: () => void) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await flush();
      });
    }
  }
  throw lastError;
}

function selectValue(rootElement: Element) {
  const selector = rootElement.querySelector("select");
  assert.ok(selector, "AnalysisPanel should render a period selector");
  return (selector as HTMLSelectElement).value;
}

test("company change clears A's period and result while B loads, then shows only B", async () => {
  const { rootElement, cleanup } = installDom();
  const originalFetch = globalThis.fetch;
  const deferredResponses = new Map<string, DeferredResponse>();
  const companyAPeriod = "2026-A";
  const companyBPeriod = "2026-B";
  const companyARun = analysisRun(1, companyAPeriod, 101);
  const companyBRun = analysisRun(2, companyBPeriod, 202);
  const companyBUrls = [
    "/api/companies/2/periods",
    "/api/companies/2/calculations/latest",
    "/api/companies/2/calculations",
  ];

  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url === "/api/companies/1/periods") return Promise.resolve(jsonResponse([period(companyAPeriod)]));
    if (url === "/api/companies/1/calculations/latest") return Promise.resolve(jsonResponse(companyARun));
    if (url === "/api/companies/1/calculations") return Promise.resolve(jsonResponse([companyARun]));
    if (url === `/api/companies/1/data?period=${companyAPeriod}`) return Promise.resolve(jsonResponse([]));
    if (url === `/api/companies/2/data?period=${companyBPeriod}`) return Promise.resolve(jsonResponse([]));

    if (companyBUrls.includes(url)) {
      return new Promise<Response>((resolve) => {
        deferredResponses.set(url, { resolve });
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const renderPanel = (companyId: number, root: Root) =>
    root.render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(AnalysisPanel, { companyId }),
      ),
    );
  const root = createRoot(rootElement);

  try {
    await act(async () => {
      renderPanel(1, root);
      await flush();
    });
    await waitFor(() => {
      assert.equal(selectValue(rootElement), companyAPeriod);
      assert.match(rootElement.textContent ?? "", new RegExp(`Período ${companyAPeriod}`));
    });

    await act(async () => {
      renderPanel(2, root);
      await flush();
    });
    await waitFor(() => {
      assert.equal(deferredResponses.size, companyBUrls.length);
    });

    // The companyId effect must clear local A state even while every B query is pending.
    assert.equal(selectValue(rootElement), "");
    assert.doesNotMatch(rootElement.textContent ?? "", new RegExp(companyAPeriod));
    assert.ok(rootElement.querySelector(".animate-pulse"), "company B should still be loading");

    await act(async () => {
      deferredResponses.get("/api/companies/2/periods")?.resolve(jsonResponse([period(companyBPeriod)]));
      deferredResponses.get("/api/companies/2/calculations/latest")?.resolve(jsonResponse(companyBRun));
      deferredResponses.get("/api/companies/2/calculations")?.resolve(jsonResponse([companyBRun]));
      await flush();
    });
    await waitFor(() => {
      assert.equal(selectValue(rootElement), companyBPeriod);
      assert.match(rootElement.textContent ?? "", new RegExp(`Período ${companyBPeriod}`));
    });
    assert.doesNotMatch(rootElement.textContent ?? "", new RegExp(companyAPeriod));
  } finally {
    await act(async () => {
      root.unmount();
    });
    queryClient.clear();
    globalThis.fetch = originalFetch;
    cleanup();
  }
});

test("saved-period operations analysis displays each custom bottleneck stage name", async () => {
  const { rootElement, cleanup } = installDom();
  const originalFetch = globalThis.fetch;
  const savedPeriods = [
    {
      period: "2026-stage-1",
      additionalData: {
        stageName1: "Prospecção ativa",
        stageName2: "Qualificação B2B",
        stageName3: "Entrega premium",
        stageCap1: 40,
        stageCap2: 80,
        stageCap3: 100,
      },
    },
    {
      period: "2026-stage-2",
      additionalData: {
        stageName1: "Prospecção ativa",
        stageName2: "Qualificação B2B",
        stageName3: "Entrega premium",
        stageCap1: 100,
        stageCap2: 40,
        stageCap3: 80,
      },
    },
    {
      period: "2026-stage-3",
      additionalData: {
        stageName1: "Prospecção ativa",
        stageName2: "Qualificação B2B",
        stageName3: "Entrega premium",
        stageCap1: 80,
        stageCap2: 100,
        stageCap3: 40,
      },
    },
  ] as const;
  const reSavedAdditionalData = new Map<string, Record<string, unknown>>();
  const savedRuns = savedPeriods.map((savedPeriod, index) => {
    // This follows DataEntryPanel's re-save path: it hydrates the stored values
    // into the form, rebuilds the update payload, then calculates the saved data.
    const reSavePayload = buildDataEntryPayload(
      {
        period: savedPeriod.period,
        ...hydrateAdditionalData(savedPeriod.additionalData),
      },
      {
        netIsAuto: false,
        net: 0,
        netProfitIsAuto: false,
        netProfitCalc: 0,
        grossProfit: Number.NaN,
        ebitda: Number.NaN,
      },
      savedPeriod.additionalData,
    );
    assert.ok(reSavePayload, `saved period ${savedPeriod.period} should produce an update payload`);

    const additionalData = reSavePayload.additionalData as Record<string, unknown>;
    reSavedAdditionalData.set(savedPeriod.period, additionalData);
    const bottleneck = findOperationsBottleneck(additionalData);

    return analysisRun(
      1,
      savedPeriod.period,
      301 + index,
      [{
        engine: "operations",
        impact: "medium",
        summary: `Gargalo de ${savedPeriod.period}`,
        metrics: {
          score: 55,
          bottleneckStage: bottleneck.bottleneckStage,
        },
      }],
    );
  });
  const latestRun = savedRuns[2];

  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url === "/api/companies/1/periods") {
      return Promise.resolve(jsonResponse(savedPeriods.map(({ period: periodName }) => period(periodName))));
    }
    if (url === "/api/companies/1/calculations/latest") {
      return Promise.resolve(jsonResponse(latestRun));
    }
    if (url === "/api/companies/1/calculations") {
      return Promise.resolve(jsonResponse(savedRuns));
    }
    const savedPeriod = savedPeriods.find(({ period }) => url === `/api/companies/1/data?period=${period}`);
    if (savedPeriod) {
      return Promise.resolve(jsonResponse([{
        period: savedPeriod.period,
        additionalData: reSavedAdditionalData.get(savedPeriod.period),
        updatedAt: "2026-08-19T12:00:00.000Z",
      }]));
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const root = createRoot(rootElement);

  try {
    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(AnalysisPanel, { companyId: 1 }),
        ),
      );
      await flush();
    });

    await waitFor(() => {
      assert.match(rootElement.textContent ?? "", /Entrega premium/);
      const periodOptions = [...rootElement.querySelectorAll("select option")]
        .map((option) => (option as HTMLOptionElement).value);
      assert.deepEqual(
        periodOptions,
        ["", ...savedPeriods.map(({ period: periodName }) => periodName)],
        "the selector should include every successfully loaded saved period",
      );
    });

    const historyToggle = [...rootElement.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Histórico de análises"));
    assert.ok(historyToggle, "saved analysis history should be available");
    await act(async () => {
      historyToggle.click();
      await flush();
    });

    for (const [index, savedPeriod] of savedPeriods.entries()) {
      const runButton = [...rootElement.querySelectorAll("button")]
        .find((button) => button.textContent?.includes(savedPeriod.period));
      assert.ok(runButton, `saved run for ${savedPeriod.period} should be selectable`);

      await act(async () => {
        runButton.click();
        await flush();
      });

      const stageName = savedPeriod.additionalData[`stageName${index + 1}` as keyof typeof savedPeriod.additionalData];
      await waitFor(() => {
        assert.match(rootElement.textContent ?? "", new RegExp(String(stageName)));
      });
    }
  } finally {
    await act(async () => {
      root.unmount();
    });
    queryClient.clear();
    globalThis.fetch = originalFetch;
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// derivePeriodOptions
// ---------------------------------------------------------------------------

test("derivePeriodOptions returns saved periods when history is empty", () => {
  const options = derivePeriodOptions(
    [{ period: "2025-08" }, { period: "2025-07" }],
    [],
  );
  assert.deepEqual(options, ["2025-08", "2025-07"]);
});

test("derivePeriodOptions includes history-only periods not present in saved rows", () => {
  const options = derivePeriodOptions(
    [{ period: "2025-08" }],
    [{ period: "2025-06" }, { period: "2025-08" }],
  );
  // 2025-08 appears in both — must not be duplicated
  assert.equal(options.filter((p) => p === "2025-08").length, 1);
  // 2025-06 appears only in history — must still be present
  assert.ok(options.includes("2025-06"), "history-only period must be in options");
});

test("derivePeriodOptions preserves insertion order: saved rows first, then extras", () => {
  const options = derivePeriodOptions(
    [{ period: "2025-08" }, { period: "2025-07" }],
    [{ period: "2025-05" }, { period: "2025-08" }],
  );
  assert.deepEqual(options, ["2025-08", "2025-07", "2025-05"]);
});

test("derivePeriodOptions returns empty array when both inputs are empty", () => {
  assert.deepEqual(derivePeriodOptions([], []), []);
});

test("derivePeriodOptions handles history-only list with no saved periods", () => {
  const options = derivePeriodOptions([], [{ period: "2024-12" }, { period: "2024-11" }]);
  assert.deepEqual(options, ["2024-12", "2024-11"]);
});

// ---------------------------------------------------------------------------
// deriveEffectivePeriod
// ---------------------------------------------------------------------------

test("deriveEffectivePeriod returns selectedPeriod when it is set", () => {
  const period = deriveEffectivePeriod(
    "2025-08",
    [{ period: "2025-07" }],
    [{ period: "2025-06" }],
  );
  assert.equal(period, "2025-08");
});

test("deriveEffectivePeriod falls back to first saved period when selectedPeriod is empty", () => {
  const period = deriveEffectivePeriod(
    "",
    [{ period: "2025-07" }, { period: "2025-06" }],
    [],
  );
  assert.equal(period, "2025-07");
});

test("deriveEffectivePeriod falls back to first history period when saved list is empty", () => {
  const period = deriveEffectivePeriod("", [], [{ period: "2025-03" }]);
  assert.equal(period, "2025-03");
});

test("deriveEffectivePeriod returns empty string when all inputs are empty", () => {
  assert.equal(deriveEffectivePeriod("", [], []), "");
});

test("a manual period change is preserved: selectedPeriod beats the first saved period", () => {
  // Simulates the user explicitly picking "2025-06" from the selector.
  const period = deriveEffectivePeriod(
    "2025-06",
    [{ period: "2025-08" }, { period: "2025-07" }, { period: "2025-06" }],
    [],
  );
  assert.equal(period, "2025-06", "user-selected period must not be overridden by defaults");
});

// ---------------------------------------------------------------------------
// syncPeriodFromHistoryRun
// ---------------------------------------------------------------------------

test("syncPeriodFromHistoryRun returns the run's period string", () => {
  const period = syncPeriodFromHistoryRun({ period: "2025-05" });
  assert.equal(period, "2025-05");
});

test("selecting a history run updates the selector to the run's period", () => {
  // Represents: user clicks a historical run for "2025-03" while the selector
  // currently shows "2025-08".  After the selection the selector must reflect
  // the run's period.
  const currentPeriod = "2025-08";
  const selectedRun = { period: "2025-03" };

  const newSelectedPeriod = syncPeriodFromHistoryRun(selectedRun);

  // The effective period after re-render must be the run's period, not the old one.
  const effective = deriveEffectivePeriod(
    newSelectedPeriod,
    [{ period: "2025-08" }],
    [{ period: "2025-03" }, { period: "2025-08" }],
  );
  assert.notEqual(effective, currentPeriod, "period should have changed");
  assert.equal(effective, "2025-03", "period must match the selected history run");
});

test("history-only period stays available after selecting that history run", () => {
  // "2025-02" exists only in history (its data row was deleted).  Selecting the
  // run must not remove it from the options list.
  const run = { period: "2025-02" };
  const newSelectedPeriod = syncPeriodFromHistoryRun(run);

  const options = derivePeriodOptions(
    [{ period: "2025-08" }],
    [{ period: "2025-02" }, { period: "2025-08" }],
  );
  const effective = deriveEffectivePeriod(newSelectedPeriod, [{ period: "2025-08" }], [
    { period: "2025-02" },
    { period: "2025-08" },
  ]);

  assert.ok(
    options.includes("2025-02"),
    "history-only period must remain in options list",
  );
  assert.equal(
    effective,
    "2025-02",
    "effective period must match the history-only run after selection",
  );
});
