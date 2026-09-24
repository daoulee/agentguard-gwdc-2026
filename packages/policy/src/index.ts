import type {
  PolicyDecision,
  PolicyDraft,
  PolicyInterpretationProvider,
  PurchaseRequest,
  SpendingPolicy
} from "@agentguard/shared";

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

type FallbackOptions = {
  availableMerchants: string[];
  now?: Date;
  provider?: PolicyInterpretationProvider;
};

const moneyPattern = /(\d+(?:\.\d+)?)\s*(만원|만|천원|천|원)/g;

const toKrw = (value: string, unit: string) => {
  const amount = Number(value);
  if (unit === "만원" || unit === "만") return Math.round(amount * 10_000);
  if (unit === "천원" || unit === "천") return Math.round(amount * 1_000);
  return Math.round(amount);
};

const extractAmounts = (prompt: string) => {
  const compoundAmounts: number[] = [];
  const withoutCompounds = prompt.replace(/(\d+)\s*만\s*(\d+)\s*천원?/g, (_match, tenThousands: string, thousands: string) => {
    compoundAmounts.push(Number(tenThousands) * 10_000 + Number(thousands) * 1_000);
    return " ";
  });
  const simpleAmounts = [...withoutCompounds.matchAll(moneyPattern)]
    .map((match) => toKrw(match[1] ?? "0", match[2] ?? "원"));
  return [...compoundAmounts, ...simpleAmounts].filter((amount) => amount > 0);
};

const addDays = (date: Date, days: number) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  result.setHours(23, 59, 59, 999);
  return result;
};

const inferDeadline = (prompt: string, now: Date) => {
  if (/내일/.test(prompt)) return addDays(now, 1).toISOString();
  const dayMatch = prompt.match(/(\d+)\s*일\s*(?:안|이내)/);
  if (dayMatch?.[1]) return addDays(now, Number(dayMatch[1])).toISOString();
  return addDays(now, 0).toISOString();
};

const inferCategories = (prompt: string) => {
  const categories: string[] = [];
  if (/키보드|keyboard/i.test(prompt)) categories.push("keyboard");
  if (/소프트웨어|software|구독/i.test(prompt)) categories.push("software");
  if (/여행|항공|숙박|travel/i.test(prompt)) categories.push("travel");
  if (/사무용품|office/i.test(prompt)) categories.push("office");
  return categories.length > 0 ? categories : ["keyboard"];
};

export function createFallbackPolicyDraft(prompt: string, options: FallbackOptions): PolicyDraft {
  const normalized = prompt.trim();
  const now = options.now ?? new Date();
  const amounts = extractAmounts(normalized).sort((left, right) => right - left);
  const budget = amounts[0] ?? 100_000;
  const approvalCandidate = amounts.find((amount) => amount < budget);
  const mentionsApproval = /승인|확인|허락/.test(normalized);
  const autoApprovalLimit = mentionsApproval ? (approvalCandidate ?? Math.floor(budget * 0.9)) : budget;
  const explicitlyNamedMerchants = options.availableMerchants.filter((merchant) =>
    normalized.toLowerCase().includes(merchant.toLowerCase())
  );
  const allowedMerchants = explicitlyNamedMerchants.length > 0
    ? explicitlyNamedMerchants
    : options.availableMerchants;
  const allowedCategories = inferCategories(normalized);
  const categoryName = allowedCategories[0] === "keyboard" ? "키보드" : "AI 지출";
  const warnings: string[] = [];

  if (amounts.length === 0) warnings.push("금액을 찾지 못해 최대 예산을 100,000원으로 설정했습니다.");
  if (explicitlyNamedMerchants.length === 0) warnings.push("판매자 이름이 없어 등록된 판매자 전체를 허용했습니다.");
  if (!/오늘|내일|\d+\s*일\s*(?:안|이내)/.test(normalized)) {
    warnings.push("기한이 없어 오늘 23:59까지로 설정했습니다.");
  }

  return {
    name: `${categoryName} 구매 위임`,
    sourceText: normalized,
    budget,
    autoApprovalLimit,
    currency: "KRW",
    allowedMerchants,
    allowedCategories,
    deadline: inferDeadline(normalized, now),
    requireHumanApproval: mentionsApproval || autoApprovalLimit < budget,
    provider: options.provider ?? "safe_fallback",
    warnings
  };
}

export function validatePolicyDraft(draft: PolicyDraft): string[] {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push("정책 이름이 필요합니다.");
  if (!draft.sourceText.trim()) errors.push("정책 원문이 필요합니다.");
  if (!Number.isFinite(draft.budget) || draft.budget <= 0) errors.push("최대 예산은 0보다 커야 합니다.");
  if (!Number.isFinite(draft.autoApprovalLimit) || draft.autoApprovalLimit < 0) {
    errors.push("자동 승인 한도는 0 이상이어야 합니다.");
  }
  if (draft.autoApprovalLimit > draft.budget) errors.push("자동 승인 한도는 최대 예산보다 클 수 없습니다.");
  if (draft.allowedMerchants.length === 0) errors.push("허용 판매자를 한 곳 이상 선택해야 합니다.");
  if (draft.allowedCategories.length === 0) errors.push("허용 카테고리를 한 개 이상 선택해야 합니다.");
  if (!Number.isFinite(new Date(draft.deadline).getTime())) errors.push("유효한 정책 기한이 필요합니다.");
  if (draft.currency !== "KRW") errors.push("현재 데모에서는 KRW 정책만 지원합니다.");
  if (draft.provider !== "kiln" && draft.provider !== "safe_fallback") errors.push("알 수 없는 정책 해석 방식입니다.");
  return errors;
}
