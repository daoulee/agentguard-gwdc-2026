import assert from "node:assert/strict";
import test from "node:test";
import type { PurchaseRequest, SpendingPolicy } from "@agentguard/shared";
import { evaluatePurchase } from "./index";

const policy: SpendingPolicy = {
  id: "policy-test",
  name: "테스트 정책",
  budget: 100_000,
  autoApprovalLimit: 90_000,
  currency: "KRW",
  allowedMerchants: ["KeyboardLab", "TechStore"],
  allowedCategories: ["keyboard"],
  deadline: "2099-01-01T00:00:00.000Z",
  requireHumanApproval: true
};

const createRequest = (overrides: Partial<PurchaseRequest> = {}): PurchaseRequest => ({
  id: "request-test",
  policyId: policy.id,
  productId: "keyboard-safe",
  amount: 82_000,
  fee: 0,
  merchant: "KeyboardLab",
  category: "keyboard",
  requestedAt: "2026-09-24T00:00:00.000Z",
  ...overrides
});

test("정책 범위 안의 거래는 자동 승인한다", () => {
  const decision = evaluatePurchase(policy, createRequest());
  assert.equal(decision.status, "allow");
  assert.deepEqual(decision.reasons, ["allowed"]);
});

test("자동 승인 한도를 넘으면 사용자 승인을 요청한다", () => {
  const decision = evaluatePurchase(policy, createRequest({ amount: 98_000 }));
  assert.equal(decision.status, "needs_approval");
  assert.deepEqual(decision.reasons, ["human_approval_required"]);
});

test("미등록 판매자의 거래는 차단한다", () => {
  const decision = evaluatePurchase(policy, createRequest({ merchant: "UnlistedMarket" }));
  assert.equal(decision.status, "block");
  assert.deepEqual(decision.reasons, ["merchant_not_allowed"]);
});

test("상품 가격과 수수료를 합산해 예산을 검사한다", () => {
  const decision = evaluatePurchase(policy, createRequest({ amount: 98_000, fee: 5_000 }));
  assert.equal(decision.status, "block");
  assert.equal(decision.totalAmount, 103_000);
  assert.ok(decision.reasons.includes("budget_exceeded"));
});
