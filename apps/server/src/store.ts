import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AiUsageRecord, AuditEvent, PolicyDraft, PurchaseEvaluation, SpendingPolicy } from "@agentguard/shared";

type StoredState = {
  activePolicy: SpendingPolicy;
  auditEvents: AuditEvent[];
  pendingApprovals: PurchaseEvaluation[];
  aiUsage: AiUsageRecord[];
};

const defaultStateFilePath = fileURLToPath(new URL("../data/state.json", import.meta.url));

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
  updatedAt: new Date().toISOString(),
  status: "active",
  spentKrw: 0,
  reservedKrw: 0
});

const hashEvent = (event: Omit<AuditEvent, "hash">) => createHash("sha256")
  .update(JSON.stringify(event))
  .digest("hex");

export class DemoStore {
  private state: StoredState;
  private sequence = 0;

  constructor(private readonly stateFilePath = defaultStateFilePath) {
    this.state = this.load();
    if (!this.verifyAuditChain()) this.state.activePolicy.status = "stopped";
  }

  private load(): StoredState {
    try {
      const parsed = JSON.parse(readFileSync(this.stateFilePath, "utf8")) as StoredState;
      const activePolicyId = parsed.activePolicy.id;
      const requestEvents = new Map(parsed.auditEvents
        .filter((event) => event.type === "request_received")
        .map((event) => [event.requestId, event]));
      const migratedSpend = parsed.auditEvents
        .filter((event) => event.type === "allowed" || event.type === "approved")
        .reduce((total, event) => {
          const request = requestEvents.get(event.requestId);
          if (request?.details.policyId !== activePolicyId) return total;
          const amount = Number(request.details.totalAmount);
          return total + (Number.isFinite(amount) && amount >= 0 ? amount : 0);
        }, 0);
      return {
        ...parsed,
        activePolicy: {
          ...parsed.activePolicy,
          status: parsed.activePolicy.status ?? "active",
          spentKrw: parsed.activePolicy.spentKrw ?? migratedSpend,
          reservedKrw: parsed.activePolicy.reservedKrw ?? parsed.pendingApprovals.reduce((total, item) => total + item.decision.totalAmount, 0)
        },
        aiUsage: parsed.aiUsage ?? []
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { activePolicy: createDefaultPolicy(), auditEvents: [], pendingApprovals: [], aiUsage: [] };
      }
      throw error;
    }
  }

  private persist() {
    mkdirSync(dirname(this.stateFilePath), { recursive: true });
    const temporaryPath = `${this.stateFilePath}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(this.state, null, 2));
    renameSync(temporaryPath, this.stateFilePath);
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
      updatedAt: new Date().toISOString(),
      status: "active",
      spentKrw: 0,
      reservedKrw: 0
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

  getAiUsage() {
    return this.state.aiUsage;
  }

  recordAiUsage(usage: Omit<AiUsageRecord, "id" | "occurredAt">) {
    const record: AiUsageRecord = {
      ...usage,
      id: this.createId("ai-usage"),
      occurredAt: new Date().toISOString()
    };
    this.state.aiUsage.unshift(record);
    this.persist();
    return record;
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

  recordAudit(requestId: string, type: AuditEvent["type"], details: Record<string, unknown>, transactionHash?: string) {
    const previousHash = this.state.auditEvents[0]?.hash ?? "GENESIS";
    const hashableEvent: Omit<AuditEvent, "hash"> = {
      id: this.createId("audit"),
      requestId,
      type,
      occurredAt: new Date().toISOString(),
      details,
      previousHash,
      ...(transactionHash ? { transactionHash } : {})
    };
    const event: AuditEvent = { ...hashableEvent, hash: hashEvent(hashableEvent) };
    this.state.auditEvents.unshift(event);
    this.persist();
    return event;
  }

  getPendingApprovals() {
    return this.state.pendingApprovals;
  }

  commitAllowed(evaluation: PurchaseEvaluation) {
    this.state.activePolicy.spentKrw += evaluation.decision.totalAmount;
    this.persist();
  }

  addPendingApproval(evaluation: PurchaseEvaluation) {
    this.state.pendingApprovals.push(evaluation);
    this.state.activePolicy.reservedKrw += evaluation.decision.totalAmount;
    this.persist();
  }

  takePendingApproval(requestId: string, action: "approve" | "reject") {
    const index = this.state.pendingApprovals.findIndex((item) => item.request.id === requestId);
    if (index < 0) return undefined;
    const [pending] = this.state.pendingApprovals.splice(index, 1);
    if (!pending) return undefined;
    this.state.activePolicy.reservedKrw -= pending.decision.totalAmount;
    if (action === "approve") this.state.activePolicy.spentKrw += pending.decision.totalAmount;
    this.persist();
    return pending;
  }

  stopDelegation() {
    if (this.state.activePolicy.status === "stopped") return this.state.activePolicy;
    for (const pending of this.state.pendingApprovals) {
      this.recordAudit(pending.request.id, "rejected", {
        product: pending.product.name,
        reason: "delegation_stopped",
        actor: "human_operator"
      });
    }
    this.state.pendingApprovals = [];
    this.state.activePolicy.reservedKrw = 0;
    this.state.activePolicy.status = "stopped";
    this.recordAudit(this.state.activePolicy.id, "delegation_stopped", {
      policyId: this.state.activePolicy.id,
      version: this.state.activePolicy.version,
      spentKrw: this.state.activePolicy.spentKrw,
      actor: "human_operator"
    });
    return this.state.activePolicy;
  }

}
