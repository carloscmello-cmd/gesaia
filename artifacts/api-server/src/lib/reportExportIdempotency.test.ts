import assert from "node:assert/strict";
import test from "node:test";

import {
  persistReportExport,
  type ReportExportRecord,
  type ReportExportValues,
} from "./reportExportIdempotency.ts";

function createInMemoryStore() {
  const rows: Array<ReportExportRecord & { idempotencyKey: string | null }> = [];
  let nextId = 1;

  return {
    rows,
    async findByIdempotencyKey(key: string) {
      return rows.find((row) => row.idempotencyKey === key) ?? null;
    },
    async insert(values: ReportExportValues) {
      if (
        values.idempotencyKey &&
        rows.some((row) => row.idempotencyKey === values.idempotencyKey)
      ) {
        return null;
      }

      const row = {
        id: nextId++,
        companyId: values.companyId,
        content: values.content,
        idempotencyKey: values.idempotencyKey,
        createdAt: new Date("2026-08-19T12:00:00.000Z"),
      };
      rows.push(row);
      return row;
    },
  };
}

function makeValues(idempotencyKey: string): ReportExportValues {
  return {
    companyId: 42,
    title: "Relatório Gerencial — Empresa Teste (2026-08)",
    type: "full_analysis",
    content: {
      companyName: "Empresa Teste",
      generatedAt: "19/08/2026 09:00:00",
      findings: [{ title: "Original finding" }],
    },
    idempotencyKey,
  };
}

test("a transport retry reuses the original report entry", async () => {
  const store = createInMemoryStore();
  const first = await persistReportExport(makeValues("attempt-1"), store);

  const retry = await persistReportExport({
    ...makeValues("attempt-1"),
    content: {
      companyName: "Empresa Teste",
      generatedAt: "19/08/2026 09:01:00",
      findings: [{ title: "Changed retry payload must not replace the original" }],
    },
  }, store);

  assert.equal(first.reused, false);
  assert.equal(retry.reused, true);
  assert.equal(retry.report.id, first.report.id);
  assert.equal(store.rows.length, 1);
  assert.deepEqual(retry.report.content, first.report.content);
});

test("a later export with a new idempotency key creates a new report entry", async () => {
  const store = createInMemoryStore();
  const first = await persistReportExport(makeValues("attempt-1"), store);
  const laterExport = await persistReportExport(makeValues("attempt-2"), store);

  assert.equal(first.reused, false);
  assert.equal(laterExport.reused, false);
  assert.notEqual(laterExport.report.id, first.report.id);
  assert.equal(store.rows.length, 2);
});

test("concurrent retries converge on the one report inserted by another request", async () => {
  const store = createInMemoryStore();
  const first = await persistReportExport(makeValues("attempt-1"), store);
  let firstLookup = true;

  const retry = await persistReportExport(makeValues("attempt-1"), {
    ...store,
    async findByIdempotencyKey(key) {
      // Simulate the initial lookup racing before the other request commits.
      if (firstLookup) {
        firstLookup = false;
        return null;
      }
      return store.findByIdempotencyKey(key);
    },
  });

  assert.equal(retry.reused, true);
  assert.equal(retry.report.id, first.report.id);
  assert.equal(store.rows.length, 1);
});