import { Router, type RequestHandler } from "express";
import { eq, inArray } from "drizzle-orm";
import {
  computeGaps,
  computeGapsPct,
  computeGoldStandard,
  computeMetrics,
  METRIC_DEFS,
  type Metrics,
} from "./networksMetrics.ts";

type GapHistoryTables = {
  networks: any;
  companies: any;
  companyData: any;
};

type GapHistoryDependencies = {
  database: any;
  authMiddleware: RequestHandler;
  tables: GapHistoryTables;
};

type Unit = { id: number; name: string };
type DataRow = Record<string, unknown> & { companyId: number; period: string };

function canAccess(user: any, network: any): boolean {
  return user.role === "admin" || network.ownerId === user.id;
}

export function createGapHistoryRouter({
  database,
  authMiddleware,
  tables,
}: GapHistoryDependencies) {
  const router = Router();
  const { networks, companies, companyData } = tables;

  router.get("/:id/gap-history", authMiddleware, async (req, res) => {
    const user = (req as any).dbUser;
    const id = Number(req.params.id);
    const [network] = await database.select().from(networks).where(eq(networks.id, id)).limit(1);
    if (!network) { res.status(404).json({ error: "Not found" }); return; }
    if (!canAccess(user, network)) { res.status(403).json({ error: "Forbidden" }); return; }

    const units = await database.select().from(companies).where(eq(companies.networkId, id)) as Unit[];
    if (!units.length) {
      res.json({ networkId: id, metricDefs: METRIC_DEFS, points: [] });
      return;
    }

    const unitIds = units.map((unit: any) => unit.id);
    const rows = await database.select().from(companyData).where(inArray(companyData.companyId, unitIds)) as DataRow[];
    const periods = [...new Set(rows.map((row) => row.period))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const dataByUnitAndPeriod = new Map(rows.map((row: any) => [`${row.companyId}:${row.period}`, row]));

    const points = periods.map((period, periodIndex) => {
      const previousPeriod = periodIndex > 0 ? periods[periodIndex - 1] : null;
      const unitsWithMetrics: Array<{ companyId: number; companyName: string; metrics: Metrics }> = units.flatMap((unit) => {
        const data = dataByUnitAndPeriod.get(`${unit.id}:${period}`);
        if (!data) return [];
        const previousData = previousPeriod
          ? dataByUnitAndPeriod.get(`${unit.id}:${previousPeriod}`)
          : undefined;
        return [{
          companyId: unit.id,
          companyName: unit.name,
          metrics: computeMetrics(data, previousData),
        }];
      });
      const goldStandard = computeGoldStandard(unitsWithMetrics);

      return {
        period,
        unitsWithData: unitsWithMetrics.length,
        // The gold standard is recalculated from the units that have a data
        // row in this period. Keep this explicit in the history contract so
        // consumers can distinguish a benchmark-base change from a real gap
        // movement.
        goldStandardUnitCount: unitsWithMetrics.length,
        units: units.map((unit) => {
          const current = unitsWithMetrics.find((entry) => entry.companyId === unit.id);
          if (!current) {
            return { companyId: unit.id, companyName: unit.name, hasData: false, gapsPct: null };
          }
          const gaps = computeGaps(current.metrics, goldStandard);
          return {
            companyId: unit.id,
            companyName: unit.name,
            hasData: true,
            gapsPct: computeGapsPct(gaps, goldStandard),
          };
        }),
      };
    });

    res.json({ networkId: id, metricDefs: METRIC_DEFS, points });
  });

  return router;
}