/**
 * Core PDF export helper.
 *
 * Separating the fetch → validate → invalidate sequence from the React
 * component makes the critical post-success behaviour (query invalidation)
 * independently testable without a DOM environment.
 */

export interface PdfExportPayload {
  companyId: number;
  companyName: string;
  segment?: string | null;
  activity?: string | null;
  businessModel?: string | null;
  period?: string | null;
  generatedAt: string;
  kpis: unknown[];
  alerts: unknown[];
  findings: unknown[];
  previousFindings?: unknown[];
  blufRecommendation?: string | null;
}

const PDF_EXPORT_RETRY_WINDOW_MS = 5 * 60 * 1000;
const PDF_EXPORT_STORAGE_PREFIX = "gesaia:pdf-export:";
const memoryRequestIds = new Map<string, { id: string; createdAt: number }>();

interface ExportRequestStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getRequestStorage(): ExportRequestStorage | null {
  if (typeof window !== "undefined" && window.sessionStorage) return window.sessionStorage;
  return null;
}

function getStorageKey(payload: PdfExportPayload): string {
  return `${PDF_EXPORT_STORAGE_PREFIX}${payload.companyId}:${payload.period ?? ""}`;
}

function createRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getExportRequestId(payload: PdfExportPayload): string {
  const key = getStorageKey(payload);
  const storage = getRequestStorage();
  const raw = storage?.getItem(key) ?? JSON.stringify(memoryRequestIds.get(key) ?? null);
  if (raw) {
    try {
      const record = JSON.parse(raw) as { id?: unknown; createdAt?: unknown };
      if (
        typeof record.id === "string" &&
        typeof record.createdAt === "number" &&
        Date.now() - record.createdAt < PDF_EXPORT_RETRY_WINDOW_MS
      ) {
        return record.id;
      }
    } catch {
      // A malformed browser entry is discarded below.
    }
    storage?.removeItem(key);
    memoryRequestIds.delete(key);
  }

  const record = { id: createRequestId(), createdAt: Date.now() };
  if (storage) {
    storage.setItem(key, JSON.stringify(record));
  } else {
    memoryRequestIds.set(key, record);
  }
  return record.id;
}

function clearExportRequestId(payload: PdfExportPayload, requestId: string): void {
  const key = getStorageKey(payload);
  const storage = getRequestStorage();
  const raw = storage?.getItem(key) ?? JSON.stringify(memoryRequestIds.get(key) ?? null);
  try {
    const record = raw ? JSON.parse(raw) as { id?: unknown } : null;
    if (record?.id === requestId) storage?.removeItem(key);
  } catch {
    storage?.removeItem(key);
  }
  const memoryRecord = memoryRequestIds.get(key);
  if (memoryRecord?.id === requestId) memoryRequestIds.delete(key);
}

/**
 * Posts a PDF generation request to `/api/reports/pdf`.
 *
 * On success (`res.ok === true`):
 *   - calls `onSuccess` (callers use this to invalidate the company-reports query)
 *   - resolves with the PDF `Blob`
 *
 * On failure (`res.ok === false` or network error):
 *   - throws an `Error` so the caller can display a toast
 *   - `onSuccess` is **not** called
 *
 * `fetchFn` defaults to the global `fetch` and is overridable for tests.
 */
export async function requestPdfExport(
  payload: PdfExportPayload,
  onSuccess: () => void,
  fetchFn: typeof fetch = fetch,
): Promise<Blob> {
  const requestId = getExportRequestId(payload);
  const res = await fetchFn("/api/reports/pdf", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": requestId,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error("Server PDF generation failed");

  const blob = await res.blob();
  onSuccess();
  clearExportRequestId(payload, requestId);
  return blob;
}
