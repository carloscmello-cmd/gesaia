export interface ReportExportValues {
  companyId: number;
  title: string;
  type: "full_analysis";
  content: Record<string, unknown>;
  idempotencyKey: string | null;
}

export interface ReportExportRecord {
  id: number;
  companyId: number;
  content: Record<string, unknown>;
  createdAt: Date;
}

export interface ReportExportIdempotencyStore {
  findByIdempotencyKey(key: string): Promise<ReportExportRecord | null>;
  insert(values: ReportExportValues): Promise<ReportExportRecord | null>;
}

export interface PersistedReportExport {
  report: ReportExportRecord;
  reused: boolean;
}

/**
 * Persist one PDF export, returning the original record when a transport retry
 * reuses its idempotency key. The insert callback should use a unique
 * constraint with conflict-ignore so concurrent retries converge on one row.
 */
export async function persistReportExport(
  values: ReportExportValues,
  idempotencyStore: ReportExportIdempotencyStore,
): Promise<PersistedReportExport> {
  if (!values.idempotencyKey) {
    const report = await idempotencyStore.insert(values);
    if (!report) throw new Error("Report export could not be persisted");
    return { report, reused: false };
  }

  const existing = await idempotencyStore.findByIdempotencyKey(values.idempotencyKey);
  if (existing) {
    if (existing.companyId !== values.companyId) {
      throw new Error("Report export idempotency key belongs to another company");
    }
    return { report: existing, reused: true };
  }

  const inserted = await idempotencyStore.insert(values);
  if (inserted) return { report: inserted, reused: false };

  // Another request may have won the unique-key race between the lookup and
  // insert. Read it back so both requests return the same saved report.
  const racedReport = await idempotencyStore.findByIdempotencyKey(values.idempotencyKey);
  if (!racedReport) throw new Error("Report export could not be persisted");
  if (racedReport.companyId !== values.companyId) {
    throw new Error("Report export idempotency key belongs to another company");
  }
  return { report: racedReport, reused: true };
}