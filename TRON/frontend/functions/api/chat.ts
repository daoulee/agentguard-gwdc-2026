// Cloudflare Pages Function: POST /api/chat. Set KILN_API_URL, KILN_API_KEY, KILN_MODEL as
// encrypted environment variables in the Pages project (never in the frontend bundle).
import { handleChat, type ChatRequest, type LlmEnv } from '../../server/llm';

// Only this site's pages may spend the team's Kiln tokens (preview deployments included).
const allowedOrigin = (origin: string | null) => {
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname;
    return host === 'tron-yield-studio-gwdc.pages.dev' || host.endsWith('.tron-yield-studio-gwdc.pages.dev') || host === 'localhost' || host === '127.0.0.1';
  } catch { return false; }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: LlmEnv }) => {
  if (!allowedOrigin(request.headers.get('Origin'))) return Response.json({ ok: false, configured: true, error: 'forbidden_origin' }, { status: 403 });
  let body: ChatRequest;
  try { body = await request.json() as ChatRequest; } catch {
    return Response.json({ ok: false, configured: true, error: 'bad_json' }, { status: 400 });
  }
  const result = await handleChat(body, env);
  return Response.json(result, { status: result.ok || !result.configured ? 200 : 502 });
};
