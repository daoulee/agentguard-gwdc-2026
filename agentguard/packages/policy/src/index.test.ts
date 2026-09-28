import assert from "node:assert/strict";
import test from "node:test";
import { mockProducts, type PurchaseRequest, type SpendingPolicy } from "@agentguard/shared";
import { createFallbackPolicyDraft, evaluatePurchase, validatePolicyDraft } from "./index";

const policy: SpendingPolicy = {
  id: "policy-test",
  name: "테스트 정책",
  budget: 100_000,
  autoApprovalLimit: 90_000,
  currency: "KRW",
  allowedMerchants: ["KeyboardLab", "TechStore"],
  allowedCategories: ["keyboard"],
  deadline: "2099-01-01T00:00:00.000Z",
  requireHumanApproval: true,
  sourceText: "테스트 정책",
  interpretationProvider: "safe_fallback",
  version: 1,
  updatedAt: "2026-09-24T00:00:00.000Z",
  status: "active",
  spentKrw: 0,
  reservedKrw: 0
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

test("안으로 예산과 달력 기한을 해석하며 과거 날짜를 임의로 연장하지 않는다", () => {
  const options = { availableProducts: mockProducts, now: new Date(2026, 8, 27, 12) };
  const draft = createFallbackPolicyDraft("게이밍 모니터를 구매해야해 . 30만원 안으로 . 9월 22일까지", options);
  assert.equal(draft.budget, 300_000);
  assert.ok(!draft.missingFields.includes("budget"));
  assert.deepEqual(draft.allowedCategories, ["gaming_monitor"]);
  assert.equal(new Date(draft.deadline).getDate(), 22);
  assert.equal(new Date(draft.deadline).getMonth(), 8);
  assert.ok(draft.missingFields.includes("deadline"));
  assert.ok(draft.warnings.some(warning => warning.includes("이미 지났")));
  const future = createFallbackPolicyDraft("승인된 판매자에서 게이밍 모니터를 30만원 안으로 자동 구매. 10월 2일까지", options);
  assert.ok(!future.missingFields.includes("deadline"));
  assert.equal(new Date(future.deadline).getMonth(), 9);
  const invalid = createFallbackPolicyDraft("30만원 안으로. 2월 30일까지", options);
  assert.ok(invalid.missingFields.includes("deadline"));
});

test("예산보다 큰 승인 기준을 예산으로 바꾸지 않고 확인을 요구한다", () => {
  const draft = createFallbackPolicyDraft("승인된 판매자에서 오늘 10만원 이하 키보드를 구매하고, 20만원이 넘으면 내 승인을 받아.", { availableProducts: mockProducts });
  assert.equal(draft.budget, 100_000);
  assert.equal(draft.autoApprovalLimit, 0);
  assert.ok(draft.missingFields.includes("autoApprovalLimit"));
  assert.ok(validatePolicyDraft(draft).length > 0);
});

test("금액 순서가 바뀌어도 역할을 구분하고 서로 다른 예산은 확인한다", () => {
  const first = createFallbackPolicyDraft("9만원 넘으면 승인 받고, 오늘 예산 10만원 이하로 키보드를 구매해.", { availableProducts: mockProducts });
  assert.equal(first.budget, 100_000);
  assert.equal(first.autoApprovalLimit, 90_000);
  const ambiguous = createFallbackPolicyDraft("오늘 키보드 예산 10만원, 최대 20만원, 9만원 넘으면 승인 받아.", { availableProducts: mockProducts });
  assert.ok(ambiguous.missingFields.includes("budget"));
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

test("이미 지출하거나 승인 대기 중인 금액을 총예산에서 차감한다", () => {
  const decision = evaluatePurchase(
    { ...policy, spentKrw: 20_000, reservedKrw: 10_000 },
    createRequest({ amount: 65_000, fee: 6_000 })
  );
  assert.equal(decision.status, "block");
  assert.ok(decision.reasons.includes("budget_exceeded"));
});

test("사용자가 위임을 중지하면 허용 범위 안의 요청도 차단한다", () => {
  const decision = evaluatePurchase({ ...policy, status: "stopped" }, createRequest());
  assert.equal(decision.status, "block");
  assert.ok(decision.reasons.includes("delegation_stopped"));
});

test("한국어 정책 문장에서 예산과 승인 한도를 추출한다", () => {
  const draft = createFallbackPolicyDraft(
    "승인된 판매자에서 10만원 이하 키보드를 구매하고 9만원이 넘으면 내 승인을 받아. 오늘까지.",
    { availableProducts: mockProducts.filter((product) => product.merchant !== "UnlistedMarket"), now: new Date("2026-09-24T00:00:00.000Z") }
  );

  assert.equal(draft.budget, 100_000);
  assert.equal(draft.autoApprovalLimit, 90_000);
  assert.deepEqual(draft.allowedCategories, ["keyboard"]);
  assert.equal(validatePolicyDraft(draft).length, 0);
});

test("8만 5천원처럼 결합된 금액을 해석한다", () => {
  const draft = createFallbackPolicyDraft(
    "KeyboardLab에서 오늘 안에 8만 5천원 이하 키보드만 자동 구매해.",
    { availableProducts: mockProducts.filter((product) => product.merchant !== "UnlistedMarket"), now: new Date("2026-09-24T00:00:00.000Z") }
  );
  assert.equal(draft.budget, 85_000);
  assert.equal(draft.autoApprovalLimit, 85_000);
});

test("게이밍 모니터 의도를 카탈로그에 맞게 보정하고 누락 조건을 질문한다", () => {
  const draft = createFallbackPolicyDraft(
    "승인된 판매자에서 게이밍 모니터를 30만원 이내로 구매해.",
    { availableProducts: mockProducts.filter((product) => product.merchant !== "UnlistedMarket"), now: new Date("2026-09-24T00:00:00.000Z") }
  );

  assert.equal(draft.name, "게이밍 모니터 구매 위임");
  assert.deepEqual(draft.allowedCategories, ["gaming_monitor"]);
  assert.deepEqual(draft.allowedMerchants.sort(), ["DisplayHub", "TechStore"]);
  assert.equal(draft.budget, 300_000);
  assert.equal(draft.autoApprovalLimit, 0);
  assert.deepEqual(draft.missingFields.sort(), ["autoApprovalLimit", "deadline"]);
  assert.equal(validatePolicyDraft(draft, { allowIncomplete: true }).length, 0);
  assert.ok(validatePolicyDraft(draft).length > 0);
});
