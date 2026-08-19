import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  jsonb,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { companies } from "./companies";

export const companyData = pgTable(
  "company_data",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    period: text("period").notNull(), // e.g. "2024-01", "2024-Q1", "2024"
    grossRevenue: numeric("gross_revenue", { precision: 18, scale: 4 }),
    netRevenue: numeric("net_revenue", { precision: 18, scale: 4 }),
    cogs: numeric("cogs", { precision: 18, scale: 4 }),
    grossProfit: numeric("gross_profit", { precision: 18, scale: 4 }),
    fixedCosts: numeric("fixed_costs", { precision: 18, scale: 4 }),
    variableCosts: numeric("variable_costs", { precision: 18, scale: 4 }),
    ebitda: numeric("ebitda", { precision: 18, scale: 4 }),
    netProfit: numeric("net_profit", { precision: 18, scale: 4 }),
    cashFlow: numeric("cash_flow", { precision: 18, scale: 4 }),
    totalEmployees: numeric("total_employees", { precision: 10, scale: 0 }),
    activeCustomers: numeric("active_customers", { precision: 10, scale: 0 }),
    averageTicket: numeric("average_ticket", { precision: 18, scale: 4 }),
    conversionRate: numeric("conversion_rate", { precision: 10, scale: 6 }),
    churnRate: numeric("churn_rate", { precision: 10, scale: 6 }),
    nps: numeric("nps", { precision: 6, scale: 2 }),
    defaultRate: numeric("default_rate", { precision: 10, scale: 6 }),
    // Ciclo financeiro / capital de giro
    pmr: numeric("pmr", { precision: 6, scale: 1 }), // Prazo Médio de Recebimento (dias)
    pmp: numeric("pmp", { precision: 6, scale: 1 }), // Prazo Médio de Pagamento (dias)
    pme: numeric("pme", { precision: 6, scale: 1 }), // Prazo Médio de Estoque (dias)
    proLabore: numeric("pro_labore", { precision: 18, scale: 4 }), // Retirada do sócio
    // ── Cadeia completa do DRE ────────────────────────────────────────────
    deductions: numeric("deductions", { precision: 18, scale: 4 }),                   // Deduções da Receita (impostos s/ venda, devoluções)
    depreciationAmortization: numeric("depreciation_amortization", { precision: 18, scale: 4 }), // D&A (add-back para EBITDA)
    financialExpenses: numeric("financial_expenses", { precision: 18, scale: 4 }),     // Despesas Financeiras (juros, IOF)
    incomeTax: numeric("income_tax", { precision: 18, scale: 4 }),                    // IR + CSLL
    additionalData: jsonb("additional_data"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique().on(t.companyId, t.period)],
);

export type CompanyData = typeof companyData.$inferSelect;
export type InsertCompanyData = typeof companyData.$inferInsert;
