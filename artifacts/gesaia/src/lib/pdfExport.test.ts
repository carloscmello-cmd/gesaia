import assert from "node:assert/strict";
import test from "node:test";
import { jsPDF } from "jspdf";

import { requestPdfExport } from "./pdfExport.ts";
import {
  drawTrendMetricsPdf,
  ensureTrendMetricsPdfPage,
  getTrendPdfCell,
} from "../components/company/BridgePanel.tsx";

// ---------------------------------------------------------------------------
// Minimal helpers
// ---------------------------------------------------------------------------

function makePayload() {
  return {
    companyId: 42,
    companyName: "Empresa Teste",
    period: "2025-01",
    generatedAt: "01/01/2025 12:00:00",
    kpis: [],
    alerts: [],
    findings: [],
  };
}

function makeBlob() {
  return new Blob(["%PDF-1.4"], { type: "application/pdf" });
}

/**
 * Builds a minimal fetch stub that returns a Response-like object.
 */
function stubFetch(ok: boolean, blob: Blob = makeBlob()) {
  return async (_url: string, _init: RequestInit): Promise<Response> => {
    return {
      ok,
      blob: async () => blob,
      status: ok ? 200 : 500,
    } as unknown as Response;
  };
}

/**
 * Builds a fetch stub that rejects (simulates a network error).
 */
function errorFetch(message: string) {
  return async (_url: string, _init: RequestInit): Promise<Response> => {
    throw new Error(message);
  };
}

// ---------------------------------------------------------------------------
// Success path: query invalidation IS triggered
// ---------------------------------------------------------------------------

test("calls onSuccess after a successful PDF export", async () => {
  let callCount = 0;
  const onSuccess = () => { callCount += 1; };

  await requestPdfExport(makePayload(), onSuccess, stubFetch(true));

  assert.equal(callCount, 1, "onSuccess must be called exactly once on success");
});

test("returns the PDF blob on success", async () => {
  const expectedBlob = makeBlob();
  const blob = await requestPdfExport(makePayload(), () => {}, stubFetch(true, expectedBlob));

  assert.equal(blob, expectedBlob, "resolved value must be the blob from the response");
});

test("sends POST to /api/reports/pdf with the correct payload", async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;

  const capturingFetch = async (url: string, init: RequestInit): Promise<Response> => {
    capturedUrl = url;
    capturedInit = init;
    return { ok: true, blob: async () => makeBlob(), status: 200 } as unknown as Response;
  };

  const payload = makePayload();
  await requestPdfExport(payload, () => {}, capturingFetch);

  assert.equal(capturedUrl, "/api/reports/pdf");
  assert.equal(capturedInit?.method, "POST");
  assert.ok(
    capturedInit?.headers instanceof Object &&
      (capturedInit.headers as Record<string, string>)["Content-Type"] === "application/json",
    "Content-Type must be application/json",
  );
  assert.match(
    String((capturedInit?.headers as Record<string, string>)["Idempotency-Key"]),
    /.+/,
    "every export attempt must carry an idempotency key",
  );

  const body = JSON.parse(capturedInit?.body as string);
  assert.equal(body.companyId, payload.companyId);
  assert.equal(body.companyName, payload.companyName);
});

test("reuses a request key after a lost response, then starts a new export after success", async () => {
  const requestIds: string[] = [];
  const payload = {
    ...makePayload(),
    companyId: 704,
    period: "2026-08",
  };
  let calls = 0;
  const lostResponseThenSuccess = async (_url: string, init: RequestInit): Promise<Response> => {
    requestIds.push((init.headers as Record<string, string>)["Idempotency-Key"]);
    calls += 1;
    if (calls === 1) throw new Error("connection dropped after the report was saved");
    return { ok: true, blob: async () => makeBlob(), status: 200 } as unknown as Response;
  };

  await assert.rejects(
    () => requestPdfExport(payload, () => {}, lostResponseThenSuccess),
    /connection dropped/,
  );
  await requestPdfExport(payload, () => {}, lostResponseThenSuccess);
  await requestPdfExport(payload, () => {}, lostResponseThenSuccess);

  assert.equal(
    requestIds[0],
    requestIds[1],
    "the retry must identify the same server-side report",
  );
  assert.notEqual(
    requestIds[1],
    requestIds[2],
    "a later export after success must create a distinct report",
  );
});

// ---------------------------------------------------------------------------
// Browser PDF: financial trend table
// ---------------------------------------------------------------------------

test("keeps every selected period's financial values and safety labels in the Evolução PDF", () => {
  const doc = new jsPDF({ compress: false });
  const periods = [
    {
      period: "2025-01",
      metrics: {
        safetyMargin: { value: 8.5 },
        cashCycle: { value: 18 },
      },
    },
    {
      period: "2025-02",
      metrics: {
        safetyMargin: { value: 27.2 },
        cashCycle: { value: 31 },
      },
    },
    {
      period: "2025-03",
      metrics: {
        safetyMargin: { value: null },
        cashCycle: { value: null },
      },
    },
  ];

  drawTrendMetricsPdf(doc, periods, { startY: 20 });

  // jsPDF uses WinAnsi in its content stream, so the unavailable em dash is
  // encoded as 0x97 rather than the JavaScript Unicode character.
  const pdfText = doc.output();
  for (const expectedText of [
    "2025-01",
    "2025-02",
    "2025-03",
    "Margem de Segurança",
    "Ciclo de Caixa",
    "8.5%",
    "18 dias",
    "Ruim",
    "27.2%",
    "31 dias",
    "Bom",
  ]) {
    assert.ok(
      pdfText.includes(expectedText),
      `Expected generated PDF to include ${expectedText}`,
    );
  }
  assert.ok(
    pdfText.includes(String.fromCharCode(0x97)),
    "Expected missing values to render as unavailable in the generated PDF",
  );

  const missingSafetyMargin = getTrendPdfCell("safetyMargin", { value: null });
  assert.deepEqual(
    missingSafetyMargin,
    { value: "—", safetyClass: null },
    "Missing safety margins must not receive a health classification",
  );
});

test("splits long financial-trend ranges into readable period groups", () => {
  const doc = new jsPDF({ compress: false });
  const periods = Array.from({ length: 10 }, (_, index) => ({
    period: `2025-${String(index + 1).padStart(2, "0")}`,
    metrics: {
      safetyMargin: { value: index % 2 === 0 ? 8.5 : 27.2 },
      cashCycle: { value: 18 + index },
    },
  }));

  drawTrendMetricsPdf(doc, periods, { startY: 20 });

  assert.ok(
    doc.getNumberOfPages() > 1,
    "Long ranges must continue on additional pages instead of shrinking columns",
  );
  const pdfText = doc.output();
  for (const snapshot of periods) {
    assert.ok(
      pdfText.includes(snapshot.period),
      `Expected long-range PDF to keep selected period ${snapshot.period}`,
    );
  }
  for (const expectedText of ["8.5%", "27.2%", "Ruim", "Bom", "18 dias", "27 dias"]) {
    assert.ok(
      pdfText.includes(expectedText),
      `Expected long-range PDF to keep financial value or health label ${expectedText}`,
    );
  }
});

test("moves the complete financial-trend table to a new page when the narrative ends near the footer", () => {
  const doc = new jsPDF({ compress: false });
  const periods = [
    {
      period: "2025-01",
      metrics: {
        safetyMargin: { value: 8.5 },
        cashCycle: { value: 18 },
      },
    },
    {
      period: "2025-02",
      metrics: {
        safetyMargin: { value: 27.2 },
        cashCycle: { value: 31 },
      },
    },
  ];

  doc.text("Narrativa anterior", 20, 260);
  const tableStartY = ensureTrendMetricsPdfPage(doc, 263);
  drawTrendMetricsPdf(doc, periods, { startY: tableStartY });

  assert.equal(tableStartY, 20, "The table must start at the top of a new page");
  assert.equal(doc.getNumberOfPages(), 2, "The PDF must add a page for the complete table");

  const firstPageText = (doc as any).internal.pages[1].join("\n");
  const secondPageText = (doc as any).internal.pages[2].join("\n");
  assert.ok(!firstPageText.includes("Margem de Segurança"));
  for (const expectedText of ["2025-01", "2025-02", "8.5%", "Ruim", "27.2%", "Bom"]) {
    assert.ok(
      secondPageText.includes(expectedText),
      `Expected the new PDF page to include ${expectedText}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Failure path: query invalidation must NOT be triggered
// ---------------------------------------------------------------------------

test("does NOT call onSuccess when the server returns a non-OK response", async () => {
  let callCount = 0;
  const onSuccess = () => { callCount += 1; };

  await assert.rejects(
    () => requestPdfExport(makePayload(), onSuccess, stubFetch(false)),
    /Server PDF generation failed/,
    "must throw when res.ok is false",
  );

  assert.equal(callCount, 0, "onSuccess must not be called on a failed export");
});

test("does NOT call onSuccess when fetch throws a network error", async () => {
  let callCount = 0;
  const onSuccess = () => { callCount += 1; };

  await assert.rejects(
    () => requestPdfExport(makePayload(), onSuccess, errorFetch("network error")),
    /network error/,
    "must propagate the network error",
  );

  assert.equal(callCount, 0, "onSuccess must not be called on a network error");
});

test("does NOT call onSuccess across successive failed export attempts", async () => {
  let callCount = 0;
  const onSuccess = () => { callCount += 1; };

  await assert.rejects(
    () => requestPdfExport(makePayload(), onSuccess, stubFetch(false)),
    /Server PDF generation failed/,
    "the initial failed export must reject",
  );

  await assert.rejects(
    () => requestPdfExport(makePayload(), onSuccess, errorFetch("retry network error")),
    /retry network error/,
    "the failed retry must reject",
  );

  assert.equal(
    callCount,
    0,
    "onSuccess must never be called when both the initial export and retry fail",
  );
});

test("throws with a descriptive message when res.ok is false", async () => {
  await assert.rejects(
    () => requestPdfExport(makePayload(), () => {}, stubFetch(false)),
    (err: Error) => {
      assert.ok(err instanceof Error);
      assert.ok(
        err.message.includes("Server PDF generation failed"),
        `Unexpected message: ${err.message}`,
      );
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Guard: onSuccess is called AFTER the blob is obtained, not before
// ---------------------------------------------------------------------------

test("onSuccess is invoked after the blob resolves, not before", async () => {
  const events: string[] = [];

  const delayedFetch = async (_url: string, _init: RequestInit): Promise<Response> => {
    return {
      ok: true,
      status: 200,
      blob: async () => {
        events.push("blob-resolved");
        return makeBlob();
      },
    } as unknown as Response;
  };

  const onSuccess = () => { events.push("onSuccess"); };

  await requestPdfExport(makePayload(), onSuccess, delayedFetch);

  assert.deepEqual(
    events,
    ["blob-resolved", "onSuccess"],
    "onSuccess must fire after blob() resolves",
  );
});
