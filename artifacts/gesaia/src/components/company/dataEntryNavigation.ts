export const DATA_ENTRY_GROUPS = ["commercial", "marketing", "operations", "hr"] as const;

export type DataEntryGroup = (typeof DATA_ENTRY_GROUPS)[number];

export interface DataEntryNavigationTarget {
  group: DataEntryGroup;
  fields: string[];
  period: string;
}

const ANALYSIS_FIELD_TO_FORM_FIELDS: Record<string, string[]> = {
  totalAcquisitionCost: ["ad_totalAcquisitionCost"],
  newCustomers: ["ad_newCustomers"],
  averageTicket: ["averageTicket"],
  conversionRate: ["conversionRate"],
  churnRate: ["churnRate"],
  clicks: ["ad_clicks"],
  impressions: ["ad_impressions"],
  adSpend: ["ad_adSpend"],
  adLeads: ["ad_adLeads"],
  adRevenue: ["ad_adRevenue"],
  oeeAvailability: ["ad_oeeAvailability"],
  oeePerformance: ["ad_oeePerformance"],
  oeeQuality: ["ad_oeeQuality"],
  avgSalary: ["ad_avgSalary"],
  trainingInvestment: ["ad_trainingInvestment"],
  trainingHoursPerYear: ["ad_trainingHoursPerYear"],
  productivityGainPct: ["ad_productivityGainPct"],
  "trainingHoursPerYear-or-productivityGainPct": [
    "ad_trainingHoursPerYear",
    "ad_productivityGainPct",
  ],
};

/** Maps missing analysis inputs to the corresponding data-entry form fields. */
export function resolveDataEntryHighlightFields(fieldKeys: string[]): string[] {
  return [...new Set(fieldKeys.flatMap((key) => ANALYSIS_FIELD_TO_FORM_FIELDS[key] ?? [key]))];
}