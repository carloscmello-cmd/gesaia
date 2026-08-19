import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createGapHistoryRouter } from "./networkGapHistory.ts";

type Row = Record<string, unknown>;

const tables = {
  networks: Symbol("networks"),
  companies: Symbol("companies"),
  companyData: Symbol("companyData"),
};

function inMemoryDb(data: { network: Row; units: Row[]; periods: Row[] }) {
  const rowsFor = (table: unknown): Row[] => {
    if (table === tables.networks) return [data.network];
    if (table === tables.companies) return data.units;
    if (table === tables.companyData) return data.periods;
    throw new Error("Unexpected table queried by gap-history route");
  };

  return {
    select() {
      return {
        from(table: unknown) {
          const rows = rowsFor(table);
          return {
            where() {
              return {
                limit(count: number) {
                  return Promise.resolve(rows.slice(0, count));
                },
                then<TResult1 = Row[], TResult2 = never>(
                  onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
                  onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
                ) {
                  return Promise.resolve(rows).then(onfulfilled, onrejected);
                },
              };
            },
          };
        },
      };
    },
  };
}

function periodRow(
  companyId: number,
  period: string,
  values: {
    variableCosts: number;
    fixedCosts: number;
    netProfit: number;
    pmr: number;
    pmp: number;
    pme: number;
    nps: number;
    churnRate: number;
    averageTicket: number;
    activeCustomers: number;
  },
): Row {
  return {
    id: `${companyId}-${period}`,
    companyId,
    period,
    netRevenue: 100,
    cogs: 0,
    depreciationAmortization: 0,
    ...values,
  };
}

function assertGoldGap(
  point: { period: string; units: Array<{ companyId: number; gapsPct: Record<string, number | null> | null }> },
  companyId: number,
  metric: string,
) {
  const unit = point.units.find((entry) => entry.companyId === companyId);
  assert.ok(unit, `${point.period}: company ${companyId} should be present`);
  assert.equal(unit.gapsPct?.[metric], 0, `${point.period}: company ${companyId} should hold gold for ${metric}`);
}

test("GET gap-history recalculates gold independently for every period", async () => {
  const data = {
    network: { id: 1, name: "Rede teste", ownerId: 7 },
    units: [
      { id: 1, name: "Unidade A", networkId: 1 },
      { id: 2, name: "Unidade B", networkId: 1 },
      { id: 3, name: "Unidade C", networkId: 1 },
    ],
    periods: [
      // Period 1: A leads the financial and cash-cycle metrics; B leads NPS
      // and churn.
      periodRow(1, "2025-01", {
        variableCosts: 20, fixedCosts: 10, netProfit: 60, pmr: 10, pmp: 5, pme: 15,
        nps: 70, churnRate: 0.02, averageTicket: 200, activeCustomers: 100,
      }),
      periodRow(2, "2025-01", {
        variableCosts: 40, fixedCosts: 30, netProfit: 30, pmr: 15, pmp: 5, pme: 20,
        nps: 90, churnRate: 0.01, averageTicket: 150, activeCustomers: 200,
      }),
      periodRow(3, "2025-01", {
        variableCosts: 50, fixedCosts: 40, netProfit: 20, pmr: 20, pmp: 5, pme: 25,
        nps: 60, churnRate: 0.03, averageTicket: 100, activeCustomers: 300,
      }),
      // Period 2: B leads almost everything; A leads customer growth.
      periodRow(1, "2025-02", {
        variableCosts: 50, fixedCosts: 30, netProfit: 20, pmr: 25, pmp: 5, pme: 15,
        nps: 60, churnRate: 0.03, averageTicket: 150, activeCustomers: 250,
      }),
      periodRow(2, "2025-02", {
        variableCosts: 10, fixedCosts: 5, netProfit: 80, pmr: 10, pmp: 5, pme: 10,
        nps: 95, churnRate: 0.01, averageTicket: 250, activeCustomers: 300,
      }),
      periodRow(3, "2025-02", {
        variableCosts: 30, fixedCosts: 20, netProfit: 50, pmr: 15, pmp: 5, pme: 15,
        nps: 80, churnRate: 0.02, averageTicket: 220, activeCustomers: 360,
      }),
      // Period 3: C leads the financial and low-is-better metrics; B leads
      // customer growth while A leads NPS.
      periodRow(1, "2025-03", {
        variableCosts: 40, fixedCosts: 20, netProfit: 40, pmr: 20, pmp: 5, pme: 20,
        nps: 95, churnRate: 0.03, averageTicket: 180, activeCustomers: 300,
      }),
      periodRow(2, "2025-03", {
        variableCosts: 30, fixedCosts: 20, netProfit: 50, pmr: 15, pmp: 5, pme: 15,
        nps: 65, churnRate: 0.02, averageTicket: 220, activeCustomers: 450,
      }),
      periodRow(3, "2025-03", {
        variableCosts: 10, fixedCosts: 5, netProfit: 80, pmr: 10, pmp: 5, pme: 10,
        nps: 75, churnRate: 0.01, averageTicket: 260, activeCustomers: 500,
      }),
    ],
  };

  const app = express();
  app.use(
    "/api/networks",
    createGapHistoryRouter({
      database: inMemoryDb(data),
      tables,
      authMiddleware: ((_req, res, next) => {
        (_req as any).dbUser = { id: 7, role: "admin" };
        next();
      }) as never,
    }),
  );

  const server = await new Promise<import("node:http").Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/networks/1/gap-history`);
    assert.equal(response.status, 200);
    const body = await response.json() as {
      points: Array<{
        period: string;
        unitsWithData: number;
        goldStandardUnitCount: number;
        units: Array<{ companyId: number; gapsPct: Record<string, number | null> | null }>;
      }>;
    };

    assert.deepEqual(body.points.map((point) => point.period), ["2025-01", "2025-02", "2025-03"]);
    assert.deepEqual(body.points.map((point) => point.goldStandardUnitCount), [3, 3, 3]);
    assert.deepEqual(body.points.map((point) => point.unitsWithData), [3, 3, 3]);

    const [period1, period2, period3] = body.points;
    for (const metric of ["mcPct", "ebitPct", "ebitdaPct", "netProfitPct", "averageTicket"]) {
      assertGoldGap(period1, 1, metric);
    }
    assertGoldGap(period1, 1, "cashCycle");
    for (const metric of ["nps", "churnPct"]) {
      assertGoldGap(period1, 2, metric);
    }

    for (const metric of ["mcPct", "ebitPct", "ebitdaPct", "netProfitPct", "cashCycle", "nps", "churnPct", "averageTicket"]) {
      assertGoldGap(period2, 2, metric);
    }
    assertGoldGap(period2, 1, "activeCustomersGrowthPct");

    for (const metric of ["mcPct", "ebitPct", "ebitdaPct", "netProfitPct", "cashCycle", "churnPct", "averageTicket"]) {
      assertGoldGap(period3, 3, metric);
    }
    assertGoldGap(period3, 1, "nps");
    assertGoldGap(period3, 2, "activeCustomersGrowthPct");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("GET gap-history reports the gold-standard base for each period when a unit has partial history", async () => {
  const data = {
    network: { id: 1, name: "Rede parcial", ownerId: 7 },
    units: [
      { id: 1, name: "Unidade A", networkId: 1 },
      { id: 2, name: "Unidade B", networkId: 1 },
    ],
    periods: [
      periodRow(1, "2025-01", {
        variableCosts: 20, fixedCosts: 10, netProfit: 60, pmr: 10, pmp: 5, pme: 15,
        nps: 70, churnRate: 0.02, averageTicket: 200, activeCustomers: 100,
      }),
      periodRow(2, "2025-01", {
        variableCosts: 30, fixedCosts: 20, netProfit: 50, pmr: 15, pmp: 5, pme: 20,
        nps: 80, churnRate: 0.01, averageTicket: 180, activeCustomers: 120,
      }),
      // Unidade B has no data in February, so only Unidade A contributes to
      // that period's gold standard.
      periodRow(1, "2025-02", {
        variableCosts: 25, fixedCosts: 12, netProfit: 55, pmr: 12, pmp: 5, pme: 16,
        nps: 75, churnRate: 0.02, averageTicket: 210, activeCustomers: 130,
      }),
      periodRow(1, "2025-03", {
        variableCosts: 22, fixedCosts: 11, netProfit: 58, pmr: 11, pmp: 5, pme: 15,
        nps: 78, churnRate: 0.02, averageTicket: 215, activeCustomers: 140,
      }),
      periodRow(2, "2025-03", {
        variableCosts: 28, fixedCosts: 18, netProfit: 52, pmr: 14, pmp: 5, pme: 19,
        nps: 82, churnRate: 0.01, averageTicket: 190, activeCustomers: 150,
      }),
    ],
  };

  const app = express();
  app.use(
    "/api/networks",
    createGapHistoryRouter({
      database: inMemoryDb(data),
      tables,
      authMiddleware: ((_req, res, next) => {
        (_req as any).dbUser = { id: 7, role: "admin" };
        next();
      }) as never,
    }),
  );

  const server = await new Promise<import("node:http").Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/networks/1/gap-history`);
    assert.equal(response.status, 200);
    const body = await response.json() as {
      points: Array<{ period: string; unitsWithData: number; goldStandardUnitCount: number }>;
    };

    assert.deepEqual(body.points.map((point) => point.period), ["2025-01", "2025-02", "2025-03"]);
    assert.deepEqual(body.points.map((point) => point.unitsWithData), [2, 1, 2]);
    assert.deepEqual(body.points.map((point) => point.goldStandardUnitCount), [2, 1, 2]);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});