import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

import { users } from "./users";

export const networks = pgTable("networks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  ownerId: integer("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Network = typeof networks.$inferSelect;
export type InsertNetwork = typeof networks.$inferInsert;
