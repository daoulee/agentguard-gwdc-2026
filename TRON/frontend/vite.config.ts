import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { handleChat, type ChatRequest } from './server/llm';

// Serves POST /api/chat during `npm run dev` with the same handler as the Pages Function.
function kilnDevApi(env: Record<string, string>): Plugin {
  return {
    name: 'kiln-dev-api',
    configureServer(server) {
      server.middlewares.use('/api/chat', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', async () => {
          let body: ChatRequest;
          try { body = JSON.parse(raw) as ChatRequest; } catch { res.statusCode = 400; res.end('{"ok":false,"error":"bad_json"}'); return; }
          const result = await handleChat(body, env);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), kilnDevApi(loadEnv(mode, process.cwd(), 'KILN_'))],
  server: { port: 5180 },
}));
