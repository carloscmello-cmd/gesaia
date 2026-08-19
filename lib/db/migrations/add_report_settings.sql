-- Configurações do Relatório Completo de Diagnóstico (setor + limiares por empresa)
CREATE TABLE IF NOT EXISTS "report_settings" (
  "id" serial PRIMARY KEY,
  "company_id" integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "sector" text NOT NULL DEFAULT 'geral',
  "thresholds" jsonb NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "report_settings_company_unique" ON "report_settings" ("company_id");
