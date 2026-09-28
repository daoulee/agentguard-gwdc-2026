import { evaluatePurchase } from "@agentguard/policy";
import { mockProducts, type PurchaseEvaluation } from "@agentguard/shared";
import { DemoStore } from "./store.js";

export class RequestError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message); }
}

export class Purchases {
  constructor(private readonly store: DemoStore) {}

  evaluate(input: { productId: string; fee: number; clientRequestId: string; policyId: string },
    actor: { id: string; source: "agent" | "simulator" }) {
    const started = performance.now();
    if (!this.store.verifyAuditChain()) throw new RequestError(409, "감사 기록 검증에 실패했습니다.");
    if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(input.clientRequestId)) throw new RequestError(400, "고유 요청 ID가 필요합니다.");
    if (!Number.isSafeInteger(input.fee) || input.fee < 0) throw new RequestError(400, "수수료는 0 이상의 정수여야 합니다.");
    const key = JSON.stringify([actor.source, actor.id, input.clientRequestId]);
    const fingerprint = JSON.stringify([input.productId, input.fee, input.policyId]);
    const previous = this.store.getProcessedRequest(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new RequestError(409, "같은 요청 ID의 내용을 변경할 수 없습니다.");
      return { evaluation: previous.evaluation, replayed: true };
    }
    const policy = this.store.getPolicy();
    if (input.policyId !== policy.id) throw new RequestError(409, "정책이 변경되었습니다. 현재 정책을 확인해주세요.");
    const product = mockProducts.find(item => item.id === input.productId);
    if (!product) throw new RequestError(404, "상품을 찾을 수 없습니다.");
    return this.store.transaction(() => {
      const request = {
        id: this.store.createId("request"), policyId: policy.id, productId: product.id,
        amount: product.priceKrw, fee: input.fee, merchant: product.merchant, category: product.category,
        requestedAt: new Date().toISOString(), source: actor.source,
        agentId: actor.id, clientRequestId: input.clientRequestId
      };
      const decision = evaluatePurchase(policy, request);
      const processingMs = Math.round((performance.now() - started) * 1000) / 1000;
      const evaluation: PurchaseEvaluation = { product, request, decision, processingMs };
      this.store.recordAudit(request.id, "request_received", {
        product: product.name, merchant: product.merchant, totalAmount: decision.totalAmount,
        policyId: policy.id, policyVersion: policy.version, policySnapshot: structuredClone(policy),
        request, actor: actor.id, source: actor.source
      });
      if (decision.status === "allow") this.store.commitAllowed(evaluation);
      else if (decision.status === "needs_approval") this.store.addPendingApproval(evaluation);
      this.store.recordAudit(request.id, decision.status === "allow" ? "allowed" : decision.status === "block" ? "blocked" : "approval_requested", {
        reasons: decision.reasons, totalAmount: decision.totalAmount, processingMs, actor: "policy_engine"
      });
      this.store.rememberRequest(key, fingerprint, evaluation);
      return { evaluation, replayed: false };
    });
  }

  resolve(requestId: string, action: "approve" | "reject", actor: string) {
    const started = performance.now();
    if (!this.store.verifyAuditChain()) throw new RequestError(409, "감사 기록 검증에 실패했습니다.");
    const pending = this.store.getPendingApprovals().find(item => item.request.id === requestId);
    if (!pending) {
      const prior = this.store.getAuditEvents().find(event => event.requestId === requestId && ["approved", "rejected"].includes(event.type));
      if (prior?.type === (action === "approve" ? "approved" : "rejected")) return { status: prior.type, replayed: true };
      throw new RequestError(prior ? 409 : 404, prior ? "이미 다른 결정으로 처리된 요청입니다." : "대기 중인 요청을 찾을 수 없습니다.");
    }
    const policy = this.store.getPolicy();
    if (action === "approve") {
      if (pending.request.policyId !== policy.id) throw new RequestError(409, "현재 정책과 요청의 정책이 다릅니다.");
      const recheck = evaluatePurchase({ ...policy, reservedKrw: policy.reservedKrw - pending.decision.totalAmount },
        { ...pending.request, requestedAt: new Date().toISOString() });
      if (recheck.status === "block") {
        this.store.transaction(() => {
          this.store.takePendingApproval(requestId, "reject");
          this.store.recordAudit(requestId, "rejected", { reasons: recheck.reasons, actor: "policy_engine", processingMs: performance.now() - started });
        });
        throw new RequestError(409, "실행 직전 정책 재검사에서 차단되었습니다.");
      }
    }
    return this.store.transaction(() => {
      this.store.takePendingApproval(requestId, action);
      this.store.recordAudit(requestId, action === "approve" ? "approved" : "rejected", {
        product: pending.product.name, totalAmount: pending.decision.totalAmount, actor,
        processingMs: Math.round((performance.now() - started) * 1000) / 1000,
        waitingMs: Math.max(0, Date.now() - Date.parse(pending.request.requestedAt)),
        policyId: policy.id, policyVersion: policy.version, rechecked: action === "approve"
      });
      return { status: action === "approve" ? "approved" : "rejected", replayed: false };
    });
  }
}
