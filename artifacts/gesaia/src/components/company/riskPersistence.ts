type AdditionalDataFieldType = "number" | "string";

/**
 * Keep the additionalData type classification in one place.
 *
 * New engine fields must be added here with their persisted type instead of
 * being added to one of two independently maintained key lists. The derived
 * lists below then make the conversion performed by mergeAdditionalData
 * follow this classification automatically.
 */
export const AD_FIELD_TYPES = {
  // Commercial engine
  newCustomers: "number",
  totalAcquisitionCost: "number",
  funnelLeads: "number",
  funnelProposals: "number",
  funnelNegotiations: "number",
  numSalespeople: "number",
  // Marketing engine
  impressions: "number",
  clicks: "number",
  adLeads: "number",
  adRevenue: "number",
  adSpend: "number",
  // Operations engine
  capacityUtilization: "number",
  defectRate: "number",
  avgCycleTimeMins: "number",
  oeeAvailability: "number",
  oeePerformance: "number",
  oeeQuality: "number",
  stageCap1: "number",
  stageCap2: "number",
  stageCap3: "number",
  stageCap4: "number",
  stageCap5: "number",
  // HR engine
  turnoverRate: "number",
  avgSalary: "number",
  newHires: "number",
  trainingInvestment: "number",
  trainingHoursPerYear: "number",
  avgRecruitmentCost: "number",
  productivityGainPct: "number",
  // Risks engine
  topClientConcentration: "number",
  risk1Probability: "number",
  risk1Impact: "number",
  risk2Probability: "number",
  risk2Impact: "number",
  risk3Probability: "number",
  risk3Impact: "number",
  risk1Name: "string",
  risk2Name: "string",
  risk3Name: "string",
  // Innovation
  manualProcessHours: "number",
  operatorHourlyCost: "number",
  automationInvestment: "number",
  errorRatePct: "number",
  // Market Intelligence
  marketSize: "number",
  marketGrowthPct: "number",
  companyGrowthPct: "number",
  benchmarkGrossMargin: "number",
  benchmarkConversion: "number",
  // Network
  networkEfficiencyIndex: "number",
  gapToIdealModel: "number",
  networkRank: "number",
  totalNetworkUnits: "number",
  // Strategy extras (editable via other UI but preserved here)
  revenueGrowthPct: "number",
  topProductPct: "number",
  newMarketsRevenuePct: "number",
  competitivePosition: "number",
  businessAgeYears: "number",
  // Operations stage labels
  stageName1: "string",
  stageName2: "string",
  stageName3: "string",
  stageName4: "string",
  stageName5: "string",
} as const satisfies Record<string, AdditionalDataFieldType>;

type AdditionalDataKey = keyof typeof AD_FIELD_TYPES;
type AdditionalDataKeyOfType<Type extends AdditionalDataFieldType> = {
  [Key in AdditionalDataKey]: typeof AD_FIELD_TYPES[Key] extends Type ? Key : never;
}[AdditionalDataKey];

function keysOfAdditionalDataType<Type extends AdditionalDataFieldType>(
  type: Type,
): readonly AdditionalDataKeyOfType<Type>[] {
  return (Object.keys(AD_FIELD_TYPES) as AdditionalDataKey[]).filter(
    (key) => AD_FIELD_TYPES[key] === type,
  ) as AdditionalDataKeyOfType<Type>[];
}

export const AD_EDITABLE_KEYS = keysOfAdditionalDataType("number");
export const AD_STRING_KEYS = keysOfAdditionalDataType("string");

type FormValues = Record<string, string>;

/**
 * Converts persisted additionalData values into the ad_* keys used by the form.
 * Keeping this generic is important: existing engine fields must remain editable
 * and must also remain part of the save merge when a new field is added.
 */
export function hydrateAdditionalData(
  existingAd: Record<string, unknown>,
): FormValues {
  const hydrated: FormValues = {};
  for (const [key, value] of Object.entries(existingAd)) {
    if (value != null && value !== "") hydrated[`ad_${key}`] = String(value);
  }
  return hydrated;
}

/**
 * Applies the current form values to the previously loaded additionalData.
 * Numeric engine fields are converted back to numbers, while names and labels
 * remain strings so a save/reopen round-trip cannot silently replace them.
 */
export function mergeAdditionalData(
  baseAdditionalData: Record<string, unknown>,
  form: FormValues,
): Record<string, unknown> {
  const additionalData: Record<string, unknown> = { ...baseAdditionalData };

  for (const key of AD_EDITABLE_KEYS) {
    const raw = form[`ad_${key}`];
    if (raw !== undefined && raw !== "") {
      additionalData[key] = Number(raw);
    } else {
      delete additionalData[key];
    }
  }

  for (const key of AD_STRING_KEYS) {
    const raw = form[`ad_${key}`];
    if (raw !== undefined && raw !== "") {
      additionalData[key] = raw;
    } else {
      delete additionalData[key];
    }
  }

  return additionalData;
}