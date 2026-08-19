import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCreateInvestigation, useUpdateInvestigation } from "@workspace/api-client-react";
import {
  MessageSquare,
  Send,
  Loader2,
  ChevronRight,
  Bot,
  User,
  TrendingUp,
  ShoppingCart,
  Megaphone,
  Settings,
  Users,
  Shield,
  Lightbulb,
  Globe,
  Network,
  Compass,
  Plus,
  ArrowLeft,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* ── Investigation templates (one per specialist area) ───────────────── */
const INVESTIGATION_TEMPLATES = [
  {
    id: "financial",
    title: "Diagnóstico Financeiro",
    description: "DRE, margens, ponto de equilíbrio, ciclo de caixa e capital de giro",
    icon: TrendingUp,
    color: "text-blue-600",
    bg: "bg-blue-50 dark:bg-blue-900/20",
    border: "border-blue-200 dark:border-blue-800",
    prompt: "Faça um diagnóstico financeiro completo desta empresa. Analise a DRE, margens, ponto de equilíbrio, margem de segurança e ciclo de caixa. Identifique os pontos críticos e proponha ações.",
  },
  {
    id: "commercial",
    title: "Análise Comercial",
    description: "CAC, LTV, conversão, churn e dimensionamento da carteira de clientes",
    icon: ShoppingCart,
    color: "text-emerald-600",
    bg: "bg-emerald-50 dark:bg-emerald-900/20",
    border: "border-emerald-200 dark:border-emerald-800",
    prompt: "Faça uma análise comercial desta empresa. Avalie conversão, churn, ticket médio e clientes ativos. Identifique oportunidades de crescimento e pontos de melhoria no processo comercial.",
  },
  {
    id: "marketing",
    title: "Diagnóstico de Marketing & NPS",
    description: "NPS, satisfação de clientes, posicionamento e estratégias de captação",
    icon: Megaphone,
    color: "text-violet-600",
    bg: "bg-violet-50 dark:bg-violet-900/20",
    border: "border-violet-200 dark:border-violet-800",
    prompt: "Analise o desempenho de marketing e NPS desta empresa. Avalie a satisfação dos clientes, estratégias de captação e posicionamento. O que precisa ser melhorado para aumentar retenção e aquisição?",
  },
  {
    id: "operations",
    title: "Eficiência Operacional",
    description: "Produtividade, capacidade instalada, gargalos e processos",
    icon: Settings,
    color: "text-orange-600",
    bg: "bg-orange-50 dark:bg-orange-900/20",
    border: "border-orange-200 dark:border-orange-800",
    prompt: "Avalie a eficiência operacional desta empresa. Analise produtividade por colaborador, identifice gargalos no processo e sugira melhorias operacionais concretas.",
  },
  {
    id: "hr",
    title: "Gestão de Pessoas & RH",
    description: "Turnover, custo de pessoal, engajamento e dimensionamento de equipe",
    icon: Users,
    color: "text-pink-600",
    bg: "bg-pink-50 dark:bg-pink-900/20",
    border: "border-pink-200 dark:border-pink-800",
    prompt: "Faça um diagnóstico de recursos humanos. Analise o custo de pessoal em relação à receita, avalie o dimensionamento da equipe e identifique riscos de turnover e desengajamento.",
  },
  {
    id: "risks",
    title: "Gestão de Riscos",
    description: "Inadimplência, dependência de clientes, riscos financeiros e operacionais",
    icon: Shield,
    color: "text-red-600",
    bg: "bg-red-50 dark:bg-red-900/20",
    border: "border-red-200 dark:border-red-800",
    prompt: "Analise os principais riscos desta empresa. Avalie inadimplência, concentração de clientes, riscos financeiros e operacionais. Proponha medidas de mitigação para cada risco identificado.",
  },
  {
    id: "innovation",
    title: "Inovação & Tecnologia",
    description: "Automação de processos, uso de tecnologia e vantagem competitiva digital",
    icon: Lightbulb,
    color: "text-yellow-600",
    bg: "bg-yellow-50 dark:bg-yellow-900/20",
    border: "border-yellow-200 dark:border-yellow-800",
    prompt: "Avalie o nível de inovação e maturidade digital desta empresa. Quais processos poderiam ser automatizados? Como a tecnologia pode criar vantagem competitiva neste segmento?",
  },
  {
    id: "market_intelligence",
    title: "Inteligência de Mercado",
    description: "Posicionamento, concorrência, tendências e oportunidades de mercado",
    icon: Globe,
    color: "text-teal-600",
    bg: "bg-teal-50 dark:bg-teal-900/20",
    border: "border-teal-200 dark:border-teal-800",
    prompt: "Faça uma análise de inteligência de mercado. Avalie o posicionamento competitivo, identifique tendências do setor e oportunidades não exploradas. Como a empresa pode se diferenciar?",
  },
  {
    id: "network",
    title: "Benchmarking de Rede",
    description: "Comparativo de desempenho entre unidades da rede ou franquias",
    icon: Network,
    color: "text-indigo-600",
    bg: "bg-indigo-50 dark:bg-indigo-900/20",
    border: "border-indigo-200 dark:border-indigo-800",
    prompt: "Analise o desempenho desta unidade em relação ao potencial da rede. Quais indicadores estão abaixo do esperado? O que as unidades de melhor desempenho fazem diferente?",
  },
  {
    id: "strategy",
    title: "Posicionamento Estratégico",
    description: "Crescimento, concentração de portfólio, maturidade e posição competitiva",
    icon: Compass,
    color: "text-cyan-600",
    bg: "bg-cyan-50 dark:bg-cyan-900/20",
    border: "border-cyan-200 dark:border-cyan-800",
    prompt: "Faça uma análise estratégica desta empresa. Avalie o ritmo de crescimento, a concentração do portfólio de produtos/serviços, o grau de inovação e a posição competitiva no mercado. Quais são os movimentos estratégicos prioritários para os próximos 12 meses?",
  },
];

const STATUS_LABELS: Record<string, string> = {
  open: "Aberta", in_progress: "Em Andamento", completed: "Concluída",
};
const STATUS_COLORS: Record<string, string> = {
  open: "outline", in_progress: "secondary", completed: "default",
};

interface InvestigationPanelProps {
  companyId: number;
}

/* ── Chat view ───────────────────────────────────────────────────────── */
function ChatView({
  companyId,
  inv,
  onBack,
}: {
  companyId: number;
  inv: any;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const [chatMsg, setChatMsg] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamedText, setStreamedText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: invDetail } = useQuery({
    queryKey: ["investigation-detail", companyId, inv.id],
    queryFn: async () => {
      const res = await fetch(`/api/companies/${companyId}/investigations/${inv.id}`, {
        credentials: "include",
      });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!inv.id,
  });

  const messages = invDetail?.messages ?? [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamedText]);

  const sendMessage = async (content: string) => {
    if (!content.trim() || streaming) return;
    const msg = content;
    setChatMsg("");
    setStreaming(true);
    setStreamedText("");

    try {
      const res = await fetch(`/api/companies/${companyId}/investigations/${inv.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content: msg }),
      });

      if (!res.ok || !res.body) { setStreaming(false); toast({ title: "Erro ao enviar mensagem", variant: "destructive" }); return; }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        for (const line of chunk.split("\n")) {
          if (line.startsWith("data: ")) {
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === "text") { full += ev.text; setStreamedText(full); }
              else if (ev.type === "done") {
                qc.invalidateQueries({ queryKey: ["investigation-detail", companyId, inv.id] });
              }
            } catch {}
          }
        }
      }
    } finally {
      setStreaming(false);
      setStreamedText("");
    }
  };

  // Auto-send template prompt on first open (no messages yet)
  useEffect(() => {
    if (invDetail && invDetail.messages?.length === 0 && inv._templatePrompt) {
      sendMessage(inv._templatePrompt);
    }
  }, [invDetail?.messages?.length === 0]);

  return (
    <div className="flex flex-col h-[calc(100vh-240px)] min-h-[480px]">
      <div className="flex items-center gap-3 mb-4 pb-3 border-b border-border">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="w-4 h-4" />
          Voltar
        </Button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-foreground line-clamp-1">{inv.title}</p>
          {inv.period && <p className="text-xs text-muted-foreground">Período: {inv.period}</p>}
        </div>
        <Badge variant={STATUS_COLORS[inv.status] as any} className="text-xs flex-shrink-0">
          {STATUS_LABELS[inv.status]}
        </Badge>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Bot className="w-10 h-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">Iniciando conversa com a IA…</p>
          </div>
        )}
        {messages.map((m: any) => (
          <div key={m.id} className={cn("flex gap-3", m.role === "user" ? "justify-end" : "justify-start")}>
            {m.role === "assistant" && (
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Bot className="w-3.5 h-3.5 text-primary" />
              </div>
            )}
            <div className={cn(
              "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
              m.role === "user"
                ? "bg-primary text-primary-foreground rounded-br-sm"
                : "bg-muted text-foreground rounded-bl-sm",
            )}>
              <p className="whitespace-pre-wrap">{m.content}</p>
            </div>
            {m.role === "user" && (
              <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                <User className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
            )}
          </div>
        ))}
        {streaming && streamedText && (
          <div className="flex gap-3 justify-start">
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Bot className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="max-w-[80%] rounded-2xl rounded-bl-sm px-4 py-2.5 bg-muted text-foreground text-sm leading-relaxed">
              <p className="whitespace-pre-wrap">{streamedText}</p>
            </div>
          </div>
        )}
        {streaming && !streamedText && (
          <div className="flex gap-3 justify-start">
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Bot className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="rounded-2xl rounded-bl-sm px-4 py-2.5 bg-muted">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="flex gap-2 mt-4 pt-3 border-t border-border">
        <Input
          value={chatMsg}
          onChange={(e) => setChatMsg(e.target.value)}
          placeholder="Faça uma pergunta sobre esta empresa…"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(chatMsg); } }}
          disabled={streaming}
          className="flex-1"
        />
        <Button size="icon" onClick={() => sendMessage(chatMsg)} disabled={!chatMsg.trim() || streaming}>
          {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}

/* ── Main panel ──────────────────────────────────────────────────────── */
export default function InvestigationPanel({ companyId }: InvestigationPanelProps) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<any>(null);

  const { data: investigations = [], isLoading } = useQuery({
    queryKey: ["investigations", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/companies/${companyId}/investigations`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const createMut = useCreateInvestigation({
    mutation: {
      onSuccess: (data: any) => {
        qc.invalidateQueries({ queryKey: ["investigations", companyId] });
        setSelected(data);
      },
      onError: () => toast({ title: "Erro ao criar investigação", variant: "destructive" }),
    },
  });

  const handleTemplate = (tpl: typeof INVESTIGATION_TEMPLATES[number]) => {
    // Check if an investigation for this template already exists
    const existing = investigations.find((inv: any) =>
      inv.title === tpl.title || inv.title.toLowerCase().includes(tpl.id),
    );
    if (existing) { setSelected({ ...existing, _templatePrompt: tpl.prompt }); return; }
    createMut.mutate({
      id: companyId,
      data: { title: tpl.title },
    });
    // Store prompt to send after creation
    sessionStorage.setItem(`inv_prompt_${companyId}_${tpl.id}`, tpl.prompt);
  };

  const handleExistingClick = (inv: any) => {
    setSelected(inv);
  };

  if (selected) {
    return (
      <ChatView
        companyId={companyId}
        inv={selected}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-primary" />
        <h2 className="text-base font-semibold text-foreground">Investigações com IA</h2>
      </div>

      {/* ── Template cards ──────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Iniciar investigação por área
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {INVESTIGATION_TEMPLATES.map((tpl) => {
            const Icon = tpl.icon;
            const existing = investigations.find((inv: any) => inv.title === tpl.title);
            return (
              <button
                key={tpl.id}
                onClick={() => handleTemplate(tpl)}
                disabled={createMut.isPending}
                className={`flex items-start gap-3 p-4 rounded-xl border text-left transition-all hover:shadow-sm hover:border-primary/40 ${
                  existing ? `${tpl.bg} ${tpl.border}` : "border-border bg-card"
                }`}
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${tpl.bg} border ${tpl.border}`}>
                  <Icon className={`w-4 h-4 ${tpl.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm text-foreground leading-tight">{tpl.title}</p>
                    {existing && (
                      <Badge variant="secondary" className="text-[10px] px-1 py-0">
                        {STATUS_LABELS[existing.status]}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-snug">{tpl.description}</p>
                </div>
                <ChevronRight className={`w-4 h-4 flex-shrink-0 mt-0.5 ${tpl.color} opacity-60`} />
              </button>
            );
          })}
        </div>
      </div>

      {/* ── All saved investigations ────────────────────────────────── */}
      {!isLoading && investigations.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Todas as investigações ({investigations.length})
          </p>
          <div className="space-y-2">
            {investigations.map((inv: any) => {
              const tpl = INVESTIGATION_TEMPLATES.find((t) => t.title === inv.title);
              const Icon = tpl?.icon ?? MessageSquare;
              return (
                <button
                  key={inv.id}
                  onClick={() => handleExistingClick(inv)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:border-primary/40 hover:shadow-sm transition-all text-left"
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${tpl?.bg ?? "bg-muted"}`}>
                    <Icon className={`w-4 h-4 ${tpl?.color ?? "text-muted-foreground"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-foreground line-clamp-1">{inv.title}</p>
                    {inv.period && <p className="text-xs text-muted-foreground mt-0.5">Período: {inv.period}</p>}
                  </div>
                  <Badge variant={STATUS_COLORS[inv.status] as any} className="text-xs flex-shrink-0">
                    {STATUS_LABELS[inv.status]}
                  </Badge>
                  <ChevronRight className="w-4 h-4 text-muted-foreground/50 flex-shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
