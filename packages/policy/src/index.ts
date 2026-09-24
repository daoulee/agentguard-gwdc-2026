import type { PolicyDecision, PurchaseRequest, SpendingPolicy } from "@agentguard/shared";

export type PolicyEvaluator = (
  policy: SpendingPolicy,
  request: PurchaseRequest
) => PolicyDecision;

export const evaluatePurchase: PolicyEvaluator = (policy, request) => {
  const reasons: PolicyDecision["reasons"] = [];
  const totalAmount = request.amount + request.fee;

  if (new Date(request.requestedAt).getTime() > new Date(policy.deadline).getTime()) {
    reasons.push("deadline_expired");
  }
  if (totalAmount > policy.budget) reasons.push("budget_exceeded");
  if (!policy.allowedMerchants.includes(request.merchant)) reasons.push("merchant_not_allowed");
  if (!policy.allowedCategories.includes(request.category)) reasons.push("category_not_allowed");

  if (reasons.length > 0) {
    return { status: "block", reasons, totalAmount, evaluatedAt: new Date().toISOString() };
  }

  if (policy.requireHumanApproval && totalAmount > policy.autoApprovalLimit) {
    return {
      status: "needs_approval",
      reasons: ["human_approval_required"],
      totalAmount,
      evaluatedAt: new Date().toISOString()
    };
  }

  return {
    status: "allow",
    reasons: ["allowed"],
    totalAmount,
    evaluatedAt: new Date().toISOString()
  };
};
