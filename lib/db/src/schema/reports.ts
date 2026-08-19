import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

import { companies } from "./companies";

export const reports = pgTable("reports", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  type: text("type", { enum: ["investigation", "full_analysis", "simulation"] }).notNull(),
  content: jsonb("content").notNull(),
  idempotencyKey: text("idempotency_key").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Report = typeof reports.$inferSelect;
export type InsertReport = typeof reports.$inferInsert;
