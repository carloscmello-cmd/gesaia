import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { calculationRuns, companies, companyContexts, companyData, networks } from "@workspace/db/schema";
import { requireAuth } from "../middlewares/requireAuth";
import {
  mapImportedCompanyDataRow,
  serializeCompanyData,
  validateCompanyDataInput,
  validateCompanyDataImportMapping,
} from "./companyDataFields";
import { canAccessCompany } from "./companyAuthorization";
import { latestCompletedFullAnalysisAt, needsReanalysis } from "./periodAnalysisStatus";
import { isScoreThresholds } from "../lib/scoreThresholds";

const router = Router();

type ScoreThresholds = {
  greenMin: number;
  yellowMin: number;
};

function parseScoreThresholds(value: unknown): { value?: ScoreThresholds | null; error?: string } {
  if (value === undefined || value === null) return { value: value ?? null };
  if (!isScoreThresholds(value)) {
    return { error: "scoreThresholds must satisfy 0 <= yellowMin < greenMin <= 100" };
  }

  return { value };
}

function serializeCompany(company: typeof companies.$inferSelect) {
  return {
    id: company.id,
    name: company.name,
    segment: company.segment,
    activity: company.activity,
    businessModel: company.businessModel,
    networkId: company.networkId,
    scoreThresholds: company.scoreThresholds,
    ownerId: company.ownerId,
    createdAt: company.createdAt,
  };
}

// GET /api/companies
router.get("/", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  let rows;
  if (user.role === "admin") {
    rows = await db.select().from(companies).orderBy(desc(companies.createdAt));
  } else {
    rows = await db.select().from(companies).where(eq(companies.ownerId, user.id)).orderBy(desc(companies.createdAt));
  }
  res.json(rows.map(serializeCompany));
});

// POST /api/companies
router.post("/", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const { name, segment, activity, businessModel, networkId, scoreThresholds } = req.body;
  if (!name || !segment || !activity || !businessModel) {
    res.status(400).json({ error: "name, segment, activity, businessModel required" });
    return;
  }
  if (scoreThresholds !== undefined && user.role !== "admin") {
    res.status(403).json({ error: "Only admins can configure score thresholds" });
    return;
  }
  const parsedThresholds = parseScoreThresholds(scoreThresholds);
  if (parsedThresholds.error) {
    res.status(400).json({ error: parsedThresholds.error });
    return;
  }

  const values: typeof companies.$inferInsert = {
    name,
    segment,
    activity,
    businessModel,
    networkId: networkId ?? null,
    ownerId: user.id,
  };
  if (scoreThresholds !== undefined) values.scoreThresholds = parsedThresholds.value;

  const [company] = await db.insert(companies).values(values).returning();
  res.status(201).json(serializeCompany(company));
});

// GET /api/companies/:id
router.get("/:id", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }
  if (!canAccessCompany(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }
  res.json(serializeCompany(company));
});

// PATCH /api/companies/:id
router.patch("/:id", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }
  if (!canAccessCompany(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }

  const { name, segment, activity, businessModel, networkId, scoreThresholds } = req.body;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (segment !== undefined) updates.segment = segment;
  if (activity !== undefined) updates.activity = activity;
  if (businessModel !== undefined) updates.businessModel = businessModel;
  if (scoreThresholds !== undefined) {
    if (user.role !== "admin") {
      res.status(403).json({ error: "Only admins can configure score thresholds" });
      return;
    }
    const parsedThresholds = parseScoreThresholds(scoreThresholds);
    if (parsedThresholds.error) {
      res.status(400).json({ error: parsedThresholds.error });
      return;
    }
    updates.scoreThresholds = parsedThresholds.value;
  }
  // networkId can be a number (link) or null (unlink)
  if (networkId !== undefined) {
    if (networkId === null) {
      // Unlinking is always permitted
      updates.networkId = null;
    } else {
      // Verify the target network exists and belongs to this user (cross-tenant guard)
      const [network] = await db.select().from(networks).where(eq(networks.id, Number(networkId))).limit(1);
      if (!network) { res.status(404).json({ error: "Network not found" }); return; }
      if (network.ownerId !== user.id && user.role !== "admin") {
        res.status(403).json({ error: "Forbidden: network belongs to another tenant" });
        return;
      }
      updates.networkId = networkId;
    }
  }

  const [updated] = await db.update(companies).set(updates).where(eq(companies.id, id)).returning();
  res.json(serializeCompany(updated));
});

// DELETE /api/companies/:id
router.delete("/:id", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }
  if (!canAccessCompany(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }
  await db.delete(companies).where(eq(companies.id, id));
  res.status(204).send();
});

// GET /api/companies/:id/context
router.get("/:id/context", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }
  if (!canAccessCompany(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }

  const [ctx] = await db.select().from(companyContexts).where(eq(companyContexts.companyId, id)).limit(1);
  if (!ctx) { res.status(404).json({ error: "Context not found" }); return; }
  res.json({ id: ctx.id, companyId: ctx.companyId, productsServices: ctx.productsServices, mainMarket: ctx.mainMarket, competitors: ctx.competitors, mainChallenges: ctx.mainChallenges, additionalNotes: ctx.additionalNotes, updatedAt: ctx.updatedAt });
});

// PUT /api/companies/:id/context
router.put("/:id/context", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }
  if (!canAccessCompany(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }

  const { productsServices, mainMarket, competitors, mainChallenges, additionalNotes } = req.body;
  const now = new Date();
  const [ctx] = await db.insert(companyContexts)
    .values({ companyId: id, productsServices, mainMarket, competitors, mainChallenges, additionalNotes, updatedAt: now })
    .onConflictDoUpdate({
      target: companyContexts.companyId,
      set: { productsServices, mainMarket, competitors, mainChallenges, additionalNotes, updatedAt: now },
    })
    .returning();
  res.json({ id: ctx.id, companyId: ctx.companyId, productsServices: ctx.productsServices, mainMarket: ctx.mainMarket, competitors: ctx.competitors, mainChallenges: ctx.mainChallenges, additionalNotes: ctx.additionalNotes, updatedAt: ctx.updatedAt });
});

// GET /api/companies/:id/periods  (alias used by generated client)
// GET /api/companies/:id/data/periods  (legacy path)
async function listPeriodsHandler(req: any, res: any) {
  const user = req.dbUser;
  const id = Number(req.params.id);
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }
  if (!canAccessCompany(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }

  const rows = await db
    .select({ period: companyData.period, updatedAt: companyData.updatedAt })
    .from(companyData)
    .where(eq(companyData.companyId, id))
    .orderBy(desc(companyData.period));
  const runs = await db
    .select()
    .from(calculationRuns)
    .where(and(
      eq(calculationRuns.companyId, id),
      eq(calculationRuns.status, "completed"),
    ))
    .orderBy(desc(calculationRuns.createdAt));

  const runsByPeriod = new Map<string, typeof runs>();
  for (const run of runs) {
    const periodRuns = runsByPeriod.get(run.period) ?? [];
    periodRuns.push(run);
    runsByPeriod.set(run.period, periodRuns);
  }

  res.json(rows.map((row) => {
    const latestFullAnalysisAt = latestCompletedFullAnalysisAt(runsByPeriod.get(row.period) ?? []);
    return {
      period: row.period,
      hasData: true,
      updatedAt: row.updatedAt,
      latestFullAnalysisAt,
      needsReanalysis: needsReanalysis(row.updatedAt, latestFullAnalysisAt),
    };
  }));
}
router.get("/:id/periods",      requireAuth, listPeriodsHandler);
router.get("/:id/data/periods", requireAuth, listPeriodsHandler);

// GET /api/companies/:id/data
router.get("/:id/data", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const { period } = req.query;
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }
  if (!canAccessCompany(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }

  const where = period
    ? and(eq(companyData.companyId, id), eq(companyData.period, String(period)))
    : eq(companyData.companyId, id);
  const [row] = await db.select().from(companyData).where(where).limit(1);
  if (!row) { res.status(404).json({ error: "Data not found" }); return; }
  res.json(serializeCompanyData(row));
});

// PUT /api/companies/:id/data
router.put("/:id/data", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }
  if (!canAccessCompany(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }

  const validated = validateCompanyDataInput(req.body);
  if (!validated.ok) {
    res.status(400).json({ error: validated.error });
    return;
  }
  const now = new Date();
  const values = { companyId: id, ...validated.values, updatedAt: now } as any;
  const [row] = await db.insert(companyData)
    .values(values)
    .onConflictDoUpdate({
      target: [companyData.companyId, companyData.period],
      set: { ...validated.values, updatedAt: now },
    })
    .returning();
  res.json(serializeCompanyData(row));
});

// POST /api/companies/:id/data/import
router.post("/:id/data/import", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const id = Number(req.params.id);
  const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!company) { res.status(404).json({ error: "Company not found" }); return; }
  if (!canAccessCompany(user, company)) { res.status(403).json({ error: "Forbidden" }); return; }

  const { rows, mapping } = req.body;
  if (!Array.isArray(rows) || !mapping) {
    res.status(400).json({ error: "rows and mapping required" });
    return;
  }
  const mappingValidation = validateCompanyDataImportMapping(mapping);
  if (!mappingValidation.ok) {
    res.status(400).json({ error: mappingValidation.error });
    return;
  }
  const importMapping = mappingValidation.mapping;

  const errors: string[] = [];
  const warnings: string[] = [];
  let imported = 0;

  for (let i = 0; i < rows.length; i++) {
    const rawRow = rows[i];
    try {
      const isMissingPeriod = (
        rawRow &&
        typeof rawRow === "object" &&
        !Array.isArray(rawRow) &&
        !(rawRow as Record<string, unknown>)[importMapping.period]
      );
      const validated = mapImportedCompanyDataRow(rawRow, importMapping);
      if (
        !validated.ok &&
        validated.error === "period must be a non-empty string" &&
        isMissingPeriod
      ) {
        warnings.push(`Row ${i + 1}: missing period, skipped`);
        continue;
      }
      if (!validated.ok) throw new Error(validated.error);

      const now = new Date();
      const values = { companyId: id, ...validated.values, updatedAt: now } as any;
      await db.insert(companyData).values(values)
        .onConflictDoUpdate({ target: [companyData.companyId, companyData.period], set: { ...validated.values, updatedAt: now } });
      imported++;
    } catch (e: any) {
      errors.push(`Row ${i + 1}: ${e.message}`);
    }
  }

  res.json({ imported, errors, warnings });
});

export default router;
