import "dotenv/config";
import cors from "cors";
import express from "express";
import { evaluatePurchase, validatePolicyDraft } from "@agentguard/policy";
import {
  mockProducts,
  merchantDirectory,
  type HealthResponse,
  type PolicyDraft,
  type PurchaseEvaluation,
  type PurchaseRequest
} from "@agentguard/shared";
import { getAiStatus, interpretPolicy } from "./ai.js";
import { ChainVerificationError, createAnchorData, getChainStatus, verifyAnchorTransaction } from "./chain.js";
import { DemoStore } from "./store.js";
import { summarizeEnergy } from "./energy.js";

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
    && Array.isArray(draft.warnings)
    && draft.warnings.every((warning) => typeof warning === "string")
    && Array.isArray(draft.missingFields)
    && draft.missingFields.every((field) => (
      ["budget", "autoApprovalLimit", "allowedMerchants", "allowedCategories", "deadline"].includes(String(field))
    ))
    && Array.isArray(draft.clarifyingQuestions)
    && draft.clarifyingQuestions.every((question) => typeof question === "string")
    && Boolean(draft.fieldSources)
    && typeof draft.fieldSources === "object";
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
app.get("/api/ai/usage", (_request, response) => response.json({ records: store.getAiUsage() }));
app.get("/api/energy", (_request, response) =>
  response.json(summarizeEnergy(store.getAuditEvents(), store.getAiUsage()))
);
app.get("/api/products", (_request, response) => response.json({ products: mockProducts }));
app.get("/api/policy", (_request, response) => response.json({ policy: store.getPolicy() }));
app.get("/api/audit", (_request, response) => {
  response.json({ events: store.getAuditEvents(), integrityValid: store.verifyAuditChain() });
});
app.get("/api/chain/status", (_request, response) => {
  const { configured, chainId, network } = getChainStatus();
  response.json({ configured, chainId, network });
});
app.get("/api/audit/anchor-payload", (_request, response) => {
  if (!getChainStatus().configured) {
    response.status(503).json({ message: "Sepolia RPC가 설정되지 않았습니다." });
    return;
  }
  if (!store.verifyAuditChain()) {
    response.status(409).json({ message: "감사 기록 검증에 실패했습니다." });
    return;
  }
  const auditHash = store.getAuditEvents()[0]?.hash;
  if (!auditHash) {
    response.status(404).json({ message: "온체인에 기록할 감사 이벤트가 없습니다." });
    return;
  }
  response.json({ auditHash, chainId: getChainStatus().chainId, data: createAnchorData(auditHash) });
});
app.post("/api/audit/anchors", async (request, response) => {
  const { transactionHash, auditHash } = (request.body ?? {}) as { transactionHash?: unknown; auditHash?: unknown };
  if (typeof transactionHash !== "string" || typeof auditHash !== "string"
    || !store.getAuditEvents().some((event) => event.hash === auditHash)) {
    response.status(400).json({ message: "감사 해시 또는 거래 해시가 올바르지 않습니다." });
    return;
  }
  if (!store.verifyAuditChain()) {
    response.status(409).json({ message: "감사 기록 검증에 실패했습니다." });
    return;
  }
  if (store.getAuditEvents().some((event) => event.transactionHash?.toLowerCase() === transactionHash.toLowerCase())) {
    response.status(409).json({ message: "이미 기록된 온체인 거래입니다." });
    return;
  }
  try {
    const verified = await verifyAnchorTransaction(transactionHash, auditHash);
    if (store.getAuditEvents().some((event) => event.transactionHash?.toLowerCase() === transactionHash.toLowerCase())) {
      response.status(409).json({ message: "이미 기록된 온체인 거래입니다." });
      return;
    }
    const event = store.recordAudit("audit-anchor", "submitted", {
      anchoredHash: auditHash,
      chainId: verified.chainId,
      blockNumber: verified.blockNumber
    }, transactionHash);
    response.status(201).json({ event });
  } catch (error) {
    const status = error instanceof ChainVerificationError ? error.statusCode : 502;
    const message = error instanceof ChainVerificationError ? error.message : "테스트넷 거래 검증에 실패했습니다.";
    response.status(status).json({ message });
  }
});
app.get("/api/receipts/:requestId", (request, response) => {
  const allEvents = store.getAuditEvents();
  const events = allEvents.filter((event) => event.requestId === request.params.requestId).reverse();
  if (events.length === 0) {
    response.status(404).json({ message: "해당 구매 요청의 기록을 찾을 수 없습니다." });
    return;
  }
  const newestRequestIndex = allEvents.findIndex((event) => event.requestId === request.params.requestId);
  const anchors = allEvents.filter((event) => {
    if (event.type !== "submitted" || !event.transactionHash) return false;
    const anchoredIndex = allEvents.findIndex((candidate) => candidate.hash === event.details.anchoredHash);
    return anchoredIndex >= 0 && anchoredIndex <= newestRequestIndex;
  }).map((event) => ({
    transactionHash: event.transactionHash,
    anchoredHash: event.details.anchoredHash,
    chainId: event.details.chainId,
    blockNumber: event.details.blockNumber
  }));
  response.json({ requestId: request.params.requestId, events, anchors, integrityValid: store.verifyAuditChain() });
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
    const trustedMerchants = new Set(
      merchantDirectory.filter((merchant) => merchant.trusted).map((merchant) => merchant.name)
    );
    const trustedProducts = mockProducts.filter((product) => trustedMerchants.has(product.merchant));
    const result = await interpretPolicy(prompt, trustedProducts);
    const usage = store.recordAiUsage(result.usage);
    response.json({ draft: result.draft, usage });
  } catch {
    response.status(502).json({ message: "정책을 해석하지 못했습니다. 조건을 더 구체적으로 작성해주세요." });
  }
});

app.post("/api/policies", (request, response) => {
  if (!store.verifyAuditChain()) {
    response.status(409).json({ message: "감사 기록 검증에 실패해 새 지출 권한을 적용할 수 없습니다." });
    return;
  }
  if (!isPolicyDraftPayload(request.body)) {
    response.status(400).json({ message: "정책 초안 형식이 올바르지 않습니다." });
    return;
  }
  const draft = request.body;
  const errors = validatePolicyDraft(draft);
  const trustedMerchants = new Set(merchantDirectory.filter((merchant) => merchant.trusted).map((merchant) => merchant.name));
  const trustedCategories = new Set(mockProducts.filter((product) => trustedMerchants.has(product.merchant)).map((product) => product.category));
  if (draft.allowedMerchants.some((merchant) => !trustedMerchants.has(merchant))) {
    errors.push("등록된 판매자만 허용할 수 있습니다.");
  }
  if (draft.allowedCategories.some((category) => !trustedCategories.has(category))) {
    errors.push("카탈로그에 등록된 카테고리만 허용할 수 있습니다.");
  }
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

app.post("/api/policy/stop", (_request, response) => {
  response.json({ policy: store.stopDelegation() });
});

app.post("/api/evaluate", (request, response) => {
  if (!store.verifyAuditChain()) {
    response.status(409).json({ message: "감사 기록 검증에 실패해 구매 요청을 처리할 수 없습니다." });
    return;
  }
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
    policyVersion: activePolicy.version,
    policySnapshot: { ...activePolicy },
    request: purchaseRequest
  });

  if (decision.status === "allow") {
    store.commitAllowed(evaluation);
    store.recordAudit(purchaseRequest.id, "allowed", { reasons: decision.reasons, totalAmount: decision.totalAmount });
  } else if (decision.status === "block") {
    store.recordAudit(purchaseRequest.id, "blocked", { reasons: decision.reasons, totalAmount: decision.totalAmount });
  } else {
    store.addPendingApproval(evaluation);
    store.recordAudit(purchaseRequest.id, "approval_requested", { reasons: decision.reasons, totalAmount: decision.totalAmount });
  }

  response.status(201).json({ evaluation });
});

app.post("/api/approvals/:requestId", (request, response) => {
  if (!store.verifyAuditChain()) {
    response.status(409).json({ message: "감사 기록 검증에 실패해 승인할 수 없습니다." });
    return;
  }
  const { action } = request.body as { action?: "approve" | "reject" };
  if (action !== "approve" && action !== "reject") {
    response.status(400).json({ message: "approve 또는 reject를 선택해야 합니다." });
    return;
  }

  const pendingRequest = store.getPendingApprovals().find((item) => item.request.id === request.params.requestId);
  if (!pendingRequest) {
    response.status(404).json({ message: "대기 중인 승인 요청을 찾을 수 없습니다." });
    return;
  }
  if (action === "approve" && Date.now() > new Date(store.getPolicy().deadline).getTime()) {
    store.takePendingApproval(request.params.requestId, "reject");
    store.recordAudit(pendingRequest.request.id, "rejected", {
      product: pendingRequest.product.name,
      reason: "deadline_expired",
      actor: "system"
    });
    response.status(409).json({ message: "정책 기한이 지나 승인 요청을 거절했습니다." });
    return;
  }

  const pending = store.takePendingApproval(request.params.requestId, action);
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

app.listen(port, "127.0.0.1", () => {
  console.log(`AgentGuard API listening on http://localhost:${port}`);
});
