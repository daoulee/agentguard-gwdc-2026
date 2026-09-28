import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response, NextFunction } from "express";

const equalSecret = (value: string, expected: string) => timingSafeEqual(
  createHash("sha256").update(value).digest(), createHash("sha256").update(expected).digest()
);

export function installAccess(app: Express) {
  const password = process.env.OPERATOR_PASSWORD?.trim() ?? "";
  const token = process.env.AGENT_API_TOKEN?.trim() ?? "";
  const operatorId = process.env.OPERATOR_ID?.trim() || "operator";
  const agentId = process.env.AGENT_ID?.trim() || "purchase-agent";
  const sessions = new Map<string, number>();
  const failures = new Map<string, { count: number; since: number }>();
  const sessionId = (request: Request) => request.headers.cookie?.split(";")
    .map(part => part.trim()).find(part => part.startsWith("agentguard-session="))?.slice(19) ?? "";
  const actor = (request: Request) => {
    if (!password) return "demo_operator";
    const id = sessionId(request);
    if ((sessions.get(id) ?? 0) > Date.now()) return operatorId;
    sessions.delete(id);
    return null;
  };
  // Browser writes must originate from the local UI or the configured deployment.
  app.use("/api", (request, response, next) => {
    const origin = request.headers.origin;
    if (origin) {
      const allowed = ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173", "http://127.0.0.1:4173", process.env.APP_ORIGIN].filter(Boolean);
      if (!allowed.includes(origin)) { response.status(403).json({ message: "허용되지 않은 요청 출처입니다." }); return; }
    }
    if (request.method !== "GET" && request.method !== "OPTIONS" && !request.is("application/json")) {
      response.status(415).json({ message: "JSON 요청만 허용합니다." }); return;
    }
    next();
  });
  app.get("/api/session", (request, response) => response.json({
    mode: password ? "authenticated" : "local_demo", authenticated: Boolean(actor(request)),
    actor: actor(request), agentConfigured: Boolean(token)
  }));
  app.post("/api/session", (request, response) => {
    if (!password) { response.status(409).json({ message: "로컬 데모 모드입니다. 운영자 암호를 먼저 설정해주세요." }); return; }
    const key = request.ip ?? "local";
    const previous = failures.get(key);
    if (previous && Date.now() - previous.since < 60_000 && previous.count >= 5) {
      response.status(429).json({ message: "잠시 후 다시 시도해주세요." }); return;
    }
    if (typeof request.body?.password !== "string" || !equalSecret(request.body.password, password)) {
      failures.set(key, previous && Date.now() - previous.since < 60_000 ? { ...previous, count: previous.count + 1 } : { count: 1, since: Date.now() });
      response.status(401).json({ message: "운영자 암호가 올바르지 않습니다." }); return;
    }
    failures.delete(key);
    for (const [id, expires] of sessions) if (expires <= Date.now()) sessions.delete(id);
    const id = randomBytes(32).toString("hex");
    sessions.set(id, Date.now() + 8 * 60 * 60 * 1000);
    response.cookie("agentguard-session", id, { httpOnly: true, sameSite: "strict", secure: process.env.APP_ORIGIN?.startsWith("https://") ?? false, maxAge: 8 * 60 * 60 * 1000 });
    response.json({ actor: operatorId });
  });
  app.delete("/api/session", (request, response) => {
    sessions.delete(sessionId(request));
    response.clearCookie("agentguard-session");
    response.json({ ok: true });
  });
  app.use("/api", (request: Request, response: Response, next: NextFunction) => {
    if (request.path === "/health") { next(); return; }
    if (request.path.startsWith("/agent/")) {
      if (!token) { response.status(503).json({ message: "에이전트 요청 토큰이 설정되지 않았습니다." }); return; }
      const bearer = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1] ?? "";
      if (!equalSecret(bearer, token)) { response.status(401).json({ message: "에이전트 인증이 필요합니다." }); return; }
      response.locals.actor = agentId;
    } else {
      const id = actor(request);
      if (!id) { response.status(401).json({ message: "운영자 로그인이 필요합니다." }); return; }
      response.locals.actor = id;
    }
    next();
  });
}
