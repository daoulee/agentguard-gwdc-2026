// Server-side Kiln (OpenAI-compatible) proxy shared by the Cloudflare Pages Function and the
// Vite dev middleware. The API key never reaches the browser.

export type LlmEnv = { KILN_API_URL?: string; KILN_API_KEY?: string; KILN_MODEL?: string };
export type ChatRequest = { mode: 'status' | 'extract' | 'explain'; text?: string; known?: unknown; plan?: unknown };
export type ChatResponse =
  | { ok: true; provider: string; model: string; result: unknown; usage: Usage; processingMs: number }
  | { ok: false; configured: boolean; error: string };
type Usage = { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null };

const EXTRACT_PROMPT = `You extract a TRON investor's needs from Korean conversation. Return ONLY a JSON object:
{"holdings":[{"asset":"USDT|USDD|TRX","amount":number}],"horizonDays":integer|null,"liquidity":"instant|month|long"|null,"risk":"conservative|balanced|aggressive"|null,"reserveAmount":number|null}
Rules: use only facts the user actually stated; use null when unsure; never guess amounts. liquidity: instant = may withdraw any time, month = needs some money within ~30 days, long = will not touch it. Korean units: 만 = 10000, 천 = 1000.`;

const EXPLAIN_PROMPT = `You explain a TRON yield allocation plan to a Korean retail user. You receive the plan as JSON computed by deterministic code.
Write 4-6 short Korean sentences covering: why this allocation fits the user's needs, what they must do to participate (approvals, conversions), how the yield splits into base yield vs time-limited incentive rewards, the operating costs, and the main risks and exit conditions.
Use ONLY numbers that appear in the JSON, copied exactly. Never promise returns. Do not invent products, rates, dates or campaigns. No markdown headings.`;

const stripThinking = (content: string) => content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

export function extractJson(content: string): unknown {
  const text = stripThinking(content).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('no_json_object');
  return JSON.parse(text.slice(start, end + 1));
}

export async function handleChat(request: ChatRequest, env: LlmEnv): Promise<ChatResponse> {
  const apiUrl = env.KILN_API_URL?.trim() ?? '';
  const apiKey = env.KILN_API_KEY?.trim() ?? '';
  const model = env.KILN_MODEL?.trim() || 'qwen3-32b';
  if (!apiUrl || !apiKey) return { ok: false, configured: false, error: 'not_configured' };
  if (request.mode !== 'status' && request.mode !== 'extract' && request.mode !== 'explain') return { ok: false, configured: true, error: 'bad_mode' };
  if (request.mode === 'status') return { ok: true, provider: 'kiln', model, result: { configured: true }, usage: { promptTokens: null, completionTokens: null, totalTokens: null }, processingMs: 0 };

  const userContent = request.mode === 'extract'
    ? `Known so far: ${JSON.stringify(request.known ?? {}).slice(0, 1500)}\nConversation:\n${String(request.text ?? '').slice(0, 2000)}`
    : JSON.stringify(request.plan ?? {}).slice(0, 6000);
  const endpoint = apiUrl.endsWith('/chat/completions') ? apiUrl : `${apiUrl.replace(/\/$/, '')}/chat/completions`;
  const started = Date.now();
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: request.mode === 'extract' ? EXTRACT_PROMPT : EXPLAIN_PROMPT },
          // "/no_think" is Qwen3's soft switch to skip the reasoning block.
          { role: 'user', content: `${userContent}\n/no_think` },
        ],
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) return { ok: false, configured: true, error: `kiln_http_${response.status}` };
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: Record<string, unknown> };
    const content = payload.choices?.[0]?.message?.content ?? '';
    if (!content) return { ok: false, configured: true, error: 'kiln_empty_response' };
    const tokens = (key: string) => typeof payload.usage?.[key] === 'number' ? payload.usage[key] as number : null;
    return {
      ok: true,
      provider: 'kiln',
      model,
      result: request.mode === 'extract' ? extractJson(content) : stripThinking(content),
      usage: { promptTokens: tokens('prompt_tokens'), completionTokens: tokens('completion_tokens'), totalTokens: tokens('total_tokens') },
      processingMs: Date.now() - started,
    };
  } catch (error) {
    return { ok: false, configured: true, error: error instanceof Error ? error.message.slice(0, 120) : 'kiln_failed' };
  }
}
