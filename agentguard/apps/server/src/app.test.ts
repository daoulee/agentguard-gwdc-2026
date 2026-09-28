import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createApp } from "./app.js";
import { DemoStore } from "./store.js";

test("운영자 세션과 에이전트 토큰을 분리하고 초안부터 승인까지 기록한다", async () => {
  const keys = ["OPERATOR_PASSWORD", "OPERATOR_ID", "AGENT_API_TOKEN", "KILN_API_KEY", "KILN_API_URL"];
  const saved = keys.map(key => process.env[key]);
  process.env.OPERATOR_PASSWORD = "integration-test-password";
  process.env.OPERATOR_ID = "test-operator";
  process.env.AGENT_API_TOKEN = "integration-test-agent-token";
  delete process.env.KILN_API_KEY; delete process.env.KILN_API_URL;
  const directory = mkdtempSync(join(tmpdir(), "agentguard-api-"));
  const store = new DemoStore(join(directory, "state.json"));
  const server = createApp(store).listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(base + path, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body)
  });
  try {
    assert.equal((await fetch(base + "/api/audit")).status, 401);
    assert.equal((await post("/api/session", { password: "wrong" })).status, 401);
    const login = await post("/api/session", { password: "integration-test-password" });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    assert.ok(login.headers.get("set-cookie")!.includes("HttpOnly"));
    const headers = { cookie };
    assert.equal((await post("/api/policy/stop", {}, { ...headers, origin: "https://attacker.invalid" })).status, 403);
    const interpreted = await post("/api/policies/interpret", { prompt: "승인된 판매자에서 오늘 10만원 이하 키보드를 구매하고 9만원 넘으면 승인 받아." }, headers);
    const payload = await interpreted.json() as { draft: Record<string, unknown>; interpretationId: string; processingMs: number };
    assert.equal(interpreted.status, 200);
    assert.ok(payload.processingMs >= 0);
    const forged = await post("/api/policies", { draft: { ...payload.draft, sourceText: "changed" }, interpretationId: payload.interpretationId }, headers);
    assert.equal(forged.status, 400);
    const applied = await post("/api/policies", { draft: { ...payload.draft, autoApprovalLimit: 80_000 }, interpretationId: payload.interpretationId }, headers);
    assert.equal(applied.status, 201);
    const input = { productId: "keyboard-safe", fee: 0, policyId: store.getPolicy().id, clientRequestId: "external-agent-1" };
    assert.equal((await post("/api/agent/requests", input, headers)).status, 401);
    const agentHeaders = { authorization: "Bearer integration-test-agent-token" };
    const agent = await post("/api/agent/requests", input, agentHeaders);
    assert.equal(agent.status, 201);
    const result = await agent.json() as { evaluation: { request: { id: string; source: string }; processingMs: number } };
    assert.equal(result.evaluation.request.source, "agent");
    assert.equal((await post("/api/agent/requests", input, agentHeaders)).status, 200);
    assert.equal((await post(`/api/approvals/${result.evaluation.request.id}`, { action: "approve" }, agentHeaders)).status, 401);
    assert.equal((await post(`/api/approvals/${result.evaluation.request.id}`, { action: "approve" }, headers)).status, 200);
    assert.equal(store.getPolicy().spentKrw, 82_000);
    const events = store.getAuditEvents();
    assert.equal(events.find(e => e.type === "approved")?.details.actor, "test-operator");
    assert.ok(events.some(e => e.type === "policy_interpreted"));
    assert.ok(events.some(e => e.type === "policy_reviewed"));
    assert.ok(store.verifyAuditChain());
    const sample = await promisify(execFile)(process.execPath, ["../../scripts/agent-request.mjs", "keyboard-safe"], {
      env: { ...process.env, AGENTGUARD_URL: base, AGENT_REQUEST_ID: "sample-agent-request" }
    });
    assert.ok(sample.stdout.includes('"source": "agent"'));
    assert.ok(sample.stdout.includes('"status": "block"'));
    assert.equal(store.getPolicy().spentKrw, 82_000);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    rmSync(directory, { recursive: true, force: true });
    keys.forEach((key, index) => { const value = saved[index]; if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  }
});
