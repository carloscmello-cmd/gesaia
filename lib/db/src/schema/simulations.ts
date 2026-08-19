import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

import { companies } from "./companies";

export const simulations = pgTable("simulations", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type", { enum: ["dre", "price", "funnel", "turnover", "network"] }).notNull(),
  parameters: jsonb("parameters").notNull(),
  results: jsonb("results").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Simulation = typeof simulations.$inferSelect;
export type InsertSimulation = typeof simulations.$inferInsert;
