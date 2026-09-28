import { config } from "dotenv";
import { fileURLToPath } from "node:url";
// npm workspaces run the server with cwd=apps/server, so load the project-root .env explicitly.
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
const { createApp } = await import("./app.js");
const port = Number(process.env.PORT ?? 8787);
createApp().listen(port, "127.0.0.1", () => {
  console.log(`AgentGuard API listening on http://localhost:${port}`);
});
