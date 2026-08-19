export const COMPANY_DATA_NUMERIC_FIELDS = [
  "grossRevenue",
  "deductions",
  "netRevenue",
  "cogs",
  "grossProfit",
  "fixedCosts",
  "variableCosts",
  "depreciationAmortization",
  "ebitda",
  "financialExpenses",
  "incomeTax",
  "netProfit",
  "cashFlow",
  "totalEmployees",
  "activeCustomers",
  "averageTicket",
  "conversionRate",
  "churnRate",
  "nps",
  "defaultRate",
  "pmr",
  "pmp",
  "pme",
  "proLabore",
] as const;

export type CompanyDataNumericField = (typeof COMPANY_DATA_NUMERIC_FIELDS)[number];

export const COMPANY_DATA_IMPORT_FIELDS = [
  "period",
  ...COMPANY_DATA_NUMERIC_FIELDS,
  "additionalData",
] as const;

const COMPANY_DATA_IMPORT_FIELD_SET = new Set<string>(COMPANY_DATA_IMPORT_FIELDS);

export type CompanyDataValidationResult =
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; error: string };

export type CompanyDataImportMappingValidationResult =
  | { ok: true; mapping: Record<string, string> }
  | { ok: false; error: string };

type CompanyDataRow = {
  id: unknown;
  companyId: unknown;
  period: unknown;
  additionalData: unknown;
  updatedAt: unknown;
} & Partial<Record<CompanyDataNumericField, unknown>>;

/**
 * Validates and normalises incoming company-period data at the API boundary.
 *
 * Keeping this beside the persistence mapper means newly added financial fields
 * receive exactly the same validation in the direct-save and CSV-import paths.
 */
export function validateCompanyDataInput(body: unknown): CompanyDataValidationResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Request body must be an object" };
  }

  const input = body as Record<string, unknown>;
  if (typeof input.period !== "string" || !input.period.trim()) {
    return { ok: false, error: "period must be a non-empty string" };
  }

  for (const field of COMPANY_DATA_NUMERIC_FIELDS) {
    const value = input[field];
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
      return { ok: false, error: `${field} must be a finite number` };
    }
  }

  if (
    input.additionalData !== undefined &&
    (!input.additionalData ||
      typeof input.additionalData !== "object" ||
      Array.isArray(input.additionalData))
  ) {
    return { ok: false, error: "additionalData must be an object" };
  }

  return { ok: true, values: buildCompanyDataValues(input) };
}

export function mapImportedCompanyDataRow(
  rawRow: unknown,
  mapping: unknown,
): CompanyDataValidationResult {
  if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) {
    return { ok: false, error: "CSV row must be an object" };
  }

  const mappingResult = validateCompanyDataImportMapping(mapping);
  if (!mappingResult.ok) {
    return { ok: false, error: mappingResult.error };
  }

  const mapped: Record<string, unknown> = {};
  const source = rawRow as Record<string, unknown>;
  for (const [field, sourceKey] of Object.entries(mappingResult.mapping)) {
    mapped[field] = source[sourceKey];
  }

  return validateCompanyDataInput(mapped);
}

export function validateCompanyDataImportMapping(
  mapping: unknown,
): CompanyDataImportMappingValidationResult {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
    return { ok: false, error: "CSV mapping must be an object" };
  }

  const validatedMapping: Record<string, string> = {};
  for (const [field, sourceKey] of Object.entries(mapping)) {
    if (!COMPANY_DATA_IMPORT_FIELD_SET.has(field)) {
      return { ok: false, error: `CSV mapping contains unsupported field "${field}"` };
    }
    if (typeof sourceKey !== "string" || !sourceKey.trim()) {
      return { ok: false, error: `CSV mapping for ${field} must be a non-empty column name` };
    }
    validatedMapping[field] = sourceKey;
  }
  if (!validatedMapping.period) {
    return { ok: false, error: "CSV mapping must include period" };
  }
  return { ok: true, mapping: validatedMapping };
}

export function buildCompanyDataValues(body: Record<string, unknown>) {
  const result: Record<string, unknown> = { period: (body.period as string).trim() };
  for (const field of COMPANY_DATA_NUMERIC_FIELDS) {
    if (body[field] !== undefined && body[field] !== null) {
      result[field] = String(body[field]);
    }
  }
  if (body.additionalData !== undefined) result.additionalData = body.additionalData;
  return result;
}

export function serializeCompanyData(row: CompanyDataRow) {
  const result: Record<string, unknown> = {
    id: row.id,
    companyId: row.companyId,
    period: row.period,
  };
  for (const field of COMPANY_DATA_NUMERIC_FIELDS) {
    result[field] = row[field] != null ? Number(row[field]) : null;
  }
  result.additionalData = row.additionalData;
  result.updatedAt = row.updatedAt;
  return result;
}