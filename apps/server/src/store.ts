import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuditEvent, PolicyDraft, PurchaseEvaluation, SpendingPolicy } from "@agentguard/shared";

type StoredState = {
  activePolicy: SpendingPolicy;
  auditEvents: AuditEvent[];
  pendingApprovals: PurchaseEvaluation[];
};

const stateFilePath = fileURLToPath(new URL("../data/state.json", import.meta.url));

const createDefaultPolicy = (): SpendingPolicy => ({
  id: "keyboard-delegation-v1",
  name: "키보드 구매 위임",
  budget: 100_000,
  autoApprovalLimit: 90_000,
  currency: "KRW",
  allowedMerchants: ["KeyboardLab", "TechStore"],
  allowedCategories: ["keyboard"],
  deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  requireHumanApproval: true,
  sourceText: "승인된 판매자에서 10만원 이하 키보드를 구매하고, 9만원이 넘으면 내 승인을 받아.",
  interpretationProvider: "safe_fallback",
  version: 1,
  updatedAt: new Date().toISOString()
});

const hashEvent = (event: Omit<AuditEvent, "hash">) => createHash("sha256")
  .update(JSON.stringify(event))
  .digest("hex");

export class DemoStore {
  private state: StoredState;
  private sequence = 0;

  constructor() {
    this.state = this.load();
  }

  private load(): StoredState {
    try {
      return JSON.parse(readFileSync(stateFilePath, "utf8")) as StoredState;
    } catch {
      return { activePolicy: createDefaultPolicy(), auditEvents: [], pendingApprovals: [] };
    }
  }

  private persist() {
    mkdirSync(dirname(stateFilePath), { recursive: true });
    const temporaryPath = `${stateFilePath}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(this.state, null, 2));
    renameSync(temporaryPath, stateFilePath);
  }

  createId(prefix: string) {
    return `${prefix}-${Date.now()}-${++this.sequence}`;
  }

  getPolicy() {
    return this.state.activePolicy;
  }

  setPolicy(draft: PolicyDraft) {
    for (const pending of this.state.pendingApprovals) {
      this.recordAudit(pending.request.id, "rejected", {
        product: pending.product.name,
        reason: "policy_updated",
        actor: "system"
      });
    }
    this.state.pendingApprovals = [];

    const policy: SpendingPolicy = {
      id: this.createId("policy"),
      name: draft.name,
      budget: draft.budget,
      autoApprovalLimit: draft.autoApprovalLimit,
      currency: draft.currency,
      allowedMerchants: [...draft.allowedMerchants],
      allowedCategories: [...draft.allowedCategories],
      deadline: draft.deadline,
      requireHumanApproval: draft.requireHumanApproval,
      sourceText: draft.sourceText,
      interpretationProvider: draft.provider,
      version: this.state.activePolicy.version + 1,
      updatedAt: new Date().toISOString()
    };

    this.state.activePolicy = policy;
    this.recordAudit(policy.id, "policy_created", {
      name: policy.name,
      version: policy.version,
      provider: policy.interpretationProvider,
      budget: policy.budget,
      autoApprovalLimit: policy.autoApprovalLimit
    });
    this.persist();
    return policy;
  }

  getAuditEvents() {
    return this.state.auditEvents;
  }

  verifyAuditChain() {
    let previousHash = "GENESIS";
    for (const event of [...this.state.auditEvents].reverse()) {
      const { hash, ...hashableEvent } = event;
      if (event.previousHash !== previousHash || hashEvent(hashableEvent) !== hash) return false;
      previousHash = event.hash;
    }
    return true;
  }

  recordAudit(requestId: string, type: AuditEvent["type"], details: Record<string, unknown>) {
    const previousHash = this.state.auditEvents[0]?.hash ?? "GENESIS";
    const hashableEvent: Omit<AuditEvent, "hash"> = {
      id: this.createId("audit"),
      requestId,
      type,
      occurredAt: new Date().toISOString(),
      details,
      previousHash
    };
    const event: AuditEvent = { ...hashableEvent, hash: hashEvent(hashableEvent) };
    this.state.auditEvents.unshift(event);
    this.persist();
    return event;
  }

  getPendingApprovals() {
    return this.state.pendingApprovals;
  }

  addPendingApproval(evaluation: PurchaseEvaluation) {
    this.state.pendingApprovals.push(evaluation);
    this.persist();
  }

  takePendingApproval(requestId: string) {
    const index = this.state.pendingApprovals.findIndex((item) => item.request.id === requestId);
    if (index < 0) return undefined;
    const [pending] = this.state.pendingApprovals.splice(index, 1);
    this.persist();
    return pending;
  }

  resetActivity() {
    this.state.auditEvents = [];
    this.state.pendingApprovals = [];
    this.persist();
  }
}
