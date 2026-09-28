// Browser side of /api/chat. The key lives on the server; the browser only sees results.
export type AiUsage = { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null };
export type AiResult<T> = { ok: true; model: string; result: T; usage: AiUsage; processingMs: number } | { ok: false; configured: boolean; error: string };

export async function callAi<T>(body: Record<string, unknown>): Promise<AiResult<T>> {
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404 || response.status === 405) return { ok: false, configured: false, error: 'no_api' };
    return await response.json() as AiResult<T>;
  } catch (error) {
    return { ok: false, configured: false, error: error instanceof Error ? error.message : 'network' };
  }
}
