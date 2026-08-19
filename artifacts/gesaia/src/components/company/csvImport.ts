import type { CompanyDataInput } from "@workspace/api-client-react";
import { deriveFinancialValues } from "./financialDerivations.ts";
import { AD_STRING_KEYS } from "./riskPersistence.ts";

type CsvCompanyDataKey = Exclude<keyof CompanyDataInput, "period" | "additionalData">;

// These API-supported fields are calculated from imported inputs and therefore
// intentionally do not have source columns in the CSV upload template.
export const CSV_IMPORT_EXCLUDED_FINANCIAL_FIELDS = [
  "grossProfit",
  "ebitda",
] as const;

export const CSV_COLUMNS: { header: string; key: CsvCompanyDataKey }[] = [
  { header: "Receita Bruta (R$)",                key: "grossRevenue" },
  { header: "Deducoes da Receita (R$)",           key: "deductions" },
  { header: "Receita Liquida (R$)",               key: "netRevenue" },
  { header: "CMV-CPV (R$)",                       key: "cogs" },
  { header: "Custos Fixos (R$)",                  key: "fixedCosts" },
  { header: "Custos Variaveis (R$)",              key: "variableCosts" },
  { header: "DA - Depreciacao Amortizacao (R$)",  key: "depreciationAmortization" },
  { header: "Despesas Financeiras (R$)",          key: "financialExpenses" },
  { header: "IR CSLL (R$)",                       key: "incomeTax" },
  { header: "Lucro Liquido (R$)",                 key: "netProfit" },
  { header: "Fluxo de Caixa (R$)",                key: "cashFlow" },
  { header: "PMR - Prazo Medio Recebimento",      key: "pmr" },
  { header: "PMP - Prazo Medio Pagamento",        key: "pmp" },
  { header: "PME - Prazo Medio Estoque",          key: "pme" },
  { header: "Pro-labore (R$)",                    key: "proLabore" },
  { header: "Colaboradores",                      key: "totalEmployees" },
  { header: "Clientes Ativos",                   key: "activeCustomers" },
  { header: "Ticket Medio (R$)",                  key: "averageTicket" },
  { header: "Taxa de Conversao (%)",              key: "conversionRate" },
  { header: "Taxa de Churn (%)",                  key: "churnRate" },
  { header: "NPS",                                key: "nps" },
  { header: "Inadimplencia (%)",                  key: "defaultRate" },
];

export const AD_CSV_COLUMNS: { header: string; key: string }[] = [
  { header: "Risco 1 - Nome",                             key: "risk1Name" },
  { header: "Risco 2 - Nome",                             key: "risk2Name" },
  { header: "Risco 3 - Nome",                             key: "risk3Name" },
  { header: "Inovacao - Horas Processo Manual",            key: "manualProcessHours" },
  { header: "Inovacao - Custo Hora Operador (R$)",         key: "operatorHourlyCost" },
  { header: "Inovacao - Investimento Automacao (R$)",      key: "automationInvestment" },
  { header: "Inovacao - Taxa de Erros (%)",                key: "errorRatePct" },
  { header: "Mercado - Tamanho do Mercado (R$)",           key: "marketSize" },
  { header: "Mercado - Crescimento do Mercado (%)",        key: "marketGrowthPct" },
  { header: "Mercado - Crescimento da Empresa (%)",        key: "companyGrowthPct" },
  { header: "Mercado - Margem Bruta Benchmark (%)",        key: "benchmarkGrossMargin" },
  { header: "Mercado - Conversao Benchmark (%)",           key: "benchmarkConversion" },
  { header: "Rede - Indice de Eficiencia",                 key: "networkEfficiencyIndex" },
  { header: "Rede - Gap para Modelo Ideal (%)",            key: "gapToIdealModel" },
  { header: "Rede - Ranking na Rede",                      key: "networkRank" },
  { header: "Rede - Total de Unidades",                    key: "totalNetworkUnits" },
  { header: "Operacoes - Nome Etapa 1",                    key: "stageName1" },
  { header: "Operacoes - Nome Etapa 2",                    key: "stageName2" },
  { header: "Operacoes - Nome Etapa 3",                    key: "stageName3" },
  { header: "Operacoes - Nome Etapa 4",                    key: "stageName4" },
  { header: "Operacoes - Nome Etapa 5",                    key: "stageName5" },
  { header: "Operacoes - Capacidade Etapa 1",              key: "stageCap1" },
  { header: "Operacoes - Capacidade Etapa 2",              key: "stageCap2" },
  { header: "Operacoes - Capacidade Etapa 3",              key: "stageCap3" },
  { header: "Operacoes - Capacidade Etapa 4",              key: "stageCap4" },
  { header: "Operacoes - Capacidade Etapa 5",              key: "stageCap5" },
];

export function buildCsvImportMapping(): Record<string, string> {
  const mapping: Record<string, string> = {
    period: "period",
    additionalData: "additionalData",
  };
  for (const { key } of CSV_COLUMNS) mapping[key] = key;
  for (const key of CSV_IMPORT_EXCLUDED_FINANCIAL_FIELDS) mapping[key] = key;
  return mapping;
}

const CSV_TEMPLATE_EXAMPLE_VALUES: Record<string, string> = {
  period: "2024-01",
  grossRevenue: "500000",
  deductions: "50000",
  netRevenue: "450000",
  cogs: "150000",
  fixedCosts: "80000",
  variableCosts: "60000",
  depreciationAmortization: "12000",
  financialExpenses: "8000",
  incomeTax: "25000",
  netProfit: "120000",
  cashFlow: "90000",
  pmr: "30",
  pmp: "45",
  pme: "15",
  proLabore: "10000",
  totalEmployees: "25",
  activeCustomers: "180",
  averageTicket: "1500",
  conversionRate: "12.5",
  churnRate: "3.2",
  nps: "42",
  defaultRate: "2.1",
  risk1Name: "Inadimplência de clientes",
  risk2Name: "Perda de fornecedor",
  risk3Name: "",
  manualProcessHours: "40",
  operatorHourlyCost: "25",
  automationInvestment: "15000",
  errorRatePct: "5",
  marketSize: "50000000",
  marketGrowthPct: "8",
  companyGrowthPct: "12",
  benchmarkGrossMargin: "45",
  benchmarkConversion: "15",
  networkEfficiencyIndex: "72",
  gapToIdealModel: "18",
  networkRank: "12",
  totalNetworkUnits: "85",
  stageName1: "Separação",
  stageName2: "Montagem",
  stageName3: "Expedição",
  stageName4: "",
  stageName5: "",
  stageCap1: "100",
  stageCap2: "80",
  stageCap3: "60",
  stageCap4: "",
  stageCap5: "",
};

export function buildCsvTemplateRows(): { headers: string[]; example: string[] } {
  const allColumns = [...CSV_COLUMNS, ...AD_CSV_COLUMNS];
  return {
    headers: ["Periodo", ...allColumns.map(({ header }) => header)],
    example: [
      CSV_TEMPLATE_EXAMPLE_VALUES.period,
      ...allColumns.map(({ key }) => CSV_TEMPLATE_EXAMPLE_VALUES[key] ?? ""),
    ],
  };
}

const CSV_AD_STRING_KEYS = new Set<string>(AD_STRING_KEYS);

export interface ParsedRow {
  period: string;
  [key: string]: string;
}

function norm(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const LABEL_TO_KEY: Record<string, string> = {};
for (const col of CSV_COLUMNS) {
  LABEL_TO_KEY[norm(col.header)] = col.key;
  LABEL_TO_KEY[norm(col.key)] = col.key;
}
for (const col of AD_CSV_COLUMNS) {
  LABEL_TO_KEY[norm(col.header)] = `ad_${col.key}`;
}

type ParsedCsvLine =
  | { cells: string[]; error?: undefined }
  | { cells: null; error: string };

type CsvRecord = {
  text: string;
  startLine: number;
};

function parseCsvLine(line: string, sep: string): ParsedCsvLine {
  const cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let quoted = false;
  let closedQuote = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
          closedQuote = true;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === sep) {
      cells.push(quoted ? cell : cell.trim());
      cell = "";
      quoted = false;
      closedQuote = false;
      continue;
    }

    if (char === '"') {
      if (closedQuote) {
        return {
          cells: null,
          error: "caractere inesperado depois de um campo entre aspas",
        };
      }
      if (cell.trim() !== "") {
        return {
          cells: null,
          error: "aspas só podem iniciar um campo",
        };
      }
      cell = "";
      inQuotes = true;
      quoted = true;
      continue;
    }

    if (closedQuote) {
      if (!/\s/.test(char)) {
        return {
          cells: null,
          error: "caractere inesperado depois de um campo entre aspas",
        };
      }
      continue;
    }

    cell += char;
  }

  if (inQuotes) {
    return {
      cells: null,
      error: "campo entre aspas não terminado",
    };
  }

  cells.push(quoted ? cell : cell.trim());
  return { cells };
}

function splitCsvRecords(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let record = "";
  let startLine = 1;
  let line = 1;
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === "\n") {
      if (inQuotes) {
        record += "\n";
        line++;
        continue;
      }

      records.push({ text: record, startLine });
      record = "";
      line++;
      startLine = line;
      continue;
    }

    record += char;

    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        record += text[++i];
      } else {
        inQuotes = !inQuotes;
      }
    }
  }

  if (record !== "") records.push({ text: record, startLine });
  return records;
}

export function parseCsv(text: string): { rows: ParsedRow[]; errors: string[] } {
  const normalizedText = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const firstLine = normalizedText
    .split("\n")
    .find((line) => line.trim() && !line.trim().startsWith("#"));

  if (!firstLine) return { rows: [], errors: ["Arquivo vazio ou sem dados além do cabeçalho."] };

  const sep = firstLine.includes(";") ? ";" : ",";
  const records = splitCsvRecords(normalizedText).filter(
    ({ text: record }) => record.trim() && !record.trim().startsWith("#"),
  );

  if (records.length < 2) return { rows: [], errors: ["Arquivo vazio ou sem dados além do cabeçalho."] };

  const headerResult = parseCsvLine(records[0].text, sep);
  if (!headerResult.cells) {
    return { rows: [], errors: [`Cabeçalho inválido: ${headerResult.error}.`] };
  }
  const rawHeaders = headerResult.cells;

  const periodIdx = rawHeaders.findIndex((h) => {
    const n = norm(h);
    return n === "periodo" || n === "period";
  });
  if (periodIdx === -1) {
    return {
      rows: [],
      errors: ['Coluna "Periodo" não encontrada. Verifique se está usando o modelo correto.'],
    };
  }

  const colKeyMap: Record<number, string> = {};
  rawHeaders.forEach((h, idx) => {
    const key = LABEL_TO_KEY[norm(h)];
    if (key) colKeyMap[idx] = key;
  });

  const rows: ParsedRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < records.length; i++) {
    const { text: record, startLine } = records[i];
    const lineResult = parseCsvLine(record, sep);
    if (!lineResult.cells) {
      errors.push(`Linha ${startLine}: ${lineResult.error}; linha ignorada`);
      continue;
    }
    const cells = lineResult.cells;
    if (cells.length > rawHeaders.length) {
      errors.push(
        `Linha ${startLine}: número de colunas maior que o cabeçalho (${cells.length} em vez de ${rawHeaders.length}); linha ignorada`,
      );
      continue;
    }
    const period = cells[periodIdx];
    if (!period) {
      errors.push(`Linha ${startLine}: período vazio, ignorada`);
      continue;
    }

    const row: ParsedRow = { period };
    for (const [idxStr, key] of Object.entries(colKeyMap)) {
      const idx = Number(idxStr);
      const raw = cells[idx];
      if (raw !== undefined && raw !== "") {
        if (key.startsWith("ad_") && CSV_AD_STRING_KEYS.has(key.slice(3))) {
          row[key] = raw;
          continue;
        }
        const val = raw.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
        if (val !== "" && !isNaN(Number(val))) row[key] = val;
      }
    }
    rows.push(row);
  }

  return { rows, errors };
}

export function buildImportRows(parsed: ParsedRow[]): Record<string, unknown>[] {
  return parsed.map((r) => {
    const row: Record<string, unknown> = { period: r.period };
    for (const { key } of CSV_COLUMNS) {
      if (r[key] !== undefined) row[key] = Number(r[key]);
    }

    const derived = deriveFinancialValues({
      grossRevenue: finiteNumber(row.grossRevenue),
      deductions: finiteNumber(row.deductions),
      netRevenue: finiteNumber(row.netRevenue),
      cogs: finiteNumber(row.cogs),
      fixedCosts: finiteNumber(row.fixedCosts),
      variableCosts: finiteNumber(row.variableCosts),
      depreciationAmortization: finiteNumber(row.depreciationAmortization),
    });
    if (!Number.isNaN(derived.net)) row.netRevenue = derived.net;
    if (!Number.isNaN(derived.grossProfit)) row.grossProfit = derived.grossProfit;
    if (!Number.isNaN(derived.ebitda)) row.ebitda = derived.ebitda;

    const additionalData: Record<string, unknown> = {};
    for (const { key } of AD_CSV_COLUMNS) {
      const val = r[`ad_${key}`];
      if (val !== undefined && val !== "") {
        additionalData[key] = CSV_AD_STRING_KEYS.has(key) ? val : Number(val);
      }
    }
    if (Object.keys(additionalData).length > 0) row.additionalData = additionalData;
    return row;
  });
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
}
