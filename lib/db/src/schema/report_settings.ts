import { pgTable, serial, text, integer, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { companies } from "./companies";

// Per-company configuration for the full diagnostic report:
// business sector and consultant-editable indicator thresholds.
export const reportSettings = pgTable(
  "report_settings",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    sector: text("sector").notNull().default("geral"),
    // { [indicatorKey]: { bounds: [a,b,c,d], direction: "higher" | "lower" } }
    thresholds: jsonb("thresholds").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("report_settings_company_unique").on(t.companyId)],
);

export type ReportSettings = typeof reportSettings.$inferSelect;
export type InsertReportSettings = typeof reportSettings.$inferInsert;
