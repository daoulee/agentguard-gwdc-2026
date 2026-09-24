import "dotenv/config";
import cors from "cors";
import express from "express";
import { mockProducts, type HealthResponse } from "@agentguard/shared";

const app = express();
const port = Number(process.env.PORT ?? 8787);

app.use(cors());
app.use(express.json());

app.get("/api/health", (_request, response) => {
  const payload: HealthResponse = {
    service: "agentguard-server",
    status: "ok",
    timestamp: new Date().toISOString()
  };

  response.json(payload);
});

app.get("/api/products", (_request, response) => {
  response.json({ products: mockProducts });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`AgentGuard API listening on http://localhost:${port}`);
});
