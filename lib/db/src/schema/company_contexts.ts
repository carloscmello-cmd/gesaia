import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

import { companies } from "./companies";

export const companyContexts = pgTable("company_contexts", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .unique()
    .references(() => companies.id, { onDelete: "cascade" }),
  productsServices: text("products_services").notNull(),
  mainMarket: text("main_market").notNull(),
  competitors: text("competitors").notNull(),
  mainChallenges: text("main_challenges").notNull(),
  additionalNotes: text("additional_notes"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type CompanyContext = typeof companyContexts.$inferSelect;
export type InsertCompanyContext = typeof companyContexts.$inferInsert;
