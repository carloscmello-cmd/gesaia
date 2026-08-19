import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

import { users } from "./users";
import { networks } from "./networks";

export interface ScoreThresholds {
  greenMin: number;
  yellowMin: number;
}

export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  segment: text("segment").notNull(),
  activity: text("activity").notNull(),
  businessModel: text("business_model").notNull(),
  networkId: integer("network_id").references(() => networks.id, {
    onDelete: "set null",
  }),
  ownerId: integer("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  scoreThresholds: jsonb("score_thresholds").$type<ScoreThresholds>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Company = typeof companies.$inferSelect;
export type InsertCompany = typeof companies.$inferInsert;
