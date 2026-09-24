import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFallbackPolicyDraft, evaluatePurchase } from "@agentguard/policy";
import { mockProducts, type PurchaseEvaluation, type PurchaseRequest } from "@agentguard/shared";
import { DemoStore } from "./store.js";

test("승인 대기 금액을 예약하고, 승인 시 지출로 확정하며, 중지 시 대기 요청을 취소한다", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentguard-store-"));
  try {
    const store = new DemoStore(join(directory, "state.json"));
    const product = mockProducts.find((item) => item.id === "keyboard-over-budget");
    assert.ok(product);
    const request: PurchaseRequest = {
      id: "request-1", policyId: store.getPolicy().id, productId: product.id,
      amount: product.priceKrw, fee: 0, merchant: product.merchant,
      category: product.category, requestedAt: new Date().toISOString()
    };
    const decision = evaluatePurchase(store.getPolicy(), request);
    assert.equal(decision.status, "needs_approval");
    const evaluation: PurchaseEvaluation = { product, request, decision };
    store.addPendingApproval(evaluation);
    assert.equal(store.getPolicy().reservedKrw, 98_000);

    const nextDecision = evaluatePurchase(store.getPolicy(), { ...request, id: "request-2", amount: 82_000 });
    assert.equal(nextDecision.status, "block");
    assert.ok(nextDecision.reasons.includes("budget_exceeded"));

    store.takePendingApproval(request.id, "approve");
    assert.equal(store.getPolicy().reservedKrw, 0);
    assert.equal(store.getPolicy().spentKrw, 98_000);

    const stopped = store.stopDelegation();
    assert.equal(stopped.status, "stopped");
    assert.equal(evaluatePurchase(stopped, request).status, "block");
    assert.ok(store.verifyAuditChain());
    store.recordAudit("audit-anchor", "submitted", { anchoredHash: store.getAuditEvents()[0]?.hash }, `0x${"a".repeat(64)}`);
    assert.ok(store.verifyAuditChain());
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("감사 로그가 변조되면 재시작 후 위임을 중지한다", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentguard-tamper-"));
  const path = join(directory, "state.json");
  try {
    const store = new DemoStore(path);
    const draft = createFallbackPolicyDraft(
      "KeyboardLab에서 오늘 안에 8만 5천원 이하 키보드만 자동 구매해.",
      { availableProducts: mockProducts }
    );
    store.setPolicy(draft);
    const state = JSON.parse(readFileSync(path, "utf8")) as { auditEvents: Array<{ details: Record<string, unknown> }> };
    state.auditEvents[0]!.details.name = "변조된 정책";
    writeFileSync(path, JSON.stringify(state));
    const reloaded = new DemoStore(path);
    assert.equal(reloaded.verifyAuditChain(), false);
    assert.equal(reloaded.getPolicy().status, "stopped");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
