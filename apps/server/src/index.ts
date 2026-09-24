import "dotenv/config";
import cors from "cors";
import express from "express";
import { evaluatePurchase } from "@agentguard/policy";
import {
  mockProducts,
  type AuditEvent,
  type HealthResponse,
  type PurchaseEvaluation,
  type PurchaseRequest,
  type SpendingPolicy
} from "@agentguard/shared";

const app = express();
const port = Number(process.env.PORT ?? 8787);

app.use(cors());
app.use(express.json());

const activePolicy: SpendingPolicy = {
  id: "keyboard-delegation",
  name: "키보드 구매 위임",
  budget: 100_000,
  autoApprovalLimit: 90_000,
  currency: "KRW",
  allowedMerchants: ["KeyboardLab", "TechStore"],
  allowedCategories: ["keyboard"],
  deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  requireHumanApproval: true
};

let sequence = 0;
let auditEvents: AuditEvent[] = [];
const pendingApprovals = new Map<string, PurchaseEvaluation>();

const createId = (prefix: string) => `${prefix}-${Date.now()}-${++sequence}`;

const recordAudit = (
  requestId: string,
  type: AuditEvent["type"],
  details: Record<string, unknown>
) => {
  const event: AuditEvent = {
    id: createId("audit"),
    requestId,
    type,
    occurredAt: new Date().toISOString(),
    details
  };
  auditEvents.unshift(event);
  return event;
};

app.get("/api/health", (_request, response) => {
  const payload: HealthResponse = {
    service: "agentguard-server",
    status: "ok",
    timestamp: new Date().toISOString()
  };
  response.json(payload);
});

app.get("/api/products", (_request, response) => response.json({ products: mockProducts }));
app.get("/api/policy", (_request, response) => response.json({ policy: activePolicy }));
app.get("/api/audit", (_request, response) => response.json({ events: auditEvents }));
app.get("/api/approvals", (_request, response) => {
  response.json({ approvals: [...pendingApprovals.values()] });
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

  const purchaseRequest: PurchaseRequest = {
    id: createId("request"),
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

  recordAudit(purchaseRequest.id, "request_received", {
    product: product.name,
    merchant: product.merchant,
    totalAmount: decision.totalAmount
  });

  if (decision.status === "allow") {
    recordAudit(purchaseRequest.id, "allowed", { reasons: decision.reasons });
  } else if (decision.status === "block") {
    recordAudit(purchaseRequest.id, "blocked", { reasons: decision.reasons });
  } else {
    pendingApprovals.set(purchaseRequest.id, evaluation);
    recordAudit(purchaseRequest.id, "approval_requested", { reasons: decision.reasons });
  }

  response.status(201).json({ evaluation });
});

app.post("/api/approvals/:requestId", (request, response) => {
  const pending = pendingApprovals.get(request.params.requestId);
  const { action } = request.body as { action?: "approve" | "reject" };

  if (!pending) {
    response.status(404).json({ message: "대기 중인 승인 요청을 찾을 수 없습니다." });
    return;
  }
  if (action !== "approve" && action !== "reject") {
    response.status(400).json({ message: "approve 또는 reject를 선택해야 합니다." });
    return;
  }

  pendingApprovals.delete(request.params.requestId);
  recordAudit(
    pending.request.id,
    action === "approve" ? "approved" : "rejected",
    { product: pending.product.name, totalAmount: pending.decision.totalAmount, actor: "human_operator" }
  );
  response.json({ status: action === "approve" ? "approved" : "rejected" });
});

app.post("/api/reset", (_request, response) => {
  auditEvents = [];
  pendingApprovals.clear();
  response.status(204).end();
});

app.listen(port, "127.0.0.1", () => {
  console.log(`AgentGuard API listening on http://localhost:${port}`);
});
