import assert from "node:assert/strict";
import test from "node:test";

import { resolveDataEntryHighlightFields } from "./dataEntryNavigation.ts";

test("maps every commercial warning to its data-entry field", () => {
  assert.deepEqual(
    resolveDataEntryHighlightFields([
      "totalAcquisitionCost",
      "newCustomers",
      "averageTicket",
      "churnRate",
    ]),
    ["ad_totalAcquisitionCost", "ad_newCustomers", "averageTicket", "churnRate"],
  );
});

test("maps marketing and operations warnings to their engine fields", () => {
  assert.deepEqual(
    resolveDataEntryHighlightFields(["clicks", "impressions", "adSpend", "adLeads", "adRevenue"]),
    ["ad_clicks", "ad_impressions", "ad_adSpend", "ad_adLeads", "ad_adRevenue"],
  );
  assert.deepEqual(
    resolveDataEntryHighlightFields(["oeeAvailability", "oeePerformance", "oeeQuality"]),
    ["ad_oeeAvailability", "ad_oeePerformance", "ad_oeeQuality"],
  );
});

test("highlights both alternative RH inputs when either can unlock training ROI", () => {
  assert.deepEqual(
    resolveDataEntryHighlightFields([
      "avgSalary",
      "trainingInvestment",
      "trainingHoursPerYear-or-productivityGainPct",
    ]),
    [
      "ad_avgSalary",
      "ad_trainingInvestment",
      "ad_trainingHoursPerYear",
      "ad_productivityGainPct",
    ],
  );
});