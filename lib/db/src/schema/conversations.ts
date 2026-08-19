import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { companies } from "./companies";

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  // Liga a conversa diretamente à empresa para que o cascade delete funcione
  // mesmo depois que a investigation é removida (o conversationId na investigation vira null)
  companyId: integer("company_id").references(() => companies.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = typeof conversations.$inferInsert;
