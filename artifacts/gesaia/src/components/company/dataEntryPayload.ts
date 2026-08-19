import type { CompanyDataInput } from "@workspace/api-client-react";
import { mergeAdditionalData } from "./riskPersistence";

export type DataEntryFormValues = Record<string, string>;

export interface DataEntryDerivedValues {
  netIsAuto: boolean;
  net: number;
  netProfitIsAuto: boolean;
  netProfitCalc: number;
  grossProfit: number;
  ebitda: number;
}

function parseFiniteNumber(rawValue: string): number | null {
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : null;
}

function containsNonFiniteNumber(value: unknown): boolean {
  if (typeof value === "number") return !Number.isFinite(value);
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some(containsNonFiniteNumber);
}

const MANUAL_INPUT_FIELDS = [
  "grossRevenue", "deductions", "cogs", "fixedCosts", "variableCosts",
  "depreciationAmortization", "financialExpenses", "incomeTax",
  "cashFlow", "totalEmployees", "activeCustomers",
  "averageTicket", "conversionRate", "churnRate", "nps", "defaultRate",
  "pmr", "pmp", "pme", "proLabore",
] as const satisfies readonly (keyof CompanyDataInput)[];

/**
 * Builds the exact API payload submitted by DataEntryPanel for a completed form.
 * Engine-specific fields are deliberately kept under additionalData.
 * Returns null when the form would produce a payload rejected by the API.
 */
export function buildDataEntryPayload(
  form: DataEntryFormValues,
  derived: DataEntryDerivedValues,
  baseAdditionalData: Record<string, unknown>,
): CompanyDataInput | null {
  const period = form.period.trim();
  if (!period) return null;

  const body: CompanyDataInput = { period };

  for (const field of MANUAL_INPUT_FIELDS) {
    if (form[field] !== undefined && form[field] !== "") {
      const value = parseFiniteNumber(form[field]);
      if (value === null) return null;
      body[field] = value;
    }
  }

  if (derived.netIsAuto) {
    if (!Number.isFinite(derived.net)) return null;
    body.netRevenue = derived.net;
  } else if (form.netRevenue !== undefined && form.netRevenue !== "") {
    const value = parseFiniteNumber(form.netRevenue);
    if (value === null) return null;
    body.netRevenue = value;
  }

  if (derived.netProfitIsAuto) {
    if (!Number.isFinite(derived.netProfitCalc)) return null;
    body.netProfit = derived.netProfitCalc;
  } else if (form.netProfit !== undefined && form.netProfit !== "") {
    const value = parseFiniteNumber(form.netProfit);
    if (value === null) return null;
    body.netProfit = value;
  }

  if (!Number.isNaN(derived.grossProfit)) {
    if (!Number.isFinite(derived.grossProfit)) return null;
    body.grossProfit = derived.grossProfit;
  }
  if (!Number.isNaN(derived.ebitda)) {
    if (!Number.isFinite(derived.ebitda)) return null;
    body.ebitda = derived.ebitda;
  }

  const additionalData = mergeAdditionalData(baseAdditionalData, form);
  if (containsNonFiniteNumber(additionalData)) return null;

  body.additionalData = additionalData;
  return body;
}