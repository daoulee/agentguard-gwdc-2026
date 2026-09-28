// Cloudflare Pages Function: POST /api/chat. Set KILN_API_URL, KILN_API_KEY, KILN_MODEL as
// encrypted environment variables in the Pages project (never in the frontend bundle).
import { handleChat, type ChatRequest, type LlmEnv } from '../../server/llm';

export const onRequestPost = async ({ request, env }: { request: Request; env: LlmEnv }) => {
  let body: ChatRequest;
  try { body = await request.json() as ChatRequest; } catch {
    return Response.json({ ok: false, configured: true, error: 'bad_json' }, { status: 400 });
  }
  const result = await handleChat(body, env);
  return Response.json(result, { status: result.ok || !result.configured ? 200 : 502 });
};
