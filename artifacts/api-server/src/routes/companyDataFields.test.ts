import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCompanyDataValues,
  mapImportedCompanyDataRow,
  serializeCompanyData,
  validateCompanyDataInput,
} from "./companyDataFields.ts";

test("company data PUT/GET transformation preserves DRE and working-capital fields", () => {
  const request = {
    period: "2026-08",
    deductions: 5000,
    depreciationAmortization: 1200,
    financialExpenses: 800,
    incomeTax: 2100,
    pmr: 30,
    pmp: 45,
    pme: 15,
    proLabore: 10000,
  };

  const persisted = buildCompanyDataValues(request);
  assert.deepEqual(persisted, {
    period: "2026-08",
    deductions: "5000",
    depreciationAmortization: "1200",
    financialExpenses: "800",
    incomeTax: "2100",
    pmr: "30",
    pmp: "45",
    pme: "15",
    proLabore: "10000",
  });

  const response = serializeCompanyData({
    id: 1,
    companyId: 2,
    ...persisted,
    additionalData: null,
    updatedAt: "2026-08-19T00:00:00.000Z",
  });

  assert.deepEqual(
    Object.fromEntries(
      Object.keys(request)
        .filter((key) => key !== "period")
        .map((key) => [key, response[key]]),
    ),
    {
      deductions: 5000,
      depreciationAmortization: 1200,
      financialExpenses: 800,
      incomeTax: 2100,
      pmr: 30,
      pmp: 45,
      pme: 15,
      proLabore: 10000,
    },
  );
});

test("company data validation protects all save paths from invalid financial payloads", () => {
  assert.deepEqual(
    validateCompanyDataInput({
      period: " 2026-08 ",
      deductions: 5000,
      financialExpenses: 800,
      incomeTax: 2100,
      pmr: 30,
      additionalData: { source: "manual" },
    }),
    {
      ok: true,
      values: {
        period: "2026-08",
        deductions: "5000",
        financialExpenses: "800",
        incomeTax: "2100",
        pmr: "30",
        additionalData: { source: "manual" },
      },
    },
  );

  assert.deepEqual(validateCompanyDataInput({ period: "2026-08", pmr: Number.NaN }), {
    ok: false,
    error: "pmr must be a finite number",
  });
  assert.deepEqual(validateCompanyDataInput({ period: "", grossRevenue: 1000 }), {
    ok: false,
    error: "period must be a non-empty string",
  });
  assert.deepEqual(validateCompanyDataInput({ period: "2026-08", additionalData: [] }), {
    ok: false,
    error: "additionalData must be an object",
  });
});

test("CSV imports preserve named risks in additional data", () => {
  const validated = mapImportedCompanyDataRow(
    {
      period: "2026-08",
      additionalData: {
        risk1Name: "Inadimplência de clientes",
        risk2Name: "Perda de fornecedor",
        risk3Name: "Falha operacional",
      },
    },
    {
      period: "period",
      additionalData: "additionalData",
    },
  );

  assert.deepEqual(validated, {
    ok: true,
    values: {
      period: "2026-08",
      additionalData: {
        risk1Name: "Inadimplência de clientes",
        risk2Name: "Perda de fornecedor",
        risk3Name: "Falha operacional",
      },
    },
  });
});