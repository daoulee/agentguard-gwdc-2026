import type { PolicyDecision, PurchaseRequest, SpendingPolicy } from "@agentguard/shared";

export type PolicyEvaluator = (
  policy: SpendingPolicy,
  request: PurchaseRequest
) => PolicyDecision;

export const POLICY_ENGINE_NOT_IMPLEMENTED = "Policy engine is reserved for the core build phase.";

