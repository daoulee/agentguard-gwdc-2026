import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFallbackPolicyDraft } from "@agentguard/policy";
import { mockProducts } from "@agentguard/shared";
import { DemoStore } from "./store.js";
import { Purchases, RequestError } from "./purchases.js";

test("에이전트 재시도는 재시작 후에도 한 번만 지출하고 ID 내용 변경을 거부한다", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentguard-requests-"));
  try {
    const file = join(directory, "state.json");
    const store = new DemoStore(file);
    const input = { productId: "keyboard-safe", fee: 0, policyId: store.getPolicy().id, clientRequestId: "agent-001" };
    const actor = { id: "test-agent", source: "agent" as const };
    const first = new Purchases(store).evaluate(input, actor);
    const reloaded = new DemoStore(file);
    const second = new Purchases(reloaded).evaluate(input, actor);
    assert.equal(second.replayed, true);
    assert.equal(first.evaluation.request.id, second.evaluation.request.id);
    assert.equal(reloaded.getPolicy().spentKrw, 82_000);
    assert.equal(reloaded.getAuditEvents().filter(e => e.type === "allowed").length, 1);
    assert.ok(first.evaluation.processingMs! >= 0);
    assert.throws(() => new Purchases(reloaded).evaluate({ ...input, fee: 1 }, actor), (e: unknown) => e instanceof RequestError && e.statusCode === 409);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("실행 직전 만료를 재검사하고 승인 재시도로 중복 지출하지 않는다", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentguard-approve-"));
  try {
    const store = new DemoStore(join(directory, "state.json"));
    const service = new Purchases(store);
    const result = service.evaluate({ productId: "keyboard-over-budget", fee: 0, policyId: store.getPolicy().id, clientRequestId: "pending-1" }, { id: "agent", source: "agent" });
    store.getPolicy().deadline = "2000-01-01T00:00:00.000Z";
    assert.throws(() => service.resolve(result.evaluation.request.id, "approve", "operator"), RequestError);
    assert.equal(store.getPolicy().spentKrw, 0);
    assert.equal(store.getPolicy().reservedKrw, 0);
    const draft = createFallbackPolicyDraft("오늘 승인된 판매자에서 10만원 이하 키보드를 사고 9만원 넘으면 승인을 받아.", { availableProducts: mockProducts });
    store.setPolicy(draft);
    const next = service.evaluate({ productId: "keyboard-over-budget", fee: 0, policyId: store.getPolicy().id, clientRequestId: "pending-2" }, { id: "agent", source: "agent" });
    service.resolve(next.evaluation.request.id, "approve", "verified-operator");
    assert.equal(service.resolve(next.evaluation.request.id, "approve", "verified-operator").replayed, true);
    assert.equal(store.getPolicy().spentKrw, 98_000);
    const approved = store.getAuditEvents().find(e => e.type === "approved");
    assert.equal(approved?.details.actor, "verified-operator");
    assert.equal(approved?.details.rechecked, true);
    assert.ok(Number(approved?.details.waitingMs) >= 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("정책 적용은 초안과 최종 값의 차이를 해시 체인에 보존한다", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentguard-review-"));
  try {
    const store = new DemoStore(join(directory, "state.json"));
    const initial = createFallbackPolicyDraft("오늘 승인된 판매자에서 10만원 이하 키보드를 사고 9만원 넘으면 승인을 받아.", { availableProducts: mockProducts });
    const final = { ...initial, autoApprovalLimit: 80_000 };
    store.setPolicy(final, { initialDraft: initial, interpretationId: "i-1", actor: "verified-operator", processingMs: 1 });
    const review = store.getAuditEvents().find(e => e.type === "policy_reviewed");
    assert.deepEqual(review?.details.changedFields, ["autoApprovalLimit"]);
    assert.deepEqual(review?.details.initialDraft, initial);
    assert.ok(store.verifyAuditChain());
    assert.ok(store.getAuditEvents().find(e => e.type === "policy_created")?.details.policySnapshot);
    const before = store.getAuditEvents().length;
    assert.throws(() => store.transaction(() => { store.recordAudit("failure", "blocked", {}); throw new Error("rollback"); }));
    assert.equal(store.getAuditEvents().length, before);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
