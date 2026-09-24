import "dotenv/config";
import cors from "cors";
import express from "express";
import { evaluatePurchase, validatePolicyDraft } from "@agentguard/policy";
import {
  mockProducts,
  type HealthResponse,
  type PolicyDraft,
  type PurchaseEvaluation,
  type PurchaseRequest
} from "@agentguard/shared";
import { getAiStatus, interpretPolicy } from "./ai.js";
import { DemoStore } from "./store.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);
const store = new DemoStore();

const isPolicyDraftPayload = (value: unknown): value is PolicyDraft => {
  if (!value || typeof value !== "object") return false;
  const draft = value as Record<string, unknown>;
  return typeof draft.name === "string"
    && typeof draft.sourceText === "string"
    && typeof draft.budget === "number"
    && typeof draft.autoApprovalLimit === "number"
    && draft.currency === "KRW"
    && Array.isArray(draft.allowedMerchants)
    && draft.allowedMerchants.every((merchant) => typeof merchant === "string")
    && Array.isArray(draft.allowedCategories)
    && draft.allowedCategories.every((category) => typeof category === "string")
    && typeof draft.deadline === "string"
    && typeof draft.requireHumanApproval === "boolean"
    && (draft.provider === "kiln" || draft.provider === "safe_fallback")
    && Array.isArray(draft.warnings);
};

app.use(cors());
app.use(express.json({ limit: "32kb" }));

app.get("/api/health", (_request, response) => {
  const payload: HealthResponse = {
    service: "agentguard-server",
    status: "ok",
    timestamp: new Date().toISOString()
  };
  response.json(payload);
});

app.get("/api/ai/status", (_request, response) => response.json(getAiStatus()));
app.get("/api/products", (_request, response) => response.json({ products: mockProducts }));
app.get("/api/policy", (_request, response) => response.json({ policy: store.getPolicy() }));
app.get("/api/audit", (_request, response) => {
  response.json({ events: store.getAuditEvents(), integrityValid: store.verifyAuditChain() });
});
app.get("/api/approvals", (_request, response) => {
  response.json({ approvals: store.getPendingApprovals() });
});

app.post("/api/policies/interpret", async (request, response) => {
  const { prompt } = request.body as { prompt?: string };
  if (!prompt?.trim() || prompt.trim().length < 10) {
    response.status(400).json({ message: "지출 조건을 10자 이상 입력해주세요." });
    return;
  }
  if (prompt.length > 1_000) {
    response.status(400).json({ message: "정책 설명은 1,000자 이하로 입력해주세요." });
    return;
  }

  try {
    const trustedProducts = mockProducts.filter((product) => product.merchant !== "UnlistedMarket");
    const draft = await interpretPolicy(prompt, trustedProducts);
    response.json({ draft });
  } catch {
    response.status(502).json({ message: "정책을 해석하지 못했습니다. 조건을 더 구체적으로 작성해주세요." });
  }
});

app.post("/api/policies", (request, response) => {
  if (!isPolicyDraftPayload(request.body)) {
    response.status(400).json({ message: "정책 초안 형식이 올바르지 않습니다." });
    return;
  }
  const draft = request.body;
  const errors = validatePolicyDraft(draft);
  if (errors.length > 0) {
    response.status(400).json({ message: errors.join(" "), errors });
    return;
  }
  if (new Date(draft.deadline).getTime() <= Date.now()) {
    response.status(400).json({ message: "정책 기한은 현재 시각 이후여야 합니다." });
    return;
  }

  const policy = store.setPolicy(draft);
  response.status(201).json({ policy });
});

app.post("/api/evaluate", (request, response) => {
  const { productId, fee = 0 } = request.body as { productId?: string; fee?: number };
  const product = mockProducts.find((item) => item.id === productId);

  if (!product) {
    response.status(404).json({ message: "상품을 찾을 수 없습니다." });
    return;
  }
  if (!Number.isFinite(fee) || fee < 0) {
    response.status(400).json({ message: "수수료는 0 이상의 숫자여야 합니다." });
    return;
  }

  const activePolicy = store.getPolicy();
  const purchaseRequest: PurchaseRequest = {
    id: store.createId("request"),
    policyId: activePolicy.id,
    productId: product.id,
    amount: product.priceKrw,
    fee,
    merchant: product.merchant,
    category: product.category,
    requestedAt: new Date().toISOString()
  };
  const decision = evaluatePurchase(activePolicy, purchaseRequest);
  const evaluation: PurchaseEvaluation = { product, request: purchaseRequest, decision };

  store.recordAudit(purchaseRequest.id, "request_received", {
    product: product.name,
    merchant: product.merchant,
    totalAmount: decision.totalAmount,
    policyId: activePolicy.id,
    policyVersion: activePolicy.version
  });

  if (decision.status === "allow") {
    store.recordAudit(purchaseRequest.id, "allowed", { reasons: decision.reasons });
  } else if (decision.status === "block") {
    store.recordAudit(purchaseRequest.id, "blocked", { reasons: decision.reasons });
  } else {
    store.addPendingApproval(evaluation);
    store.recordAudit(purchaseRequest.id, "approval_requested", { reasons: decision.reasons });
  }

  response.status(201).json({ evaluation });
});

app.post("/api/approvals/:requestId", (request, response) => {
  const { action } = request.body as { action?: "approve" | "reject" };
  if (action !== "approve" && action !== "reject") {
    response.status(400).json({ message: "approve 또는 reject를 선택해야 합니다." });
    return;
  }

  const pending = store.takePendingApproval(request.params.requestId);
  if (!pending) {
    response.status(404).json({ message: "대기 중인 승인 요청을 찾을 수 없습니다." });
    return;
  }

  store.recordAudit(
    pending.request.id,
    action === "approve" ? "approved" : "rejected",
    { product: pending.product.name, totalAmount: pending.decision.totalAmount, actor: "human_operator" }
  );
  response.json({ status: action === "approve" ? "approved" : "rejected" });
});

app.post("/api/reset", (_request, response) => {
  store.resetActivity();
  response.status(204).end();
});

app.listen(port, "127.0.0.1", () => {
  console.log(`AgentGuard API listening on http://localhost:${port}`);
});
