/**
 * Compile-time contract fixture — never imported at runtime.
 *
 * `tsc --build` (run as part of `pnpm run typecheck:libs`) includes this file
 * via lib/api-client-react/tsconfig.json, so any drift between the generated
 * CompanyDataInput type and the fields the DataEntryPanel actually submits
 * surfaces as a TypeScript error before CI completes.
 *
 * If you see a type error here, re-run `pnpm --filter @workspace/api-spec run generate`
 * to regenerate the client from the updated OpenAPI spec.
 */

import type { CompanyDataInput } from "./generated/api.schemas.ts";

/**
 * Representative payload matching what DataEntryPanel.handleSubmit produces
 * for a fully-filled period.  The `satisfies` operator confirms every field
 * is accepted by the generated type without widening the literal types.
 */
export const _dataEntryPayloadContractCheck = {
  period: "2026-08",
  grossRevenue: 100_000,
  deductions: 5_000,
  netRevenue: 95_000,
  cogs: 40_000,
  grossProfit: 55_000,
  fixedCosts: 20_000,
  variableCosts: 15_000,
  depreciationAmortization: 1_200,
  ebitda: 18_800,
  financialExpenses: 800,
  incomeTax: 2_100,
  netProfit: 15_900,
  cashFlow: 20_000,
  totalEmployees: 25,
  activeCustomers: 150,
  averageTicket: 633,
  conversionRate: 0.12,
  churnRate: 0.03,
  nps: 72,
  defaultRate: 0.02,
  pmr: 30,
  pmp: 45,
  pme: 15,
  proLabore: 10_000,
  additionalData: { source: "manual" },
} satisfies CompanyDataInput;
