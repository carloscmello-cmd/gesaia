import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

import { companies } from "./companies";
import { conversations } from "./conversations";

export const investigations = pgTable("investigations", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  status: text("status", { enum: ["open", "in_progress", "completed"] })
    .notNull()
    .default("open"),
  period: text("period"),
  conversationId: integer("conversation_id").references(() => conversations.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Investigation = typeof investigations.$inferSelect;
export type InsertInvestigation = typeof investigations.$inferInsert;
