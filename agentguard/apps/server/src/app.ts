import express, { type ErrorRequestHandler } from "express";
import { installAccess } from "./access.js";
import { Purchases, RequestError } from "./purchases.js";
import { validatePolicyDraft } from "@agentguard/policy";
import {
  mockProducts,
  merchantDirectory,
  type HealthResponse,
  type PolicyDraft,
} from "@agentguard/shared";
import { getAiStatus, interpretPolicy } from "./ai.js";
import { ChainVerificationError, createAnchorData, getChainStatus, verifyAnchorTransaction } from "./chain.js";
import { DemoStore } from "./store.js";
import { summarizeEnergy } from "./energy.js";

export function createApp(store = new DemoStore()) {
  const app = express();
  const purchases = new Purchases(store);

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

  app.use(express.json({ limit: "32kb" }));
  installAccess(app);

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
    const prompt = request.body?.prompt;
    if (typeof prompt !== "string" || !prompt.trim() || prompt.trim().length < 10) {
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
      const interpretationId = store.createId("interpretation");
      const usage = store.transaction(() => {
        const record = store.recordAiUsage(result.usage);
        store.recordAudit(interpretationId, "policy_interpreted", {
          draft: result.draft, modelCandidate: result.modelCandidate,
          model: record.model, provider: record.provider, providerStatus: record.status,
          usageId: record.id, processingMs: result.processingMs, actor: response.locals.actor
        });
        return record;
      });
      response.json({ draft: result.draft, usage, interpretationId, processingMs: result.processingMs });
    } catch {
      response.status(502).json({ message: "정책을 해석하지 못했습니다. 조건을 더 구체적으로 작성해주세요." });
    }
  });

  app.post("/api/policies", (request, response) => {
    const started = performance.now();
    const draftPayload = request.body?.draft;
    const interpretation = store.getAuditEvents().find(event => event.requestId === request.body?.interpretationId && event.type === "policy_interpreted");
    if (!interpretation) { response.status(400).json({ message: "정책 초안을 먼저 생성해주세요." }); return; }
    const initialDraft = interpretation.details.draft as PolicyDraft;
    if (!store.verifyAuditChain()) {
      response.status(409).json({ message: "감사 기록 검증에 실패해 새 지출 권한을 적용할 수 없습니다." });
      return;
    }
    if (!isPolicyDraftPayload(draftPayload)) {
      response.status(400).json({ message: "정책 초안 형식이 올바르지 않습니다." });
      return;
    }
    const draft = draftPayload;
    if (draft.sourceText !== initialDraft.sourceText || draft.provider !== initialDraft.provider) {
      response.status(400).json({ message: "정책 원문과 해석 출처는 변경할 수 없습니다." }); return;
    }
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

    const policy = store.setPolicy(draft, { initialDraft, interpretationId: interpretation.requestId, actor: response.locals.actor as string, processingMs: Math.round((performance.now() - started) * 1000) / 1000 });
    response.status(201).json({ policy });
  });

  app.post("/api/demo/reset", (_request, response) => {
    const policy = store.reset();
    response.json({ ok: true, policy });
  });
  app.post("/api/policy/stop", (_request, response) => {
    response.json({ policy: store.stopDelegation(response.locals.actor as string) });
  });

  const evaluate = (source: "simulator" | "agent"): express.RequestHandler => (request, response, next) => {
    const { productId, fee = 0, clientRequestId, policyId } = request.body ?? {};
    if (typeof productId !== "string" || typeof clientRequestId !== "string" || typeof policyId !== "string") {
      response.status(400).json({ message: "상품 ID, 고유 요청 ID, 적용할 정책 ID가 필요합니다." }); return;
    }
    try {
      const result = purchases.evaluate({ productId, fee, clientRequestId, policyId }, { id: response.locals.actor as string, source });
      response.status(result.replayed ? 200 : 201).json(result);
    } catch (error) { next(error); }
  };
  app.post("/api/evaluate", evaluate("simulator"));
  app.get("/api/agent/policy", (_request, response) => response.json({ policy: store.getPolicy() }));
  app.post("/api/agent/requests", evaluate("agent"));
  app.post("/api/approvals/:requestId", (request, response, next) => {
    const action = request.body?.action;
    if (action !== "approve" && action !== "reject") {
      response.status(400).json({ message: "approve 또는 reject를 선택해야 합니다." }); return;
    }
    try { response.json(purchases.resolve(String(request.params.requestId), action, response.locals.actor as string)); }
    catch (error) { next(error); }
  });
  const errors: ErrorRequestHandler = (error, _request, response, _next) => {
    const status = error instanceof RequestError ? error.statusCode : error instanceof SyntaxError ? 400 : 500;
    response.status(status).json({ message: error instanceof RequestError ? error.message : status === 400 ? "JSON 형식이 올바르지 않습니다." : "요청을 처리하지 못했습니다." });
  };
  app.use(errors);
  return app;
}
