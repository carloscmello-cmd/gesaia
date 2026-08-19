export function validateBridgePeriodOrder(periodBase: string, periodComp: string): string | null {
  if (periodBase.localeCompare(periodComp, undefined, { numeric: true }) > 0) {
    return "periodBase cannot be later than periodComp";
  }
  return null;
}

export function buildBridgeAnalysis(periodBase: string, periodComp: string, base: any, comp: any) {
  const n = (obj: any, k: string) => { const v = obj?.[k]; return v !== null && v !== undefined ? Number(v) : null; };
  const safe = (v: number | null) => v ?? 0;

  // ── Receitas ─────────────────────────────────────────────────────────────
  const rev1 = safe(n(base, "netRevenue"));
  const rev2 = safe(n(comp, "netRevenue"));
  const deltaRev = rev2 - rev1;
  const deltaRevPct = rev1 !== 0 ? (deltaRev / rev1) * 100 : null;

  // ── Custos variáveis → Margem de Contribuição ────────────────────────────
  const varC1 = safe(n(base, "variableCosts"));
  const varC2 = safe(n(comp, "variableCosts"));
  const mc1   = rev1 - varC1;
  const mc2   = rev2 - varC2;
  const mcPct1 = rev1 > 0 ? mc1 / rev1 : 0;
  const mcPct2 = rev2 > 0 ? mc2 / rev2 : 0;

  // ── Custos fixos ─────────────────────────────────────────────────────────
  const fix1 = safe(n(base, "fixedCosts"));
  const fix2 = safe(n(comp, "fixedCosts"));

  // ── Resultado Operacional = MC − Custo Fixo ──────────────────────────────
  const result1 = mc1 - fix1;
  const result2 = mc2 - fix2;
  const deltaResult = result2 - result1;

  // ── Bridge Decomposition (3 efeitos que somam ao Δ Resultado) ────────────
  // 1. Efeito Volume: quanto o Δ Receita contribuiu à MC, mantendo MC% do período base
  const efectoVolume = deltaRev * mcPct1;
  // 2. Efeito Margem/CMV: quanto a mudança no MC% impactou, aplicado à nova receita
  const efectoMargem = rev2 * (mcPct2 - mcPct1);
  // 3. Efeito Custo Fixo: variação de custo fixo (negativa se aumentou)
  const efectoCustoFixo = fix1 - fix2;
  // Verificação: os 3 devem somar ≈ deltaResult
  const bridgeSum = efectoVolume + efectoMargem + efectoCustoFixo;
  const bridgeError = Math.abs(bridgeSum - deltaResult);

  // ── Indicadores secundários ──────────────────────────────────────────────
  const grossRev1 = n(base, "grossRevenue");
  const grossRev2 = n(comp, "grossRevenue");
  const cogs1 = n(base, "cogs");
  const cogs2 = n(comp, "cogs");
  const ebitda1 = n(base, "ebitda");
  const ebitda2 = n(comp, "ebitda");
  const netP1 = n(base, "netProfit");
  const netP2 = n(comp, "netProfit");
  const customers1 = n(base, "activeCustomers");
  const customers2 = n(comp, "activeCustomers");
  const ticket1 = n(base, "averageTicket");
  const ticket2 = n(comp, "averageTicket");

  // Decomposição do Δ Receita em volume vs preço (quando disponível)
  let volumeEffect: number | null = null;
  let priceEffect: number | null = null;
  if (customers1 !== null && customers2 !== null && ticket1 !== null && ticket2 !== null && customers1 > 0) {
    volumeEffect = (customers2 - customers1) * ticket1;    // Δ clientes × preço base
    priceEffect  = customers2 * (ticket2 - ticket1);       // Δ ticket × novos clientes
  }

  // ── Diagnóstico de Vazamento ──────────────────────────────────────────────
  const isLeaking = deltaRev > 0 && deltaResult < 0;
  const isImproving = deltaRev >= 0 && deltaResult > 0;
  const isPressured = deltaRev < 0 && deltaResult < 0;

  // ── Narrativa ─────────────────────────────────────────────────────────────
  const lines: string[] = [];
  if (isLeaking) {
    lines.push(`⚠️ Sinal de vazamento detectado: a receita cresceu ${deltaRevPct !== null ? `${deltaRevPct.toFixed(1)}%` : ""} mas o resultado operacional caiu R$ ${Math.abs(Math.round(deltaResult)).toLocaleString("pt-BR")}.`);
    if (efectoMargem < -Math.abs(efectoVolume) * 0.3)
      lines.push("A principal causa é a queda na margem de contribuição — o custo variável cresceu proporcionalmente mais que a receita.");
    if (efectoCustoFixo < -Math.abs(efectoVolume) * 0.3)
      lines.push("O aumento de custos fixos está consumindo o ganho de receita.");
  } else if (isImproving) {
    lines.push(`✅ Empresa cresceu de forma saudável: receita e resultado operacional evoluíram juntos.`);
    const mainDriver = efectoVolume >= efectoMargem && efectoVolume >= efectoCustoFixo ? "volume de vendas" : efectoMargem >= efectoCustoFixo ? "melhora de margem" : "controle de custos fixos";
    lines.push(`O principal driver de melhora foi o ${mainDriver}.`);
  } else if (isPressured) {
    lines.push(`📉 Queda de receita e resultado: empresa em compressão no período.`);
    if (Math.abs(efectoMargem) < Math.abs(efectoVolume) * 0.5)
      lines.push("A margem de contribuição foi preservada — o problema está concentrado na queda de volume/receita.");
    else
      lines.push("A margem de contribuição também piorou, agravando o efeito da queda de receita.");
  } else {
    lines.push(`Período comparativo com variações mistas: analise os efeitos abaixo para identificar as alavancas principais.`);
  }

  const bridge = [
    { label: "Efeito Volume", value: Math.round(efectoVolume), description: "Impacto do Δ Receita na MC, mantendo o MC% do período base" },
    { label: "Efeito Margem/CMV", value: Math.round(efectoMargem), description: "Impacto da variação de margem de contribuição % na nova receita" },
    { label: "Efeito Custo Fixo", value: Math.round(efectoCustoFixo), description: "Variação de custos fixos (positivo = custo caiu = melhora)" },
  ];

  return {
    periodBase,
    periodComp,
    summary: {
      netRevenue:         { base: Math.round(rev1), comp: Math.round(rev2),    delta: Math.round(deltaRev),    deltaPct: deltaRevPct },
      contributionMargin: { base: Math.round(mc1),  comp: Math.round(mc2),     delta: Math.round(mc2 - mc1),   deltaPct: mc1 !== 0 ? ((mc2 - mc1) / Math.abs(mc1)) * 100 : null },
      mcPct:              { base: mcPct1 * 100,      comp: mcPct2 * 100,        delta: (mcPct2 - mcPct1) * 100, deltaPct: null },
      fixedCosts:         { base: Math.round(fix1),  comp: Math.round(fix2),    delta: Math.round(fix2 - fix1), deltaPct: fix1 !== 0 ? ((fix2 - fix1) / Math.abs(fix1)) * 100 : null },
      operatingResult:    { base: Math.round(result1), comp: Math.round(result2), delta: Math.round(deltaResult), deltaPct: result1 !== 0 ? (deltaResult / Math.abs(result1)) * 100 : null },
      ...(grossRev1 !== null ? { grossRevenue: { base: Math.round(grossRev1), comp: Math.round(safe(grossRev2)), delta: Math.round(safe(grossRev2) - grossRev1), deltaPct: grossRev1 !== 0 ? ((safe(grossRev2) - grossRev1) / grossRev1) * 100 : null } } : {}),
      ...(ebitda1 !== null   ? { ebitda:       { base: Math.round(ebitda1),   comp: Math.round(safe(ebitda2)),   delta: Math.round(safe(ebitda2) - ebitda1), deltaPct: ebitda1 !== 0 ? ((safe(ebitda2) - ebitda1) / Math.abs(ebitda1)) * 100 : null } } : {}),
      ...(netP1 !== null     ? { netProfit:    { base: Math.round(netP1),     comp: Math.round(safe(netP2)),     delta: Math.round(safe(netP2) - netP1), deltaPct: netP1 !== 0 ? ((safe(netP2) - netP1) / Math.abs(netP1)) * 100 : null } } : {}),
      ...(customers1 !== null ? { activeCustomers: { base: customers1, comp: safe(customers2), delta: safe(customers2) - customers1, deltaPct: customers1 !== 0 ? ((safe(customers2) - customers1) / customers1) * 100 : null } } : {}),
      ...(ticket1 !== null    ? { averageTicket:   { base: Math.round(ticket1), comp: Math.round(safe(ticket2)), delta: Math.round(safe(ticket2) - ticket1), deltaPct: ticket1 !== 0 ? ((safe(ticket2) - ticket1) / ticket1) * 100 : null } } : {}),
    },
    bridge,
    bridgeCheckOk: bridgeError < Math.max(100, Math.abs(deltaResult) * 0.01),
    revenueDecomposition: volumeEffect !== null ? {
      volumeEffect: Math.round(volumeEffect),
      priceEffect:  Math.round(safe(priceEffect)),
      description:  "Decomposição do Δ Receita em efeito de clientes vs ticket médio",
    } : null,
    diagnosis: { isLeaking, isImproving, isPressured },
    narrative: lines.join(" "),
  };
}