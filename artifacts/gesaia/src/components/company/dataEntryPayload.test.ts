import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPANY_DATA_NUMERIC_FIELDS,
  validateCompanyDataInput,
} from "../../../../api-server/src/routes/companyDataFields.ts";
import { buildDataEntryPayload } from "./dataEntryPayload.ts";

test("data-entry submit payload contains exactly the API's accepted top-level fields", () => {
  const payload = buildDataEntryPayload(
    {
      period: "2026-08",
      grossRevenue: "100000",
      deductions: "5000",
      cogs: "40000",
      fixedCosts: "20000",
      variableCosts: "15000",
      depreciationAmortization: "1200",
      financialExpenses: "800",
      incomeTax: "2100",
      cashFlow: "20000",
      totalEmployees: "25",
      activeCustomers: "150",
      averageTicket: "633",
      conversionRate: "12",
      churnRate: "3",
      nps: "72",
      defaultRate: "2",
      pmr: "30",
      pmp: "45",
      pme: "15",
      proLabore: "10000",
      ad_stageName1: "Qualificação",
      ad_manualProcessHours: "40",
    },
    {
      netIsAuto: true,
      net: 95000,
      netProfitIsAuto: true,
      netProfitCalc: 15900,
      grossProfit: 55000,
      ebitda: 18800,
    },
    { preservedEngineField: "keep me" },
  );

  assert.ok(payload, "representative form state must produce a submit payload");
  assert.deepEqual(
    Object.keys(payload).sort(),
    ["period", ...COMPANY_DATA_NUMERIC_FIELDS, "additionalData"].sort(),
    "DataEntryPanel must send only API-accepted numeric fields at the top level",
  );
  assert.deepEqual(payload.additionalData, {
    preservedEngineField: "keep me",
    stageName1: "Qualificação",
    manualProcessHours: 40,
  });

  const validation = validateCompanyDataInput(payload);
  assert.equal(
    validation.ok,
    true,
    validation.ok ? undefined : `API rejected payload: ${validation.error}`,
  );
});

test("data-entry submit builder rejects values the API would reject", () => {
  const validDerived = {
    netIsAuto: false,
    net: Number.NaN,
    netProfitIsAuto: false,
    netProfitCalc: Number.NaN,
    grossProfit: Number.NaN,
    ebitda: Number.NaN,
  };

  assert.equal(
    buildDataEntryPayload({ period: " " }, validDerived, {}),
    null,
    "a whitespace-only period must not reach the API",
  );
  assert.equal(
    buildDataEntryPayload({ period: "2026-08", grossRevenue: "1e309" }, validDerived, {}),
    null,
    "an overflowing manual number must not reach the API",
  );
  assert.equal(
    buildDataEntryPayload(
      { period: "2026-08" },
      { ...validDerived, grossProfit: Number.POSITIVE_INFINITY },
      {},
    ),
    null,
    "a non-finite derived number must not reach the API",
  );
});