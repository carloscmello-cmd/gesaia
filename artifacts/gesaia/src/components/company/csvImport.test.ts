import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPANY_DATA_NUMERIC_FIELDS,
  mapImportedCompanyDataRow,
} from "../../../../api-server/src/routes/companyDataFields.ts";
import {
  AD_CSV_COLUMNS,
  CSV_COLUMNS,
  CSV_IMPORT_EXCLUDED_FINANCIAL_FIELDS,
  buildCsvImportMapping,
  buildCsvTemplateRows,
  buildImportRows,
  parseCsv,
} from "./csvImport.ts";

test("CSV upload columns cover every API-supported financial field", () => {
  const apiFields = new Set<string>(COMPANY_DATA_NUMERIC_FIELDS);
  const csvFields = CSV_COLUMNS.map(({ key }) => key);
  const excludedFields = new Set<string>(CSV_IMPORT_EXCLUDED_FINANCIAL_FIELDS);
  const mappingFields = Object.keys(buildCsvImportMapping()).filter((field) =>
    apiFields.has(field),
  );

  assert.equal(
    new Set(csvFields).size,
    csvFields.length,
    "CSV upload columns must not map one financial field more than once",
  );

  for (const field of excludedFields) {
    assert.ok(
      apiFields.has(field),
      `CSV exclusion "${field}" is not a financial field supported by the API`,
    );
  }

  for (const field of csvFields) {
    assert.ok(
      apiFields.has(field),
      `CSV upload field "${field}" is not supported by the data API`,
    );
  }

  const expectedImportFields = COMPANY_DATA_NUMERIC_FIELDS
    .filter((field) => !excludedFields.has(field))
    .sort();
  assert.deepEqual(
    [...new Set(csvFields)].sort(),
    expectedImportFields,
    "Every API-supported importable financial field must have a CSV column or an explicit exclusion",
  );
  assert.deepEqual(
    mappingFields.sort(),
    [...apiFields].sort(),
    "The CSV API mapping must include every supported financial field, including calculated fields",
  );
});

test("CSV import derives and persists calculated financial fields", () => {
  const [importedRow] = buildImportRows([{
    period: "2026-08",
    grossRevenue: "500000",
    deductions: "50000",
    cogs: "150000",
    fixedCosts: "80000",
    variableCosts: "60000",
    depreciationAmortization: "12000",
  }]);

  assert.deepEqual(
    mapImportedCompanyDataRow(importedRow, buildCsvImportMapping()),
    {
      ok: true,
      values: {
        period: "2026-08",
        grossRevenue: "500000",
        deductions: "50000",
        netRevenue: "450000",
        cogs: "150000",
        grossProfit: "300000",
        fixedCosts: "80000",
        variableCosts: "60000",
        depreciationAmortization: "12000",
        ebitda: "172000",
      },
    },
    "Calculated financial fields must survive CSV row construction and API mapping",
  );
});

test("CSV template keeps one example cell per exported header", () => {
  const { headers, example } = buildCsvTemplateRows();

  assert.equal(example.length, headers.length);
  assert.equal(example.length, CSV_COLUMNS.length + AD_CSV_COLUMNS.length + 1);

  const valueByHeader = new Map(headers.map((header, index) => [header, example[index]]));
  assert.equal(valueByHeader.get("Operacoes - Nome Etapa 1"), "Separação");
  assert.equal(valueByHeader.get("Operacoes - Nome Etapa 2"), "Montagem");
  assert.equal(valueByHeader.get("Operacoes - Nome Etapa 3"), "Expedição");
  assert.equal(valueByHeader.get("Operacoes - Nome Etapa 4"), "");
  assert.equal(valueByHeader.get("Operacoes - Nome Etapa 5"), "");
  assert.equal(valueByHeader.get("Operacoes - Capacidade Etapa 1"), "100");
  assert.equal(valueByHeader.get("Operacoes - Capacidade Etapa 2"), "80");
  assert.equal(valueByHeader.get("Operacoes - Capacidade Etapa 3"), "60");
  assert.equal(valueByHeader.get("Operacoes - Capacidade Etapa 4"), "");
  assert.equal(valueByHeader.get("Operacoes - Capacidade Etapa 5"), "");
});

test("CSV import keeps custom stage names as stored additionalData strings", () => {
  const valuesByHeader = new Map([
    ["Receita Bruta (R$)", "500000"],
    ["Operacoes - Nome Etapa 1", "Prospecção ativa"],
    ["Operacoes - Nome Etapa 2", "Qualificação B2B"],
    ["Operacoes - Nome Etapa 3", "Entrega premium"],
    ["Operacoes - Capacidade Etapa 4", "45"],
    ["Operacoes - Capacidade Etapa 5", "30"],
  ]);
  const templateColumns = [...CSV_COLUMNS, ...AD_CSV_COLUMNS];
  const csv = [
    ["Periodo", ...templateColumns.map(({ header }) => header)].join(";"),
    ["2026-08", ...templateColumns.map(({ header }) => valuesByHeader.get(header) ?? "")].join(";"),
  ].join("\n");

  const { rows, errors } = parseCsv(csv);

  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [{
    period: "2026-08",
    grossRevenue: "500000",
    ad_stageName1: "Prospecção ativa",
    ad_stageName2: "Qualificação B2B",
    ad_stageName3: "Entrega premium",
    ad_stageCap4: "45",
    ad_stageCap5: "30",
  }]);

  const [importedRow] = buildImportRows(rows);
  assert.deepEqual(importedRow.additionalData, {
    stageName1: "Prospecção ativa",
    stageName2: "Qualificação B2B",
    stageName3: "Entrega premium",
    stageCap4: 45,
    stageCap5: 30,
  });
  assert.equal(typeof (importedRow.additionalData as Record<string, unknown>).stageName1, "string");
  assert.equal(typeof (importedRow.additionalData as Record<string, unknown>).stageName2, "string");
  assert.equal(typeof (importedRow.additionalData as Record<string, unknown>).stageName3, "string");
  assert.equal(typeof (importedRow.additionalData as Record<string, unknown>).stageCap4, "number");
  assert.equal(typeof (importedRow.additionalData as Record<string, unknown>).stageCap5, "number");
});

test("CSV import preserves quoted stage names containing the active delimiter", () => {
  const semicolonCsv = [
    "Periodo;Operacoes - Nome Etapa 1;Operacoes - Capacidade Etapa 1",
    '2026-08;"Separação; conferência";45',
  ].join("\n");
  const commaCsv = [
    "Periodo,Operacoes - Nome Etapa 1,Operacoes - Capacidade Etapa 1",
    '2026-08,"Separação, conferência",45',
  ].join("\n");

  for (const csv of [semicolonCsv, commaCsv]) {
    const { rows, errors } = parseCsv(csv);

    assert.deepEqual(errors, []);
    assert.deepEqual(buildImportRows(rows), [{
      period: "2026-08",
      additionalData: {
        stageName1: csv.includes(";") ? "Separação; conferência" : "Separação, conferência",
        stageCap1: 45,
      },
    }]);
  }
});

test("CSV import keeps multiline quoted fields in one row and preserves later rows", () => {
  const csv = [
    "Periodo;Operacoes - Nome Etapa 1;Operacoes - Capacidade Etapa 1",
    '2026-08;"Separação\nconferência";45',
    "2026-09;Entrega;30",
  ].join("\n");

  const { rows, errors } = parseCsv(csv);

  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [
    {
      period: "2026-08",
      ad_stageName1: "Separação\nconferência",
      ad_stageCap1: "45",
    },
    {
      period: "2026-09",
      ad_stageName1: "Entrega",
      ad_stageCap1: "30",
    },
  ]);
});

test("CSV import keeps period-like continuation text inside multiline quoted fields", () => {
  const csv = [
    "Periodo;Operacoes - Nome Etapa 1;Operacoes - Capacidade Etapa 1",
    '2026-08;"Separação',
    '2026-09; conferência";45',
    "2026-10;Entrega;30",
  ].join("\n");

  const { rows, errors } = parseCsv(csv);

  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [
    {
      period: "2026-08",
      ad_stageName1: "Separação\n2026-09; conferência",
      ad_stageCap1: "45",
    },
    {
      period: "2026-10",
      ad_stageName1: "Entrega",
      ad_stageCap1: "30",
    },
  ]);
});

test("CSV import reports the starting line for an unterminated multiline quote", () => {
  const csv = [
    "Periodo;Operacoes - Nome Etapa 1;Operacoes - Capacidade Etapa 1",
    '2026-08;"Separação',
    "conferência;45",
  ].join("\n");

  const { rows, errors } = parseCsv(csv);

  assert.deepEqual(rows, []);
  assert.deepEqual(errors, [
    "Linha 2: campo entre aspas não terminado; linha ignorada",
  ]);
});

test("CSV import reports an unterminated quote without parsing its remaining content as later rows", () => {
  const csv = [
    "Periodo;Operacoes - Nome Etapa 1;Operacoes - Capacidade Etapa 1",
    '2026-08;"Separação; conferência;45',
    "2026-09;Entrega;30",
  ].join("\n");

  const { rows, errors } = parseCsv(csv);

  assert.deepEqual(rows, []);
  assert.deepEqual(errors, [
    "Linha 2: campo entre aspas não terminado; linha ignorada",
  ]);
});
