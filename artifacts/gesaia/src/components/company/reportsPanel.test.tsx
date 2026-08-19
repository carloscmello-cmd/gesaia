import assert from "node:assert/strict";
import test from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { requestPdfExport } from "../../lib/pdfExport.ts";
import ReportsPanel, {
  fetchCompanyReports,
  getCompanyReportsQueryKey,
  type Report,
} from "./ReportsPanel.tsx";

const dateFormat: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

test("renders complete and legacy report history rows without crashing", async () => {
  const reports = [
    {
      id: 101,
      companyId: 42,
      title: "Análise completa de agosto",
      type: "full_analysis",
      content: {
        period: "Agosto 2025",
        kpis: [{ name: "Margem" }, { name: "Caixa" }],
        findings: [{ title: "Margem abaixo da meta" }],
        blufRecommendation: "Reduzir custos variáveis.",
      },
      createdAt: "2026-08-19T12:00:00.000Z",
    },
    {
      id: 102,
      companyId: 42,
      title: "Análise legada",
      type: "full_analysis",
      content: {},
      createdAt: "2026-08-18T12:00:00.000Z",
    },
  ];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input) => {
    assert.equal(input, "/api/reports/42/reports");
    return {
      ok: true,
      json: async () => reports,
    } as Response;
  }) as typeof fetch;

  try {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    await queryClient.prefetchQuery({
      queryKey: ["company-reports", 42],
      queryFn: async () => {
        const response = await fetch("/api/reports/42/reports", {
          credentials: "include",
        });
        const allReports = await response.json();
        return allReports.filter(
          (report: (typeof reports)[number]) => report.type === "full_analysis",
        );
      },
    });

    const renderReports = () =>
      renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <ReportsPanel companyId={42} />
        </QueryClientProvider>,
      );

    let markup = "";
    assert.doesNotThrow(() => {
      markup = renderReports();
    });

    assert.match(
      markup,
      /Agosto 2025 · 2 KPIs · 1 achado · Reduzir custos variáveis\./,
    );
    assert.match(markup, /Período não informado · 0 KPIs · 0 achados/);
    assert.equal(
      (markup.match(/Relatório Completo/g) ?? []).length,
      reports.length,
    );
    assert.ok(
      markup.includes(
        new Date(reports[0].createdAt).toLocaleString("pt-BR", dateFormat),
      ),
    );
    assert.ok(
      markup.includes(
        new Date(reports[1].createdAt).toLocaleString("pt-BR", dateFormat),
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("refreshes the exported company's Relatórios list exactly once", async () => {
  const reportsByCompany = new Map<number, Report[]>([
    [
      42,
      [
        {
          id: 101,
          companyId: 42,
          title: "Relatório anterior",
          type: "full_analysis",
          content: {},
          createdAt: "2026-08-18T12:00:00.000Z",
        },
      ],
    ],
    [
      99,
      [
        {
          id: 201,
          companyId: 99,
          title: "Relatório de outra empresa",
          type: "full_analysis",
          content: {},
          createdAt: "2026-08-18T12:00:00.000Z",
        },
      ],
    ],
  ]);
  const listFetches = new Map<number, number>();
  const originalFetch = globalThis.fetch;

  const fetchReports = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url === "/api/reports/pdf") {
      assert.equal(init?.method, "POST");
      const companyReports = reportsByCompany.get(42) ?? [];
      reportsByCompany.set(42, [
        ...companyReports,
        {
          id: 102,
          companyId: 42,
          title: "Novo relatório exportado",
          type: "full_analysis",
          content: {},
          createdAt: "2026-08-19T12:00:00.000Z",
        },
      ]);
      return {
        ok: true,
        blob: async () => new Blob(["%PDF-1.4"], { type: "application/pdf" }),
      } as Response;
    }

    const match = url.match(/^\/api\/reports\/(\d+)\/reports$/);
    assert.ok(match, `Unexpected request: ${url}`);
    const companyId = Number(match[1]);
    listFetches.set(companyId, (listFetches.get(companyId) ?? 0) + 1);
    return {
      ok: true,
      json: async () => reportsByCompany.get(companyId) ?? [],
    } as Response;
  };

  globalThis.fetch = fetchReports as typeof fetch;

  try {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    const company42Query = {
      queryKey: getCompanyReportsQueryKey(42),
      queryFn: () => fetchCompanyReports(42),
    };
    const company99Query = {
      queryKey: getCompanyReportsQueryKey(99),
      queryFn: () => fetchCompanyReports(99),
    };

    await Promise.all([
      queryClient.prefetchQuery(company42Query),
      queryClient.prefetchQuery(company99Query),
    ]);
    assert.equal(listFetches.get(42), 1);
    assert.equal(listFetches.get(99), 1);

    await requestPdfExport(
      {
        companyId: 42,
        companyName: "Empresa 42",
        generatedAt: "19/08/2026 12:00:00",
        kpis: [],
        alerts: [],
        findings: [],
      },
      () => {
        void queryClient.invalidateQueries({
          queryKey: getCompanyReportsQueryKey(42),
        });
      },
      fetchReports,
    );

    await queryClient.fetchQuery(company42Query);

    const company42Markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <ReportsPanel companyId={42} />
      </QueryClientProvider>,
    );
    assert.equal(
      (company42Markup.match(/Novo relatório exportado/g) ?? []).length,
      1,
      "the successful export must appear once in the exported company's list",
    );
    assert.match(company42Markup, /2 relatórios gerados/);
    assert.equal(listFetches.get(42), 2, "the exported company's list must refresh once");

    const company99Markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <ReportsPanel companyId={99} />
      </QueryClientProvider>,
    );
    assert.equal(
      (company99Markup.match(/Novo relatório exportado/g) ?? []).length,
      0,
      "another company's list must not receive the exported report",
    );
    assert.equal(listFetches.get(99), 1, "another company's list must not refresh");
    assert.deepEqual(queryClient.getQueryData(getCompanyReportsQueryKey(99)), [
      reportsByCompany.get(99)?.[0],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});