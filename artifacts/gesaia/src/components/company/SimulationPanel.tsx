import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRunSimulation, useCreateSimulation, SimulationRunRequestType, SimulationInputType } from "@workspace/api-client-react";
import {
  FlaskConical, Loader2, Play, Save, ChevronDown, ChevronUp,
  TrendingUp, DollarSign, Users, Target, Network, Megaphone,
  Settings, Shield, Lightbulb, Globe, BarChart3, ChevronRight,
  Sparkles, SendHorizonal, Trash2, Compass,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

/* ─── Type catalogue ───────────────────────────────────────────────────── */
type SimDef = {
  value: SimulationRunRequestType;
  label: string;
  description: string;
  icon: any;
  color: string;
  bg: string;
  border: string;
};
type Category = { id: string; label: string; icon: any; color: string; sims: SimDef[] };

const C = {
  blue:   { color: "text-blue-600",   bg: "bg-blue-50 dark:bg-blue-900/20",   border: "border-blue-200 dark:border-blue-800" },
  green:  { color: "text-emerald-600",bg: "bg-emerald-50 dark:bg-emerald-900/20", border: "border-emerald-200 dark:border-emerald-800" },
  violet: { color: "text-violet-600", bg: "bg-violet-50 dark:bg-violet-900/20",   border: "border-violet-200 dark:border-violet-800" },
  orange: { color: "text-orange-600", bg: "bg-orange-50 dark:bg-orange-900/20",   border: "border-orange-200 dark:border-orange-800" },
  pink:   { color: "text-pink-600",   bg: "bg-pink-50 dark:bg-pink-900/20",   border: "border-pink-200 dark:border-pink-800" },
  red:    { color: "text-red-600",    bg: "bg-red-50 dark:bg-red-900/20",     border: "border-red-200 dark:border-red-800" },
  yellow: { color: "text-yellow-600", bg: "bg-yellow-50 dark:bg-yellow-900/20",   border: "border-yellow-200 dark:border-yellow-800" },
  teal:   { color: "text-teal-600",   bg: "bg-teal-50 dark:bg-teal-900/20",   border: "border-teal-200 dark:border-teal-800" },
  indigo: { color: "text-indigo-600", bg: "bg-indigo-50 dark:bg-indigo-900/20",   border: "border-indigo-200 dark:border-indigo-800" },
  rose:   { color: "text-rose-600",   bg: "bg-rose-50 dark:bg-rose-900/20",   border: "border-rose-200 dark:border-rose-800" },
};

const CATALOG: Category[] = [
  {
    id: "financial", label: "Financeiro", icon: TrendingUp, color: "text-blue-600",
    sims: [
      { value: "dre",              label: "DRE — Demonstrativo",        description: "Projete receita, custos e margens para um cenário futuro",                 icon: TrendingUp, ...C.blue },
      { value: "price",            label: "Formação de Preço",          description: "Calcule o preço mínimo por markup dado custo e margem desejada",           icon: DollarSign, ...C.blue },
      { value: "price_elasticity", label: "Elasticidade Preço × Volume",description: "Aumentar preço X% e perder Y% dos clientes é vantajoso? Qual o limite?",   icon: BarChart3,  ...C.rose },
      { value: "discount_impact",  label: "Impacto de Desconto",        description: "Quanto o volume precisa crescer para compensar um desconto dado?",          icon: DollarSign, ...C.orange },
      { value: "discount_compensation_customers", label: "Novos Clientes para Compensar Desconto", description: "Quantos novos clientes (1 unidade cada, com CAC) são necessários para manter o lucro após aplicar desconto?", icon: Users, ...C.orange },
      { value: "max_discount",     label: "Desconto Máximo Viável",     description: "Até onde pode descontar sem sair da margem mínima aceitável?",              icon: DollarSign, ...C.orange },
      { value: "revenue_target",   label: "Meta de Receita",            description: "Quanto crescer para atingir uma margem-alvo (%) ou lucro-alvo (R$)?",       icon: Target,     ...C.green },
      { value: "hire_impact",      label: "Impacto de Contratação",     description: "Nova contratação melhora ou piora o resultado? Em quanto tempo se paga?",   icon: Users,      ...C.violet },
      { value: "free_scenario",    label: "Cenário Livre",              description: "Simule qualquer combinação de mudança em receita, CMV e custo fixo",         icon: FlaskConical,...C.indigo },
      { value: "fixed_cost_coverage", label: "Venda Adicional para Cobrir Custo Fixo", description: "Quanto a mais preciso vender para manter o lucro após aumentar meu custo fixo em R$ X?", icon: TrendingUp, ...C.teal },
      { value: "growth_capital",    label: "Capital de Giro para Crescimento", description: "Quanto capital adicional será necessário para sustentar um crescimento planejado de receita?", icon: TrendingUp, ...C.teal },
      { value: "working_capital",  label: "Renegociação de Prazos",     description: "Impacto no capital de giro de renegociar PMR, PMP e PME com clientes/fornecedores", icon: BarChart3, ...C.teal },
      { value: "pro_labore_target",label: "Viabilizar Pró-labore",      description: "Quanto crescer a receita (ou cortar custo) para pagar o pró-labore desejado?", icon: DollarSign,...C.green },
    ],
  },
  {
    id: "commercial", label: "Comercial", icon: Target, color: "text-emerald-600",
    sims: [
      { value: "funnel",            label: "Funil de Vendas",          description: "Projete clientes e receita a partir de leads, conversão e ticket médio",     icon: Target,     ...C.green },
      { value: "funnel_stage",      label: "Melhoria de Etapa do Funil",description: "Simule o efeito de melhorar a conversão em uma etapa específica do funil",  icon: Target,     ...C.green },
      { value: "ticket_impact",     label: "Impacto do Ticket Médio",  description: "Como variações no ticket médio afetam a receita com a carteira atual?",      icon: DollarSign, ...C.blue },
      { value: "sales_team_sizing", label: "Dimensionamento de Equipe Comercial", description: "Quantos vendedores são necessários para atingir uma meta de receita?", icon: Users, ...C.violet },
    ],
  },
  {
    id: "marketing", label: "Marketing", icon: Megaphone, color: "text-violet-600",
    sims: [
      { value: "marketing_funnel",     label: "Funil de Marketing",         description: "Impressões → cliques → leads → vendas: calcule CAC e ROAS do funil completo",   icon: Megaphone, ...C.violet },
      { value: "channel_metrics",      label: "Métricas de Canal",          description: "CPL, CAC, ROAS e ROI de um canal de aquisição a partir do investimento",          icon: BarChart3,  ...C.violet },
      { value: "ltv_cac",              label: "LTV / CAC",                  description: "Razão LTV × CAC — o cliente vale mais do que custou adquirir?",                   icon: DollarSign, ...C.green },
      { value: "budget_reallocation",  label: "Redistribuição de Budget",   description: "Compare CAC entre canais e veja quanto ganhar concentrando o budget no melhor",   icon: Megaphone,  ...C.indigo },
    ],
  },
  {
    id: "operations", label: "Operações", icon: Settings, color: "text-orange-600",
    sims: [
      { value: "bottleneck",           label: "Gargalo de Processo",        description: "Identifique o gargalo e simule o efeito de melhorar uma etapa específica",        icon: Settings,   ...C.orange },
      { value: "capacity_utilization", label: "Capacidade Instalada",       description: "Utilização atual vs. máxima — qual a receita perdida por capacidade ociosa?",     icon: BarChart3,  ...C.orange },
      { value: "oee",                  label: "OEE — Eficiência Global",    description: "Overall Equipment Effectiveness: disponibilidade × performance × qualidade",       icon: Settings,   ...C.orange },
      { value: "ops_metric_improvement",label: "Melhoria de Métrica Operacional", description: "Simule o impacto financeiro de melhorar tempo de ciclo, retrabalho ou outra métrica", icon: TrendingUp,...C.yellow },
    ],
  },
  {
    id: "hr", label: "RH", icon: Users, color: "text-pink-600",
    sims: [
      { value: "turnover",          label: "Custo de Turnover",          description: "Custo total anual da rotatividade (rescisão + recrutamento + rampagem)",             icon: Users,      ...C.pink },
      { value: "retention_program", label: "Programa de Retenção",       description: "Um programa de retenção de talentos se paga? Qual o payback?",                       icon: Users,      ...C.pink },
      { value: "workforce_sizing",  label: "Dimensionamento de Equipe",  description: "Quantos colaboradores são necessários para cobrir a carga de trabalho?",             icon: Users,      ...C.violet },
      { value: "training_roi",      label: "ROI de Treinamento",         description: "Calcule o retorno financeiro e o payback de um programa de capacitação",             icon: TrendingUp, ...C.green },
    ],
  },
  {
    id: "risks", label: "Riscos", icon: Shield, color: "text-red-600",
    sims: [
      { value: "risk_matrix",          label: "Matriz de Risco",            description: "Classifique um risco pela Matriz Probabilidade × Impacto (escala 1–5)",            icon: Shield,     ...C.red },
      { value: "risk_expected_loss",   label: "Perda Esperada",             description: "Valor esperado de perda de um risco — e se vale a pena mitigar",                  icon: DollarSign, ...C.red },
      { value: "risk_response",        label: "Estratégias de Resposta",    description: "Compare Aceitar / Reduzir / Transferir / Evitar pelo menor custo total",           icon: Shield,     ...C.orange },
      { value: "risk_prioritization",  label: "Priorização de Riscos",      description: "Ranqueie até 5 riscos pela exposição financeira (perda esperada)",                icon: BarChart3,  ...C.red },
    ],
  },
  {
    id: "market", label: "Mercado", icon: Globe, color: "text-teal-600",
    sims: [
      { value: "competitive_gap", label: "Gap Competitivo",             description: "Distância entre a empresa e o benchmark de mercado, indicador a indicador",            icon: Globe,      ...C.teal },
      { value: "market_share",    label: "Participação de Mercado",     description: "Market share atual e receita necessária para atingir uma fatia-alvo",                  icon: BarChart3,  ...C.teal },
      { value: "market_growth",   label: "Crescimento vs. Mercado",     description: "A empresa cresce acima ou abaixo do mercado? Está ganhando ou perdendo share?",        icon: TrendingUp, ...C.teal },
    ],
  },
  {
    id: "innovation", label: "Inovação", icon: Lightbulb, color: "text-yellow-600",
    sims: [
      { value: "process_automation", label: "ROI de Automação",         description: "Custo do processo manual vs. automação — payback e ROI de substituir mão de obra",    icon: Lightbulb,  ...C.yellow },
    ],
  },
  {
    id: "network_cat", label: "Rede", icon: Network, color: "text-indigo-600",
    sims: [
      { value: "network", label: "Receita da Rede",                     description: "Consolide a receita potencial de uma rede de franquias ou filiais",                   icon: Network,    ...C.indigo },
    ],
  },
  {
    id: "strategy_cat", label: "Estratégia", icon: Compass, color: "text-cyan-600",
    sims: [
      { value: "growth_scenario",       label: "Cenário de Crescimento",        description: "Projete receita, MC e resultado com uma taxa de crescimento e investimento de expansão",   icon: Compass,    ...C.teal },
      { value: "product_mix",           label: "Otimização de Mix",             description: "Impacto na margem blended ao redistribuir receita entre produtos/serviços de diferentes margens", icon: BarChart3, ...C.teal },
      { value: "break_even_new_product",label: "Viabilidade de Novo Produto",   description: "Ponto de equilíbrio de um novo produto/serviço — unidades mínimas e receita mínima mensal",  icon: Target,     ...C.teal },
    ],
  },
];

/* ─── Parameters per simulation type ──────────────────────────────────── */
type Param = { key: string; label: string; default?: string; type?: "text" | "number" | "select"; options?: string[] };
const SIM_PARAMS: Record<string, Param[]> = {
  dre: [
    { key: "grossRevenue",   label: "Receita Bruta (R$)",    default: "1000000" },
    { key: "cogs",           label: "CMV (R$)",              default: "400000" },
    { key: "fixedCosts",     label: "Custos Fixos (R$)",     default: "200000" },
    { key: "variableCosts",  label: "Outros Custos Variáveis (R$)", default: "100000" },
  ],
  price: [
    { key: "unitCost",        label: "Custo Unitário (R$)",   default: "50" },
    { key: "targetMarginPct", label: "Margem Desejada (%)",   default: "40" },
  ],
  price_elasticity: [
    { key: "currentRevenue",   label: "Receita Atual (R$)",             default: "500000" },
    { key: "priceIncreasePct", label: "Aumento de Preço (%)",           default: "10" },
    { key: "volumeLossPct",    label: "Perda Estimada de Clientes (%)", default: "10" },
  ],
  discount_impact: [
    { key: "currentRevenue",       label: "Receita Atual (R$)",         default: "500000" },
    { key: "contributionMarginPct",label: "Margem de Contribuição (%)", default: "30" },
    { key: "discountPct",          label: "Desconto Aplicado (%)",      default: "10" },
  ],
  max_discount: [
    { key: "currentPrice",          label: "Preço Atual (R$)",          default: "100" },
    { key: "unitCost",              label: "Custo Unitário (R$)",        default: "50" },
    { key: "minAcceptableMarginPct",label: "Margem Mínima Aceitável (%)",default: "20" },
  ],
  revenue_target: [
    { key: "currentRevenue",   label: "Receita Atual (R$)",         default: "500000" },
    { key: "currentFixedCosts",label: "Custos Fixos (R$)",          default: "100000" },
    { key: "variableCostPct",  label: "% Custos Variáveis na Receita", default: "40" },
    { key: "targetMarginPct",  label: "Margem Operacional Alvo (%)", default: "15" },
    { key: "targetProfit",     label: "Lucro Alvo (R$) — opcional",  default: "0" },
  ],
  hire_impact: [
    { key: "currentRevenue",            label: "Receita Atual (R$)",              default: "500000" },
    { key: "currentProfit",             label: "Lucro Atual (R$)",                default: "50000" },
    { key: "annualSalaryCost",          label: "Custo Anual do Cargo (R$ + encargos)", default: "60000" },
    { key: "estimatedRevenueContribution", label: "Receita que ele vai gerar/ano (R$)", default: "120000" },
    { key: "variableCostPct",           label: "% Custo Variável na Receita",     default: "40" },
  ],
  free_scenario: [
    { key: "currentRevenue",   label: "Receita Atual (R$)",       default: "500000" },
    { key: "currentCOGS",      label: "CMV Atual (R$)",           default: "200000" },
    { key: "currentFixedCosts",label: "Custo Fixo Atual (R$)",    default: "150000" },
    { key: "revenueChangePct", label: "Δ Receita (%)",            default: "10" },
    { key: "cogsChangePct",    label: "Δ CMV (%)",                default: "0" },
    { key: "fixedChangePct",   label: "Δ Custo Fixo (%)",         default: "-5" },
  ],
  fixed_cost_coverage: [
    { key: "contributionMarginPct", label: "Margem de Contribuição — MC% (%)",               default: "40" },
    { key: "fixedCostIncrease",     label: "Aumento de Custo Fixo (R$)",                      default: "10000" },
    { key: "currentRevenue",        label: "Receita Atual (R$) — opcional, para % relativa",  default: "0" },
    { key: "unitPrice",             label: "Preço Unitário (R$) — opcional, para nº de unidades", default: "0" },
    { key: "currentVolume",         label: "Volume Atual (unidades) — opcional",              default: "0" },
  ],
  growth_capital: [
    { key: "currentRevenue",         label: "Receita Mensal Atual (R$)",                  default: "300000" },
    { key: "plannedGrowthPct",       label: "Crescimento Planejado (%)",                  default: "30" },
    { key: "pmr",                    label: "PMR — Prazo Médio de Recebimento (dias)",    default: "30" },
    { key: "pme",                    label: "PME — Prazo Médio de Estoque (dias)",        default: "15" },
    { key: "pmp",                    label: "PMP — Prazo Médio de Pagamento (dias)",      default: "30" },
    { key: "variableCostPct",        label: "% Custo Variável na Receita",                default: "40" },
    { key: "annualFinancingRatePct", label: "Taxa de Juros do Financiamento (%/ano) — opcional", default: "0" },
    { key: "newPmr",                 label: "Novo PMR com Crescimento (dias) — opcional (0 = mantém)", default: "0" },
    { key: "newPme",                 label: "Novo PME com Crescimento (dias) — opcional (0 = mantém)", default: "0" },
    { key: "newPmp",                 label: "Novo PMP com Crescimento (dias) — opcional (0 = mantém)", default: "0" },
  ],
  working_capital: [
    { key: "monthlyRevenue",  label: "Receita Mensal (R$)",     default: "500000" },
    { key: "monthlyPurchases",label: "Compras Mensais (R$)",    default: "200000" },
    { key: "currentPMR",      label: "PMR Atual (dias)",        default: "30" },
    { key: "newPMR",          label: "Novo PMR (dias)",         default: "20" },
    { key: "currentPMP",      label: "PMP Atual (dias)",        default: "30" },
    { key: "newPMP",          label: "Novo PMP (dias)",         default: "45" },
    { key: "currentPME",      label: "PME Atual (dias)",        default: "15" },
    { key: "newPME",          label: "Novo PME (dias)",         default: "10" },
  ],
  pro_labore_target: [
    { key: "currentRevenue",   label: "Receita Atual (R$)",             default: "300000" },
    { key: "contributionMarginPct", label: "Margem de Contribuição (%)",default: "30" },
    { key: "currentFixedCosts",label: "Custos Fixos sem Pró-labore (R$)", default: "60000" },
    { key: "currentProLabore", label: "Pró-labore Atual (R$)",          default: "5000" },
    { key: "targetProLabore",  label: "Pró-labore Desejado (R$)",       default: "15000" },
  ],
  funnel: [
    { key: "leads",          label: "Leads / mês",          default: "1000" },
    { key: "conversionRate", label: "Taxa de Conversão (%)", default: "5" },
    { key: "averageTicket",  label: "Ticket Médio (R$)",     default: "500" },
  ],
  funnel_stage: [
    { key: "monthlyLeads",     label: "Leads / mês",                   default: "500" },
    { key: "stage1ConvPct",    label: "Conv. Etapa 1 — Leads→Propostas (%)", default: "40" },
    { key: "stage2ConvPct",    label: "Conv. Etapa 2 — Propostas→Neg. (%)", default: "30" },
    { key: "stage3ConvPct",    label: "Conv. Etapa 3 — Neg.→Fechamento (%)", default: "50" },
    { key: "averageTicket",    label: "Ticket Médio (R$)",             default: "1000" },
    { key: "improveStage",     label: "Etapa a melhorar (1, 2 ou 3)", default: "1", type: "text" },
    { key: "improvementPct",   label: "Melhoria na conversão (%)",    default: "20" },
  ],
  ticket_impact: [
    { key: "activeClients",  label: "Clientes Ativos",        default: "200" },
    { key: "currentTicket",  label: "Ticket Atual (R$)",      default: "500" },
    { key: "newTicket",      label: "Ticket Projetado (R$)",  default: "600" },
  ],
  sales_team_sizing: [
    { key: "revenueTarget",          label: "Meta de Receita/mês (R$)",       default: "500000" },
    { key: "avgSaleValue",           label: "Valor Médio de Venda (R$)",       default: "2500" },
    { key: "closingsPerSalesperson", label: "Fechamentos/Vendedor/mês",         default: "10" },
  ],
  marketing_funnel: [
    { key: "impressions",    label: "Impressões / mês",         default: "100000" },
    { key: "ctrPct",         label: "CTR (%)",                  default: "3" },
    { key: "landingConvPct", label: "Conv. Landing Page (%)",   default: "20" },
    { key: "salesConvPct",   label: "Conv. Lead → Venda (%)",   default: "5" },
    { key: "averageTicket",  label: "Ticket Médio (R$)",        default: "500" },
    { key: "adSpend",        label: "Investimento em Anúncios (R$)", default: "5000" },
  ],
  channel_metrics: [
    { key: "adSpend", label: "Investimento (R$)",   default: "5000" },
    { key: "clicks",  label: "Cliques",             default: "2000" },
    { key: "leads",   label: "Leads gerados",       default: "400" },
    { key: "sales",   label: "Vendas realizadas",   default: "20" },
    { key: "avgTicket", label: "Ticket Médio (R$)", default: "500" },
  ],
  ltv_cac: [
    { key: "avgMonthlyTicket",  label: "Ticket Médio Mensal (R$)",  default: "200" },
    { key: "avgLifespanMonths", label: "Vida Média do Cliente (meses)", default: "18" },
    { key: "cac",               label: "CAC (R$)",                  default: "500" },
  ],
  budget_reallocation: [
    { key: "channel1Budget", label: "Budget — Canal 1 (R$)",   default: "3000" },
    { key: "channel1CAC",    label: "CAC — Canal 1 (R$)",      default: "150" },
    { key: "channel2Budget", label: "Budget — Canal 2 (R$)",   default: "2000" },
    { key: "channel2CAC",    label: "CAC — Canal 2 (R$)",      default: "250" },
    { key: "channel3Budget", label: "Budget — Canal 3 (R$) — opcional", default: "0" },
    { key: "channel3CAC",    label: "CAC — Canal 3 (R$) — opcional",    default: "0" },
  ],
  bottleneck: [
    { key: "stage1Capacity", label: "Capacidade Etapa 1 (unid./período)", default: "100" },
    { key: "stage2Capacity", label: "Capacidade Etapa 2 (unid./período)", default: "80" },
    { key: "stage3Capacity", label: "Capacidade Etapa 3 (unid./período)", default: "120" },
    { key: "currentDemand",  label: "Demanda Atual (unid./período)",      default: "90" },
  ],
  capacity_utilization: [
    { key: "maxCapacity",      label: "Capacidade Máxima (unid.)",    default: "1000" },
    { key: "currentProduction",label: "Produção Atual (unid.)",       default: "650" },
    { key: "revenuePerUnit",   label: "Receita por Unidade (R$)",     default: "100" },
  ],
  oee: [
    { key: "availabilityPct", label: "Disponibilidade (%)", default: "90" },
    { key: "performancePct",  label: "Performance (%)",     default: "85" },
    { key: "qualityPct",      label: "Qualidade (%)",       default: "95" },
  ],
  ops_metric_improvement: [
    { key: "currentMetricValue",    label: "Valor Atual da Métrica",         default: "120" },
    { key: "targetMetricValue",     label: "Valor Meta da Métrica",          default: "90" },
    { key: "revenueImpactPerUnit",  label: "Impacto em Receita por Unidade (R$)", default: "500" },
  ],
  turnover: [
    { key: "employees",    label: "Nº de Colaboradores",         default: "50" },
    { key: "turnoverRate", label: "Taxa de Turnover (%/ano)",    default: "20" },
    { key: "costPerHire",  label: "Custo de Contratação (R$)",   default: "5000" },
    { key: "avgSalary",    label: "Salário Médio Mensal (R$)",   default: "3000" },
  ],
  retention_program: [
    { key: "employees",                     label: "Nº de Colaboradores",            default: "50" },
    { key: "turnoverRate",                  label: "Taxa de Turnover (%/ano)",       default: "25" },
    { key: "costPerHire",                   label: "Custo de Contratação (R$)",      default: "5000" },
    { key: "annualProgramCost",             label: "Custo Anual do Programa (R$)",   default: "30000" },
    { key: "expectedRetentionImprovementPct",label: "Melhoria de Retenção Esperada (%)", default: "30" },
  ],
  workforce_sizing: [
    { key: "totalMonthlyWorkloadHours", label: "Horas de Trabalho/mês no Total", default: "5000" },
    { key: "productiveHoursPerEmployee",label: "Horas Produtivas/Colaborador/mês",default: "160" },
    { key: "currentEmployees",          label: "Colaboradores Atuais",            default: "30" },
  ],
  training_roi: [
    { key: "trainingCost",       label: "Custo do Treinamento (R$)",       default: "20000" },
    { key: "employees",          label: "Nº de Colaboradores Treinados",   default: "20" },
    { key: "avgMonthlySalary",   label: "Salário Médio Mensal (R$)",        default: "3000" },
    { key: "productivityGainPct",label: "Ganho de Produtividade Esperado (%)", default: "10" },
    { key: "benefitDurationMonths", label: "Duração do Benefício (meses)", default: "12" },
  ],
  risk_matrix: [
    { key: "probability", label: "Probabilidade (1 a 5)", default: "3" },
    { key: "impact",      label: "Impacto (1 a 5)",       default: "4" },
  ],
  risk_expected_loss: [
    { key: "probabilityPct", label: "Probabilidade (%)",    default: "20" },
    { key: "maxLoss",        label: "Perda Máxima (R$)",    default: "100000" },
    { key: "mitigationCost", label: "Custo de Mitigação (R$) — opcional", default: "10000" },
  ],
  risk_response: [
    { key: "expectedLoss",    label: "Perda Esperada (R$)",            default: "50000" },
    { key: "reduceCost",      label: "Custo de Reduzir (R$)",          default: "15000" },
    { key: "reduceResidualLoss", label: "Perda Residual após Reduzir (R$)", default: "10000" },
    { key: "transferCost",    label: "Custo de Transferir/Seguro (R$)", default: "8000" },
    { key: "avoidCost",       label: "Custo de Evitar a Atividade (R$)", default: "30000" },
  ],
  risk_prioritization: [
    { key: "risk1Name",           label: "Risco 1 — Nome",          default: "Inadimplência", type: "text" },
    { key: "risk1ProbabilityPct", label: "Risco 1 — Probabilidade (%)", default: "30" },
    { key: "risk1MaxLoss",        label: "Risco 1 — Perda Máx (R$)",   default: "80000" },
    { key: "risk2Name",           label: "Risco 2 — Nome",          default: "Perda de Fornecedor", type: "text" },
    { key: "risk2ProbabilityPct", label: "Risco 2 — Probabilidade (%)", default: "15" },
    { key: "risk2MaxLoss",        label: "Risco 2 — Perda Máx (R$)",   default: "200000" },
    { key: "risk3Name",           label: "Risco 3 — Nome (opcional)", default: "", type: "text" },
    { key: "risk3ProbabilityPct", label: "Risco 3 — Probabilidade (%)", default: "0" },
    { key: "risk3MaxLoss",        label: "Risco 3 — Perda Máx (R$)",   default: "0" },
  ],
  competitive_gap: [
    { key: "companyValue",   label: "Valor da Empresa no Indicador", default: "35" },
    { key: "benchmarkValue", label: "Valor do Benchmark / Mercado",  default: "45" },
    { key: "higherIsBetter", label: "Maior = melhor? (true/false)",  default: "true", type: "text" },
  ],
  market_share: [
    { key: "companyRevenue",    label: "Receita da Empresa (R$)",   default: "2000000" },
    { key: "totalMarketRevenue",label: "Receita Total do Mercado (R$)", default: "50000000" },
    { key: "targetSharePct",    label: "Market Share Alvo (%)",     default: "10" },
  ],
  market_growth: [
    { key: "companyGrowthPct", label: "Crescimento da Empresa (%/ano)", default: "12" },
    { key: "marketGrowthPct",  label: "Crescimento do Mercado (%/ano)", default: "8" },
  ],
  process_automation: [
    { key: "hourlyRate",             label: "Custo Hora do Colaborador (R$)", default: "30" },
    { key: "hoursPerMonth",          label: "Horas/mês no Processo Manual",   default: "80" },
    { key: "errorRatePct",           label: "Taxa de Erro (%)",               default: "5" },
    { key: "costPerError",           label: "Custo por Erro (R$)",            default: "200" },
    { key: "automationCost",         label: "Custo de Implantação (R$)",      default: "15000" },
    { key: "monthlyMaintenanceCost", label: "Manutenção Mensal (R$)",         default: "500" },
  ],
  network: [
    { key: "units",          label: "Nº de Unidades",               default: "10" },
    { key: "avgUnitRevenue", label: "Receita Média / Unidade (R$)", default: "200000" },
  ],
  growth_scenario: [
    { key: "currentRevenue",         label: "Receita Atual (R$)",                     default: "500000" },
    { key: "targetGrowthPct",        label: "Crescimento Esperado (%)",               default: "20" },
    { key: "contributionMarginPct",  label: "Margem de Contribuição Atual (%)",       default: "35" },
    { key: "currentFixedCosts",      label: "Custos Fixos Atuais (R$)",              default: "100000" },
    { key: "expansionInvestment",    label: "Investimento Único de Expansão (R$)",    default: "50000" },
    { key: "expansionFixedCostPct",  label: "Aumento nos Custos Fixos pela Expansão (%)", default: "10" },
  ],
  product_mix: [
    { key: "totalRevenue",          label: "Receita Total (R$)",                     default: "500000" },
    { key: "productARevenuePct",    label: "Participação Atual — Produto A (%)",     default: "60" },
    { key: "productAMarginPct",     label: "Margem de Contribuição — Produto A (%)", default: "45" },
    { key: "productBMarginPct",     label: "Margem de Contribuição — Produto B (%)", default: "20" },
    { key: "newProductARevenuePct", label: "Nova Participação — Produto A (%)",      default: "75" },
  ],
  break_even_new_product: [
    { key: "newProductPrice",      label: "Preço de Venda Unitário (R$)",      default: "150" },
    { key: "newProductUnitCost",   label: "Custo Unitário (R$)",               default: "60" },
    { key: "newProductFixedCosts", label: "Custos Fixos do Novo Produto (R$)", default: "30000" },
    { key: "targetMonths",         label: "Prazo para Cobrir Custos (meses)",  default: "12" },
  ],
  discount_compensation_customers: [
    { key: "currentPrice",       label: "Preço de Venda Unitário Atual (R$)",          default: "100" },
    { key: "unitVariableCost",   label: "Custo Variável Unitário / CMV (R$)",          default: "40" },
    { key: "currentVolume",      label: "Volume Atual — Unidades Vendidas por Período", default: "500" },
    { key: "discountPct",        label: "Desconto Aplicado (%)",                        default: "20" },
    { key: "cacPerCustomer",     label: "CAC por Novo Cliente (R$)",                   default: "10" },
    { key: "currentFixedCosts",  label: "Custos Fixos Totais por Período (R$)",        default: "15000" },
  ],
};

/* ─── Output label map ─────────────────────────────────────────────────── */
const SKIP_KEYS = new Set(["insight", "verdict", "strategyCostRanking", "prioritizedList", "priceVsVolume", "ranked"]);
const BOOL_KEYS = new Set(["isAdvantageous", "isWorthy", "isMitigationWorthy", "isAheadOfBenchmark", "isGainingShare"]);

const OUTPUT_LABELS: Record<string, string> = {
  grossRevenue: "Receita Bruta", grossProfit: "Lucro Bruto", ebitda: "EBITDA",
  grossMarginPct: "Margem Bruta %", ebitdaMarginPct: "Margem EBITDA %", breakEven: "Ponto de Equilíbrio (R$)",
  cogs: "CMV", fixedCosts: "Custo Fixo", variableCosts: "Custo Variável",
  suggestedPrice: "Preço Sugerido (R$)", unitCost: "Custo Unitário", marginPct: "Margem %", markupPct: "Markup %",
  currentRevenue: "Receita Atual", newRevenue: "Nova Receita", revenueDelta: "Variação (R$)", revenueDeltaPct: "Variação %",
  maxVolumeLoss: "Perda Máx. Tolerável de Clientes %",
  revenueAfterDiscount: "Receita após Desconto", revenueLoss: "Queda de Receita", currentMarginPct: "MC% Atual",
  newMarginPctAfterDiscount: "Nova MC% após Desconto", volumeIncreaseNeeded: "Volume Adicional Necessário %",
  currentPrice: "Preço Atual", minViablePrice: "Preço Mínimo Viável", maxDiscountAmount: "Desconto Máx (R$)", maxDiscountPct: "Desconto Máx %",
  currentProfit: "Lucro Atual", currentMargin: "Margem Atual %",
  revenueNeededForMarginTarget: "Receita p/ Margem Alvo (R$)", growthPctForMarginTarget: "Crescimento Necessário %",
  revenueNeededForProfitTarget: "Receita p/ Lucro Alvo (R$)", growthPctForProfitTarget: "Crescimento Necessário %",
  annualSalaryCost: "Custo Anual do Cargo", estimatedRevenueContribution: "Receita Gerada/ano",
  monthlySalaryCost: "Custo Mensal", monthlyRevenueContribution: "Receita Mensal Gerada",
  monthlyNetImpact: "Impacto Líquido/mês", breakEvenMonths: "Payback (meses)",
  currentCOGS: "CMV Atual", newCOGS: "Novo CMV", currentFixedCosts: "Custo Fixo Atual", newFixedCosts: "Novo Custo Fixo",
  profitDelta: "Variação no Lucro", newMarginPct: "Nova Margem %",
  currentPMR: "PMR Atual (dias)", newPMR: "Novo PMR (dias)", currentPMP: "PMP Atual (dias)", newPMP: "Novo PMP (dias)",
  currentPME: "PME Atual (dias)", newPME: "Novo PME (dias)",
  currentWorkingCapitalNeed: "NCG Atual (R$)", newWorkingCapitalNeed: "Nova NCG (R$)", cashReleased: "Caixa Liberado/Imobilizado (R$)",
  currentProLabore: "Pró-labore Atual", targetProLabore: "Pró-labore Desejado", monthlyGap: "Gap Mensal (R$)",
  optionA_RevenueNeeded: "Receita Necessária (Opção A)", optionA_RevenueGrowthPct: "Crescimento % (Opção A)",
  optionB_FixedCostCutNeeded: "Corte de Custo Necessário (Opção B)",
  leads: "Leads", customers: "Clientes Convertidos", revenue: "Receita Projetada",
  conversionRate: "Taxa de Conversão %", averageTicket: "Ticket Médio",
  currentCustomers: "Clientes Atuais", currentRevenueFunnel: "Receita Atual",
  newCustomers: "Clientes Novos Cenário", newRevenueFunnel: "Nova Receita", revenueGain: "Ganho de Receita",
  improvementApplied: "Melhoria Aplicada %", improvedStage: "Etapa Melhorada",
  activeClients: "Clientes Ativos", currentTicket: "Ticket Atual", newTicket: "Novo Ticket",
  revenueTarget: "Meta de Receita", avgSaleValue: "Venda Média", closingsPerSalesperson: "Fechamentos/Vendedor",
  salesNeededPerMonth: "Vendas Necessárias/mês", salespeopleNeeded: "Vendedores Necessários", avgSalespersonRevenue: "Receita/Vendedor",
  impressions: "Impressões", ctrPct: "CTR %", clicks: "Cliques",
  landingConvPct: "Conv. Landing %", salesConvPct: "Conv. → Venda %", sales: "Vendas",
  adSpend: "Investimento em Anúncios", cac: "CAC (R$)", roas: "ROAS", roi: "ROI %", cpl: "CPL (R$)", ctr: "CTR",
  avgMonthlyTicket: "Ticket Médio Mensal", avgLifespanMonths: "Vida Média (meses)", ltv: "LTV (R$)",
  ltvCacRatio: "LTV / CAC", classification: "Classificação", paybackMonths: "Payback (meses)",
  totalBudget: "Budget Total", currentTotalClients: "Clientes Atuais", currentAvgCAC: "CAC Médio Atual",
  bestChannel: "Melhor Canal", bestChannelCAC: "CAC do Melhor Canal", optimizedClients: "Clientes Otimizados", clientsGain: "Ganho de Clientes",
  stage1Capacity: "Etapa 1 Cap.", stage2Capacity: "Etapa 2 Cap.", stage3Capacity: "Etapa 3 Cap.",
  currentDemand: "Demanda Atual", bottleneckStage: "Gargalo", bottleneckCapacity: "Cap. do Gargalo",
  actualOutput: "Output Atual", utilizationPct: "Utilização %", unmetDemand: "Demanda não Atendida",
  outputWith20PctImprovement: "Output c/ Melhoria de 20%", demandGain: "Ganho de Output",
  maxCapacity: "Capacidade Máxima", currentProduction: "Produção Atual",
  idleCapacity: "Capacidade Ociosa", idleCapacityPct: "Ociosidade %",
  revenuePerUnit: "Receita/Unidade", potentialRevenueFromFullCapacity: "Receita Potencial Ociosa",
  availabilityPct: "Disponibilidade %", performancePct: "Performance %", qualityPct: "Qualidade %",
  oee: "OEE %", gapToWorldClass: "Gap p/ Classe Mundial %",
  currentMetricValue: "Valor Atual", targetMetricValue: "Valor Meta",
  improvementAbsolute: "Melhoria Absoluta", improvementPct: "Melhoria %", revenueImpact: "Impacto Receita (R$)",
  employees: "Colaboradores", turnoverRatePct: "Turnover %", costPerHire: "Custo/Contratação",
  avgSalary: "Salário Médio", costPerTurnoverEvent: "Custo/Evento de Turnover",
  annualTurnoverCost: "Custo Anual de Turnover", monthlyTurnoverCost: "Custo Mensal de Turnover",
  currentAnnualTurnoverCost: "Custo Turnover Atual/ano", expectedRetentionImprovementPct: "Melhoria de Retenção %",
  newTurnoverRatePct: "Nova Taxa de Turnover %", newAnnualTurnoverCost: "Novo Custo Turnover/ano",
  annualProgramCost: "Custo do Programa/ano", annualSavings: "Economia Anual", netAnnualBenefit: "Benefício Líquido/ano",
  totalMonthlyWorkloadHours: "Horas Totais/mês", productiveHoursPerEmployee: "Horas/Colaborador",
  employeesNeeded: "Colaboradores Necessários", currentEmployees: "Colaboradores Atuais", surplus: "Saldo (excedente/falta)",
  trainingCost: "Custo do Treinamento", avgMonthlySalary: "Salário Médio Mensal",
  productivityGainPct: "Ganho de Produtividade %", monthlyProductivityGain: "Ganho Mensal",
  totalGainOverPeriod: "Ganho Total no Período", annualROI: "ROI Anual %",
  probability: "Probabilidade (1–5)", impact: "Impacto (1–5)", riskScore: "Score de Risco",
  riskLevel: "Nível de Risco", priorityAction: "Ação Recomendada",
  probabilityPct: "Probabilidade %", maxLoss: "Perda Máxima", expectedLoss: "Perda Esperada",
  mitigationCost: "Custo de Mitigação", netBenefitOfMitigation: "Benefício Líquido de Mitigar",
  reduceCost: "Custo de Reduzir", reduceResidual: "Perda Residual", transferCost: "Custo de Transferir",
  avoidCost: "Custo de Evitar", recommendedStrategy: "Estratégia Recomendada", acceptCost: "Custo de Aceitar",
  risksAnalyzed: "Riscos Analisados", highestPriorityRisk: "Prioridade #1", totalExpectedLoss: "Perda Total Esperada",
  companyValue: "Valor da Empresa", benchmarkValue: "Benchmark", gapPct: "Gap %", gapAbsolute: "Gap Absoluto",
  companyRevenue: "Receita da Empresa", totalMarketRevenue: "Mercado Total",
  currentMarketSharePct: "Market Share Atual %", targetMarketSharePct: "Market Share Alvo %",
  revenueNeededForTarget: "Receita Necessária p/ Alvo", revenueGapToTarget: "Gap de Receita",
  companyGrowthPct: "Crescimento da Empresa %", marketGrowthPct: "Crescimento do Mercado %",
  relativeGrowthPp: "Crescimento Relativo (pp)",
  hourlyRate: "Custo/Hora", hoursPerMonth: "Horas/mês Manual",
  monthlyLaborCost: "Custo Mensal de Mão de Obra", monthlyErrorCost: "Custo Mensal de Erros",
  totalMonthlyManualCost: "Custo Mensal Total Manual", automationCost: "Custo de Automação",
  monthlyMaintenanceCost: "Manutenção Mensal", monthlySavings: "Economia Mensal",
  units: "Nº de Unidades", avgUnitRevenue: "Receita Média/Unidade", networkRevenue: "Receita Total da Rede",
  // Fixed cost coverage
  fixedCostIncrease: "Aumento de Custo Fixo (R$)",
  additionalRevenueNeeded: "Receita Adicional Necessária (R$)",
  additionalUnitsNeeded: "Unidades Adicionais Necessárias",
  revenueGrowthPct: "Crescimento de Receita Necessário %",
  volumeGrowthPct: "Crescimento de Volume Necessário %",
  // Growth capital
  plannedGrowthPct: "Crescimento Planejado %", projectedRevenue: "Receita Projetada (R$)",
  cashCycleCurrent: "Ciclo de Caixa Atual (dias)",
  ncgCurrent: "NCG Atual (R$)", ncgProjected: "NCG Projetada (R$)",
  additionalCapitalNeeded: "Capital Adicional Necessário (R$)",
  annualFinancingRatePct: "Taxa de Juros % ao ano",
  monthlyCostOfCapital: "Custo Mensal do Capital (R$)", annualCostOfCapital: "Custo Anual do Capital (R$)",
  mcGain: "Contribuição Marginal Adicional (R$)",
  selfFinanceMonths: "Meses para Autofinanciar com MC",
  cashCycleOptimized: "Ciclo de Caixa Otimizado (dias)",
  ncgOptimized: "NCG com Prazos Otimizados (R$)",
  additionalCapitalOptimized: "Capital Adicional com Otimização (R$)",
  capitalSavingFromOptimization: "Economia vs Cenário Base (R$)",
  // Discount compensation
  discountApplied: "Desconto Aplicado %", newPrice: "Novo Preço Unitário (R$)",
  currentVolume: "Volume Atual (unid.)", cacPerCustomer: "CAC por Novo Cliente (R$)",
  currentUnitMargin: "Margem Unitária Atual (R$)", currentGrossMargin: "Margem Bruta Atual (R$)",
  currentNetProfit: "Lucro Líquido Atual (R$)",
  marginLossPerUnit: "Perda de Margem por Unidade (R$)", totalMarginLoss: "Rombo Total do Desconto (R$)",
  newCustomerUnitMargin: "Margem Unitária do Novo Cliente (R$)", newCustomerNetContrib: "Contribuição Líquida/Novo Cliente (R$)",
  newCustomersNeeded: "Novos Clientes Necessários", totalCACInvestment: "Investimento Total em CAC (R$)",
  afterBaseMargin: "Margem Base após Desconto (R$)", afterNetProfit: "Lucro Líquido após Compensação (R$)",
  // Strategy
  projectedMC: "MC Projetada", projectedFixedCosts: "Custo Fixo Projetado",
  projectedResult: "Resultado Projetado", currentResult: "Resultado Atual", netGain: "Ganho Líquido",
  currentProductAShare: "Participação Atual — Produto A %", currentProductBShare: "Participação Atual — Produto B %",
  newProductAShare: "Nova Participação — Produto A %", newProductBShare: "Nova Participação — Produto B %",
  currentBlendedMarginPct: "Margem Blended Atual %", newBlendedMarginPct: "Nova Margem Blended %",
  marginDeltaPp: "Variação de Margem (pp)", productAMarginPct: "MC% Produto A", productBMarginPct: "MC% Produto B",
  newProductPrice: "Preço de Venda (R$)", newProductUnitCost: "Custo Unitário (R$)",
  unitContributionMargin: "MC Unitária (R$)", newProductFixedCosts: "Custos Fixos do Produto (R$)",
  breakEvenUnits: "Ponto de Equilíbrio (unidades)", breakEvenRevenue: "Ponto de Equilíbrio (R$)",
  monthlyUnitsNeeded: "Unidades Necessárias/mês", monthlyRevenueNeeded: "Receita Mínima Mensal (R$)",
};

/* ─── Formatting helpers ───────────────────────────────────────────────── */
const BRL_KEYS = new Set(["grossRevenue","grossProfit","ebitda","breakEven","cogs","fixedCosts","variableCosts","suggestedPrice","unitCost","currentRevenue","newRevenue","revenueDelta","revenueAfterDiscount","revenueLoss","minViablePrice","maxDiscountAmount","currentPrice","currentProfit","revenueNeededForMarginTarget","revenueNeededForProfitTarget","annualSalaryCost","estimatedRevenueContribution","monthlySalaryCost","monthlyRevenueContribution","monthlyNetImpact","currentCOGS","newCOGS","currentFixedCosts","newFixedCosts","profitDelta","currentWorkingCapitalNeed","newWorkingCapitalNeed","cashReleased","currentProLabore","targetProLabore","monthlyGap","optionA_RevenueNeeded","optionB_FixedCostCutNeeded","revenue","averageTicket","currentTicket","newTicket","revenueGain","revenueTarget","avgSaleValue","avgSalespersonRevenue","adSpend","cac","cpl","ltv","totalBudget","currentAvgCAC","bestChannelCAC","revenuePerUnit","potentialRevenueFromFullCapacity","revenueImpact","costPerHire","avgSalary","costPerTurnoverEvent","annualTurnoverCost","monthlyTurnoverCost","currentAnnualTurnoverCost","newAnnualTurnoverCost","annualProgramCost","annualSavings","netAnnualBenefit","trainingCost","avgMonthlySalary","monthlyProductivityGain","totalGainOverPeriod","maxLoss","expectedLoss","mitigationCost","netBenefitOfMitigation","reduceCost","reduceResidual","transferCost","avoidCost","acceptCost","totalExpectedLoss","companyRevenue","totalMarketRevenue","revenueNeededForTarget","revenueGapToTarget","monthlyLaborCost","monthlyErrorCost","totalMonthlyManualCost","automationCost","monthlyMaintenanceCost","monthlySavings","avgUnitRevenue","networkRevenue","markupPct","projectedRevenue","projectedMC","projectedFixedCosts","projectedResult","currentResult","netGain","newProductPrice","newProductUnitCost","unitContributionMargin","newProductFixedCosts","breakEvenRevenue","monthlyRevenueNeeded","totalRevenue","newPrice","cacPerCustomer","currentUnitMargin","currentGrossMargin","currentNetProfit","marginLossPerUnit","totalMarginLoss","newCustomerUnitMargin","newCustomerNetContrib","totalCACInvestment","afterBaseMargin","afterNetProfit"]);
const PCT_KEYS = new Set(["grossMarginPct","ebitdaMarginPct","marginPct","revenueDeltaPct","maxVolumeLoss","currentMarginPct","newMarginPctAfterDiscount","volumeIncreaseNeeded","maxDiscountPct","growthPctForMarginTarget","growthPctForProfitTarget","newMarginPct","conversionRate","landingConvPct","salesConvPct","ctrPct","ltvCacRatio","roas","roi","oee","gapToWorldClass","improvementPct","turnoverRatePct","expectedRetentionImprovementPct","newTurnoverRatePct","productivityGainPct","annualROI","probabilityPct","gapPct","currentMarketSharePct","targetMarketSharePct","companyGrowthPct","marketGrowthPct","relativeGrowthPp","utilizationPct","idleCapacityPct","availabilityPct","performancePct","qualityPct","improvementApplied","currentProductAShare","currentProductBShare","newProductAShare","newProductBShare","currentBlendedMarginPct","newBlendedMarginPct","marginDeltaPp","contributionMarginPct","productAMarginPct","productBMarginPct"]);

function fmtValue(key: string, val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (BOOL_KEYS.has(key)) return val ? "✓ Sim" : "✗ Não";
  if (typeof val === "boolean") return val ? "Sim" : "Não";
  if (typeof val === "string") return val;
  if (typeof val !== "number") return String(val);
  if (BRL_KEYS.has(key)) return `R$ ${Math.round(val).toLocaleString("pt-BR")}`;
  if (PCT_KEYS.has(key)) return `${val.toFixed(1)}%`;
  return val.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

/* ─── SimCard — one simulator card with inline form ───────────────────── */
function SimCard({ sim, companyId }: { sim: SimDef; companyId: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [params, setParams] = useState<Record<string, string>>({});
  const [result, setResult] = useState<any>(null);
  const [simName, setSimName] = useState("");
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const defs = SIM_PARAMS[sim.value] ?? [];

  const runMut = useRunSimulation({
    mutation: {
      onSuccess: (data: any) => setResult(data),
      onError: () => toast({ title: "Erro ao simular", variant: "destructive" }),
    },
  });
  const saveMut = useCreateSimulation({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["simulations", companyId] });
        setResult(null); setOpen(false); setParams({}); setSimName("");
        toast({ title: "Simulação salva" });
      },
      onError: () => toast({ title: "Erro ao salvar", variant: "destructive" }),
    },
  });

  const handleRun = (overrideParams?: Record<string, string>) => {
    const src = overrideParams ?? params;
    const resolved: Record<string, unknown> = {};
    for (const d of defs) resolved[d.key] = d.type === "text" ? (src[d.key] ?? d.default ?? "") : Number(src[d.key] ?? d.default ?? 0);
    runMut.mutate({ data: { type: sim.value, parameters: resolved } });
  };

  const handleAskAI = async () => {
    if (!aiQuestion.trim()) return;
    setAiLoading(true);
    setAiExplanation(null);
    try {
      const res = await fetch("/api/simulations/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          type: sim.value,
          simLabel: sim.label,
          currentParams: params,
          paramDefs: defs.map(d => ({ key: d.key, label: d.label, default: d.default })),
          question: aiQuestion,
          currentResult: result?.outputs ?? null,
        }),
      });

      if (!res.ok) {
        let detail = `Erro ${res.status}`;
        try {
          const errJson = await res.json();
          detail = errJson.detail ?? errJson.error ?? detail;
        } catch { /* ignore parse error */ }
        console.error("[SimulationPanel] /ask error:", res.status, detail);
        setAiExplanation(`Não foi possível processar: ${detail}`);
        return;
      }

      const data = await res.json();

      if (data.directAnswer) {
        setAiExplanation(data.directAnswer);
      } else {
        const merged = { ...params, ...data.updatedParams };
        setParams(merged);
        setAiExplanation(data.explanation ?? null);
        setAiQuestion("");
        handleRun(merged);
      }
    } catch (err) {
      console.error("[SimulationPanel] /ask fetch error:", err);
      setAiExplanation("Erro de conexão ao consultar a IA. Tente novamente.");
    } finally {
      setAiLoading(false);
    }
  };

  const handleSave = () => {
    if (!result) return;
    const name = simName || `${sim.label} — ${new Date().toLocaleDateString("pt-BR")}`;
    const resolved: Record<string, unknown> = {};
    for (const d of defs) resolved[d.key] = d.type === "text" ? (params[d.key] ?? d.default ?? "") : Number(params[d.key] ?? d.default ?? 0);
    saveMut.mutate({ id: companyId, data: { name, type: sim.value as SimulationInputType, parameters: resolved, results: result.outputs } });
  };

  const toggle = () => { setOpen(v => !v); if (open) { setResult(null); setParams({}); } };

  const Icon = sim.icon;
  const verdictEntry = result?.outputs?.verdict as string | undefined;
  const insightEntry = result?.outputs?.insight as string | undefined;

  return (
    <div className="flex flex-col">
      <button
        onClick={toggle}
        className={`flex items-start gap-3 p-4 rounded-xl border text-left transition-all hover:shadow-sm ${open ? `${sim.bg} ${sim.border}` : "border-border bg-card hover:border-primary/30"}`}
      >
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${sim.bg} border ${sim.border}`}>
          <Icon className={`w-4 h-4 ${sim.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-foreground leading-tight">{sim.label}</p>
          <p className="text-xs text-muted-foreground mt-1 leading-snug line-clamp-2">{sim.description}</p>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" /> : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />}
      </button>

      {open && (
        <div className={`border border-t-0 rounded-b-xl p-4 space-y-4 ${sim.bg} ${sim.border}`}>
          {/* AI question field */}
          <div className="flex gap-2 items-center p-3 rounded-lg bg-background/70 border border-border">
            <Sparkles className={`w-4 h-4 flex-shrink-0 ${sim.color}`} />
            <Input
              className="flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0 px-0 text-sm placeholder:text-muted-foreground/60"
              placeholder="Pergunte à IA… ex: se eu aumentar 15%, quantos clientes posso perder?"
              value={aiQuestion}
              onChange={(e) => setAiQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAskAI(); } }}
              disabled={aiLoading}
            />
            <Button size="icon" variant="ghost" className="h-7 w-7 flex-shrink-0" onClick={handleAskAI} disabled={!aiQuestion.trim() || aiLoading}>
              {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <SendHorizonal className="w-3.5 h-3.5" />}
            </Button>
          </div>

          {/* AI explanation banner */}
          {aiExplanation && (
            <div className={`flex gap-2 items-start rounded-lg px-3 py-2 text-xs ${sim.bg} border ${sim.border}`}>
              <Sparkles className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${sim.color}`} />
              <p className="text-foreground leading-relaxed">{aiExplanation}</p>
            </div>
          )}

          {/* Params — always visible and editable */}
          <div className="grid grid-cols-2 gap-3">
            {defs.map((d) => (
              <div key={d.key} className="space-y-1">
                <Label className="text-xs">{d.label}</Label>
                <Input
                  type={d.type === "text" ? "text" : "number"}
                  placeholder={d.default}
                  value={params[d.key] ?? d.default ?? ""}
                  onChange={(e) => setParams(p => ({ ...p, [d.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          {/* Action row — always visible */}
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => handleRun()} disabled={runMut.isPending}>
              {runMut.isPending
                ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                : <Play className="w-3.5 h-3.5 mr-1.5" />}
              {result ? "Nova Simulação" : "Simular"}
            </Button>
            {result && (
              <Button size="sm" variant="secondary" onClick={handleSave} disabled={saveMut.isPending}>
                {saveMut.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
                Salvar
              </Button>
            )}
          </div>

          {/* Results — shown below buttons when available */}
          {result && (
            <div className="border border-border rounded-lg p-4 bg-background/80 space-y-3">
              {verdictEntry && (
                <div className={`rounded-lg px-3 py-2 text-sm font-medium ${sim.bg} border ${sim.border} ${sim.color}`}>
                  {verdictEntry}
                </div>
              )}
              {insightEntry && (
                <p className="text-xs text-muted-foreground italic">{insightEntry}</p>
              )}
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(result.outputs ?? {}).filter(([k]) => !SKIP_KEYS.has(k)).map(([k, v]) => (
                  <div key={k} className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">{OUTPUT_LABELS[k] ?? k}</p>
                    <p className="text-sm font-semibold text-foreground">{fmtValue(k, v)}</p>
                  </div>
                ))}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nome para salvar (opcional)</Label>
                <Input
                  placeholder={`${sim.label} — ${new Date().toLocaleDateString("pt-BR")}`}
                  value={simName}
                  onChange={e => setSimName(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── SavedSimulations ─────────────────────────────────────────────────── */
function SavedSimCard({ s, companyId, onDeleted }: { s: any; companyId: number; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const allSims = CATALOG.flatMap(c => c.sims);
  const def = allSims.find(d => d.value === s.type);
  const Icon = def?.icon ?? FlaskConical;
  const defs = SIM_PARAMS[s.type] ?? [];
  const outputs: Record<string, unknown> = s.results ?? {};
  const verdictEntry = outputs.verdict as string | undefined;
  const insightEntry = outputs.insight as string | undefined;

  const handleDelete = async () => {
    if (!confirm(`Excluir "${s.name}"?`)) return;
    setDeleting(true);
    try {
      await fetch(`/api/companies/${companyId}/simulations/${s.id}`, {
        method: "DELETE", credentials: "include",
      });
      onDeleted();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col">
      <div className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${open ? `${def?.bg ?? "bg-muted/30"} ${def?.border ?? "border-border"} rounded-b-none` : "border-border bg-card hover:border-primary/30"}`}>
        <button className="flex items-center gap-3 flex-1 min-w-0 text-left" onClick={() => setOpen(v => !v)}>
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${def?.bg ?? "bg-muted"}`}>
            <Icon className={`w-4 h-4 ${def?.color ?? "text-muted-foreground"}`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm text-foreground line-clamp-1">{s.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{def?.label ?? s.type} · {new Date(s.createdAt).toLocaleDateString("pt-BR")}</p>
          </div>
          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
        </button>
        <Button
          size="icon" variant="ghost"
          className="h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          onClick={handleDelete} disabled={deleting}
        >
          {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        </Button>
      </div>

      {open && (
        <div className={`border border-t-0 rounded-b-xl p-4 space-y-4 ${def?.bg ?? "bg-muted/20"} ${def?.border ?? "border-border"}`}>
          {/* Saved params */}
          {defs.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Parâmetros usados</p>
              <div className="grid grid-cols-2 gap-2">
                {defs.map(d => {
                  const val = (s.parameters as Record<string, unknown>)?.[d.key];
                  if (val === undefined || val === null || val === "" || val === 0) return null;
                  return (
                    <div key={d.key} className="space-y-0.5">
                      <p className="text-xs text-muted-foreground">{d.label}</p>
                      <p className="text-sm font-medium text-foreground">{String(val)}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Saved results */}
          {Object.keys(outputs).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Resultado</p>
              {verdictEntry && (
                <div className={`rounded-lg px-3 py-2 text-sm font-medium mb-3 ${def?.bg ?? "bg-muted"} border ${def?.border ?? "border-border"} ${def?.color ?? ""}`}>
                  {verdictEntry}
                </div>
              )}
              {insightEntry && <p className="text-xs text-muted-foreground italic mb-2">{insightEntry}</p>}
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(outputs).filter(([k]) => !SKIP_KEYS.has(k)).map(([k, v]) => (
                  <div key={k} className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">{OUTPUT_LABELS[k] ?? k}</p>
                    <p className="text-sm font-semibold text-foreground">{fmtValue(k, v)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SavedSimulations({ saved, companyId }: { saved: any[]; companyId: number }) {
  const qc = useQueryClient();
  const [show, setShow] = useState(true);
  const refresh = () => qc.invalidateQueries({ queryKey: ["simulations", companyId] });

  return (
    <div className="space-y-2 pt-2 border-t border-border">
      <button
        className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setShow(v => !v)}
      >
        {show ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        Simulações salvas ({saved.length})
      </button>
      {show && (
        <div className="space-y-2">
          {saved.map(s => (
            <SavedSimCard key={s.id} s={s} companyId={companyId} onDeleted={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Main panel ───────────────────────────────────────────────────────── */
interface SimulationPanelProps { companyId: number }

export default function SimulationPanel({ companyId }: SimulationPanelProps) {
  const { data: saved = [], isLoading: savedLoading } = useQuery({
    queryKey: ["simulations", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/companies/${companyId}/simulations`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <FlaskConical className="w-4 h-4 text-primary" />
        <h2 className="text-base font-semibold text-foreground">Simuladores</h2>
        <Badge variant="secondary" className="text-xs">{CATALOG.reduce((n, c) => n + c.sims.length, 0)} disponíveis</Badge>
      </div>

      <Tabs defaultValue="financial">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50 p-1">
          {CATALOG.map((cat) => {
            const Icon = cat.icon;
            return (
              <TabsTrigger key={cat.id} value={cat.id} className="gap-1.5 text-xs">
                <Icon className={`w-3.5 h-3.5 ${cat.color}`} />
                {cat.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {CATALOG.map((cat) => (
          <TabsContent key={cat.id} value={cat.id} className="mt-4">
            <div className="space-y-3">
              {cat.sims.map((sim) => (
                <SimCard key={sim.value} sim={sim} companyId={companyId} />
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>

      {/* Saved simulations */}
      {!savedLoading && saved.length > 0 && (
        <SavedSimulations saved={saved} companyId={companyId} />
      )}
    </div>
  );
}
