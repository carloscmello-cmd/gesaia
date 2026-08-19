/**
 * Contract regression tests for the financial-data upsert endpoint.
 *
 * These checks catch three classes of drift before release:
 *
 *  1. HTTP method mismatch: the Express route in companies.ts is compared
 *     directly against the OpenAPI spec, so changing either without the other
 *     fails here.
 *
 *  2. Schema field coverage: every numeric field the server validates
 *     (COMPANY_DATA_NUMERIC_FIELDS) must appear in the OpenAPI CompanyDataInput
 *     schema, including all working-capital (pmr/pmp/pme) and DRE fields.
 *
 *  3. Generated client type compatibility: enforced at compile time via
 *     lib/api-client-react/src/dataEntryPayloadContract.ts, which is included
 *     in the api-client-react tsconfig and checked by `tsc --build`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  COMPANY_DATA_IMPORT_FIELDS,
  COMPANY_DATA_NUMERIC_FIELDS,
  mapImportedCompanyDataRow,
  validateCompanyDataImportMapping,
} from "./companyDataFields.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

const openapiPath = resolve(__dirname, "../../../../lib/api-spec/openapi.yaml");
const openapiContent = readFileSync(openapiPath, "utf-8");

// Read the actual Express router source so the HTTP-method check is grounded
// in the server implementation, not just the spec's self-description.
const routerSourcePath = resolve(__dirname, "./companies.ts");
const routerSource = readFileSync(routerSourcePath, "utf-8");

// ── Test 1: HTTP method — spec vs. real Express route ────────────────────────

test("upsert route uses PUT in both the Express router and the OpenAPI spec", () => {
  // ── 1a: Verify the actual server route registers PUT ────────────────────────
  // Match `router.put("/:id/data",` or `router.put('/:id/data',` in source.
  assert.match(
    routerSource,
    /router\.put\(["']\/\:id\/data["']/,
    "companies.ts must register the upsert endpoint as router.put('/:id/data', …). " +
      "If the method changed, update both the route and the OpenAPI spec.",
  );

  // ── 1b: Verify the spec also declares PUT for that path ─────────────────────
  const dataPathMarker = "  /companies/{id}/data:";
  const dataPathIdx = openapiContent.indexOf(dataPathMarker);
  assert.ok(
    dataPathIdx >= 0,
    "Path /companies/{id}/data must exist in the OpenAPI spec",
  );

  const importPathMarker = "  /companies/{id}/data/import:";
  const nextPathIdx = openapiContent.indexOf(importPathMarker, dataPathIdx + 1);
  assert.ok(
    nextPathIdx > dataPathIdx,
    "/companies/{id}/data/import path must follow /companies/{id}/data in the spec",
  );
  const dataPathBlock = openapiContent.slice(dataPathIdx, nextPathIdx);

  assert.ok(
    dataPathBlock.includes("    put:"),
    "PUT method must be defined under /companies/{id}/data in the OpenAPI spec",
  );
  assert.ok(
    dataPathBlock.includes("upsertCompanyData"),
    "PUT operation under /companies/{id}/data must carry operationId upsertCompanyData",
  );
});

// ── Test 2: Schema field coverage ────────────────────────────────────────────

test("OpenAPI CompanyDataInput schema covers every numeric field accepted by the server, including working-capital and DRE fields", () => {
  const schemaMarker = "    CompanyDataInput:";
  const schemaIdx = openapiContent.indexOf(schemaMarker);
  assert.ok(
    schemaIdx >= 0,
    "CompanyDataInput schema must exist in the OpenAPI spec",
  );

  const nextSchemaMarker = "\n    DataImportPayload:";
  const nextSchemaIdx = openapiContent.indexOf(nextSchemaMarker, schemaIdx + 1);
  assert.ok(
    nextSchemaIdx > schemaIdx,
    "DataImportPayload schema must follow CompanyDataInput in the spec",
  );
  const schemaBlock = openapiContent.slice(schemaIdx, nextSchemaIdx);

  // Every field the server validates must appear in the YAML schema.
  for (const field of COMPANY_DATA_NUMERIC_FIELDS) {
    assert.ok(
      schemaBlock.includes(`        ${field}:`),
      `CompanyDataInput schema is missing server field "${field}" — add it to openapi.yaml`,
    );
  }

  // additionalData is required to carry engine-specific (operations, risk, …) data.
  assert.ok(
    schemaBlock.includes("        additionalData:"),
    "CompanyDataInput schema must include the additionalData field",
  );

  // period must be required in the schema.
  assert.ok(
    schemaBlock.includes("required: [period]"),
    "CompanyDataInput schema must mark period as required",
  );
});

// ── Test 3: CSV import contract ──────────────────────────────────────────────

test("CSV import accepts every financial field supported by direct save", () => {
  // The actual route must delegate rows to the shared mapper rather than keep a
  // second, potentially incomplete list of supported financial fields.
  assert.match(
    routerSource,
    /router\.post\(["']\/\:id\/data\/import["']/,
    "companies.ts must register the CSV import endpoint as router.post('/:id/data/import', …)",
  );
  assert.match(
    routerSource,
    /mapImportedCompanyDataRow\(rawRow,\s*importMapping\)/,
    "The CSV import route must validate each row through mapImportedCompanyDataRow",
  );
  const mappingValidationIndex = routerSource.indexOf(
    "validateCompanyDataImportMapping(mapping)",
  );
  const rowLoopIndex = routerSource.indexOf("for (let i = 0; i < rows.length; i++)");
  assert.ok(
    mappingValidationIndex >= 0 && mappingValidationIndex < rowLoopIndex,
    "The CSV import route must validate the mapping before processing rows, including empty imports",
  );

  // DataImportPayload deliberately represents source CSV columns as objects,
  // while its mapping restricts destination keys to fields accepted by the API.
  // This keeps every direct-save field importable without silently accepting a
  // field that the API no longer persists.
  const schemaMarker = "    DataImportPayload:";
  const schemaIdx = openapiContent.indexOf(schemaMarker);
  assert.ok(schemaIdx >= 0, "DataImportPayload schema must exist in the OpenAPI spec");

  const nextSchemaMarker = "\n    DataImportResult:";
  const nextSchemaIdx = openapiContent.indexOf(nextSchemaMarker, schemaIdx + 1);
  assert.ok(
    nextSchemaIdx > schemaIdx,
    "DataImportResult schema must follow DataImportPayload in the OpenAPI spec",
  );
  const schemaBlock = openapiContent.slice(schemaIdx, nextSchemaIdx);
  assert.match(
    schemaBlock,
    /rows:\s+type: array\s+items:\s+type: object/s,
    "DataImportPayload.rows must accept CSV rows with arbitrary source columns",
  );
  assert.match(
    schemaBlock,
    /mapping:\s+type: object/s,
    "DataImportPayload.mapping must accept destination-field-to-CSV-column mappings",
  );
  assert.ok(
    schemaBlock.includes("          additionalProperties: false"),
    "DataImportPayload.mapping must reject destination fields the API does not support",
  );
  assert.ok(
    schemaBlock.includes("          required: [period]"),
    "DataImportPayload.mapping must require a period source column",
  );
  for (const field of COMPANY_DATA_IMPORT_FIELDS) {
    assert.ok(
      schemaBlock.includes(`            ${field}:`),
      `DataImportPayload.mapping is missing supported import field "${field}"`,
    );
  }

  const mapping: Record<string, string> = { period: "CSV Period" };
  const rawRow: Record<string, unknown> = { "CSV Period": "2026-08" };
  const expectedValues: Record<string, string> = { period: "2026-08" };

  for (const [index, field] of COMPANY_DATA_NUMERIC_FIELDS.entries()) {
    const column = `CSV ${field}`;
    const value = index + 1;
    mapping[field] = column;
    rawRow[column] = value;
    expectedValues[field] = String(value);
  }

  assert.deepEqual(
    mapImportedCompanyDataRow(rawRow, mapping),
    { ok: true, values: expectedValues },
    "Every financial field accepted by direct save must survive CSV mapping and validation",
  );

  assert.deepEqual(
    validateCompanyDataImportMapping(
      { period: "CSV Period", removedMetric: "Legacy metric" },
    ),
    {
      ok: false,
      error: 'CSV mapping contains unsupported field "removedMetric"',
    },
    "CSV imports must reject unsupported fields before rows can be skipped for a missing period",
  );
});
