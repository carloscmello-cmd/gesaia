export class NarrativeJsonParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NarrativeJsonParseError";
  }
}

/**
 * Extracts the first complete-looking JSON object from an LLM response.
 * The model is asked for plain JSON, but this also accepts explanatory text
 * or Markdown fences around an otherwise valid object.
 */
export function extractNarrativeJson(raw: string): string {
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");

  if (firstBrace < 0 || lastBrace < firstBrace) {
    throw new NarrativeJsonParseError("A resposta da IA não contém um objeto JSON completo.");
  }

  return raw.slice(firstBrace, lastBrace + 1);
}

export function parseNarrativeJson(raw: string): unknown {
  try {
    return JSON.parse(extractNarrativeJson(raw));
  } catch (error) {
    if (error instanceof NarrativeJsonParseError) throw error;
    const reason = error instanceof Error ? error.message : "erro desconhecido";
    throw new NarrativeJsonParseError(`A resposta da IA não contém JSON válido: ${reason}`);
  }
}

/**
 * Calls `callAI(false)` and parses the result as narrative JSON.
 *
 * If the first call returns an invalid/truncated JSON response
 * (`NarrativeJsonParseError`), exactly one retry is attempted by calling
 * `callAI(true)`.  Any other error (network, rate-limit, …) is re-thrown
 * immediately without retrying.
 *
 * @param callAI  Function that invokes the AI and returns the raw text.
 *                Receives `retry = true` on the second call so the caller
 *                can send a different prompt.
 * @returns The parsed narrative object, or throws on double failure.
 */
export async function generateNarrativeWithRetry(
  callAI: (retry: boolean) => Promise<string>,
): Promise<unknown> {
  const tryParse = async (retry: boolean) => parseNarrativeJson(await callAI(retry));
  try {
    return await tryParse(false);
  } catch (error) {
    if (!(error instanceof NarrativeJsonParseError)) throw error;
    return await tryParse(true);
  }
}