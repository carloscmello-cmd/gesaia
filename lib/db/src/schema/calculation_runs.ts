import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

import { companies } from "./companies";

export const calculationRuns = pgTable("calculation_runs", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  period: text("period").notNull(),
  engines: jsonb("engines").notNull().$type<string[]>(),
  status: text("status", { enum: ["pending", "running", "completed", "failed"] })
    .notNull()
    .default("pending"),
  results: jsonb("results"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type CalculationRun = typeof calculationRuns.$inferSelect;
export type InsertCalculationRun = typeof calculationRuns.$inferInsert;
