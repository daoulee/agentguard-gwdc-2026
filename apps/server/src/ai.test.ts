import assert from "node:assert/strict";
import test from "node:test";
import { merchantDirectory, mockProducts } from "@agentguard/shared";
import { interpretPolicy } from "./ai.js";

const trustedMerchants = new Set(merchantDirectory.filter((merchant) => merchant.trusted).map((merchant) => merchant.name));
const trustedProducts = mockProducts.filter((product) => trustedMerchants.has(product.merchant));
const prompt = "승인된 판매자에서 게이밍 모니터를 30만원 이내로 구매해.";

test("AI 금액 충돌은 명시적 예산을 확대하지 않고 확인 대상으로 남긴다", async () => {
  const previousUrl = process.env.KILN_API_URL;
  const previousKey = process.env.KILN_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.KILN_API_URL = "https://kiln.example/v1";
  process.env.KILN_API_KEY = "test-key";
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
    budget: 200000, autoApprovalLimit: 150000, missingFields: []
  }) } }] }));
  try {
    const result = await interpretPolicy("승인된 판매자에서 오늘 10만원 이하 키보드를 구매하고 9만원 넘으면 승인 받아.", trustedProducts);
    assert.equal(result.draft.budget, 100000);
    assert.equal(result.draft.autoApprovalLimit, 90000);
    assert.ok(result.draft.missingFields.includes("budget"));
    assert.ok(result.draft.missingFields.includes("autoApprovalLimit"));
    assert.equal(result.modelCandidate?.budget, 200000);
    assert.ok(result.processingMs >= 0);
    globalThis.fetch = async () => new Response('{invalid json');
    const failed = await interpretPolicy(prompt, trustedProducts);
    assert.equal(failed.usage.status, "failed");
    assert.equal(failed.draft.provider, "safe_fallback");
    assert.equal(failed.usage.totalTokens, null);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.KILN_API_URL;
    else process.env.KILN_API_URL = previousUrl;
    if (previousKey === undefined) delete process.env.KILN_API_KEY;
    else process.env.KILN_API_KEY = previousKey;
  }
});

test("Kiln 미설정 시 토큰 사용량을 추측하지 않는다", async () => {
  const previousUrl = process.env.KILN_API_URL;
  const previousKey = process.env.KILN_API_KEY;
  delete process.env.KILN_API_URL;
  delete process.env.KILN_API_KEY;
  try {
    const result = await interpretPolicy(prompt, trustedProducts);
    assert.equal(result.draft.provider, "safe_fallback");
    assert.equal(result.usage.status, "not_configured");
    assert.equal(result.usage.totalTokens, null);
  } finally {
    if (previousUrl === undefined) delete process.env.KILN_API_URL;
    else process.env.KILN_API_URL = previousUrl;
    if (previousKey === undefined) delete process.env.KILN_API_KEY;
    else process.env.KILN_API_KEY = previousKey;
  }
});

test("Kiln 응답이 누락 조건을 숨겨도 확인을 요구하고 실제 토큰 수를 기록한다", async () => {
  const previousUrl = process.env.KILN_API_URL;
  const previousKey = process.env.KILN_API_KEY;
  const previousModel = process.env.KILN_MODEL;
  const previousFetch = globalThis.fetch;
  process.env.KILN_API_URL = "https://kiln.example/v1";
  process.env.KILN_API_KEY = "test-key";
  delete process.env.KILN_MODEL;
  let requestedModel = "";
  globalThis.fetch = async (_input, init) => {
    requestedModel = (JSON.parse(String(init?.body)) as { model: string }).model;
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        name: "키보드 구매",
        budget: 300000,
        autoApprovalLimit: 300000,
        allowedMerchants: ["KeyboardLab"],
        allowedCategories: ["keyboard"],
        deadline: "2099-01-01T00:00:00.000Z",
        missingFields: [],
        clarifyingQuestions: []
      }) } }],
      usage: { prompt_tokens: 120, completion_tokens: 35, total_tokens: 155 }
    }), { status: 200 });
  };
  try {
    const result = await interpretPolicy(prompt, trustedProducts);
    assert.equal(requestedModel, "Qwen3-32B");
    assert.equal(result.draft.provider, "kiln");
    assert.equal(result.draft.name, "게이밍 모니터 구매 위임");
    assert.deepEqual(result.draft.allowedCategories, ["gaming_monitor"]);
    assert.deepEqual(result.draft.allowedMerchants.sort(), ["DisplayHub", "TechStore"]);
    assert.equal(result.draft.autoApprovalLimit, 0);
    assert.deepEqual(result.draft.missingFields.sort(), ["autoApprovalLimit", "deadline"]);
    assert.equal(result.draft.fieldSources.autoApprovalLimit, "needs_confirmation");
    assert.equal(result.draft.clarifyingQuestions.length, 2);
    assert.equal(result.usage.status, "success");
    assert.equal(result.usage.totalTokens, 155);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.KILN_API_URL;
    else process.env.KILN_API_URL = previousUrl;
    if (previousKey === undefined) delete process.env.KILN_API_KEY;
    else process.env.KILN_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.KILN_MODEL;
    else process.env.KILN_MODEL = previousModel;
  }
});

test("규칙이 모르는 상품 표현은 Kiln이 카탈로그 후보를 채우되 사용자 확인을 남긴다", async () => {
  const previousUrl = process.env.KILN_API_URL;
  const previousKey = process.env.KILN_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.KILN_API_URL = "https://kiln.example/v1";
  process.env.KILN_API_KEY = "test-key";
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      name: "영상 편집용 화면 구매",
      allowedCategories: ["gaming_monitor"],
      allowedMerchants: ["DisplayHub"],
      missingFields: []
    }) } }]
  }), { status: 200 });
  try {
    const result = await interpretPolicy("등록 판매자에서 영상 편집용 화면을 30만원 이내로 사고, 20만원 넘으면 승인 받아. 오늘까지.", trustedProducts);
    assert.deepEqual(result.draft.allowedCategories, ["gaming_monitor"]);
    assert.deepEqual(result.draft.allowedMerchants, ["DisplayHub"]);
    assert.ok(result.draft.missingFields.includes("allowedCategories"));
    assert.ok(result.draft.missingFields.includes("allowedMerchants"));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.KILN_API_URL;
    else process.env.KILN_API_URL = previousUrl;
    if (previousKey === undefined) delete process.env.KILN_API_KEY;
    else process.env.KILN_API_KEY = previousKey;
  }
});
