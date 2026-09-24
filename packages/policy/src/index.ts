import type {
  PolicyDecision,
  PolicyDraft,
  PolicyInterpretationProvider,
  Product,
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

  if (policy.status === "stopped") reasons.push("delegation_stopped");

  if (new Date(request.requestedAt).getTime() > new Date(policy.deadline).getTime()) {
    reasons.push("deadline_expired");
  }
  if (policy.spentKrw + policy.reservedKrw + totalAmount > policy.budget) reasons.push("budget_exceeded");
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
  availableProducts: Product[];
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
  if (/게이밍\s*모니터|gaming\s*monitor/i.test(prompt)) categories.push("gaming_monitor");
  else if (/모니터|monitor|display/i.test(prompt)) categories.push("monitor");
  if (/키보드|keyboard/i.test(prompt)) categories.push("keyboard");
  if (/소프트웨어|software|구독/i.test(prompt)) categories.push("software");
  if (/여행|항공|숙박|travel/i.test(prompt)) categories.push("travel");
  if (/사무용품|office/i.test(prompt)) categories.push("office");
  return categories.length > 0 ? categories : ["general"];
};

const categoryNames: Record<string, string> = {
  keyboard: "키보드",
  gaming_monitor: "게이밍 모니터",
  monitor: "모니터",
  software: "소프트웨어",
  travel: "여행",
  office: "사무용품",
  general: "일반 구매"
};

export function createFallbackPolicyDraft(prompt: string, options: FallbackOptions): PolicyDraft {
  const normalized = prompt.trim();
  const now = options.now ?? new Date();
  const amounts = extractAmounts(normalized).sort((left, right) => right - left);
  const budget = amounts[0] ?? 100_000;
  const approvalCandidate = amounts.find((amount) => amount < budget);
  const approvalInstruction = normalized.replace(/승인된\s*판매자/g, "");
  const mentionsApproval = /승인|확인|허락/.test(approvalInstruction);
  const mentionsAutomatic = /자동(?:으로|\s*구매|\s*승인)?/.test(normalized);
  const autoApprovalLimit = approvalCandidate ?? (mentionsAutomatic ? budget : 0);
  const allMerchants = [...new Set(options.availableProducts.map((product) => product.merchant))];
  const explicitlyNamedMerchants = allMerchants.filter((merchant) =>
    normalized.toLowerCase().includes(merchant.toLowerCase())
  );
  const allowedCategories = inferCategories(normalized);
  const categoryMerchants = [...new Set(options.availableProducts
    .filter((product) => allowedCategories.includes(product.category))
    .map((product) => product.merchant))];
  const allowedMerchants = explicitlyNamedMerchants.length > 0
    ? explicitlyNamedMerchants
    : categoryMerchants;
  const categoryName = categoryNames[allowedCategories[0] ?? "general"] ?? "AI 지출";
  const warnings: string[] = [];
  const missingFields: PolicyDraft["missingFields"] = [];
  const clarifyingQuestions: string[] = [];
  const hasDeadline = /오늘|내일|\d+\s*일\s*(?:안|이내)/.test(normalized);
  const hasApprovedMerchantIntent = /승인된 판매자|허용된 판매자|등록된 판매자/.test(normalized);

  if (amounts.length === 0) {
    missingFields.push("budget");
    warnings.push("금액을 찾지 못해 임시 예산 100,000원을 표시했습니다.");
    clarifyingQuestions.push("최대 구매 예산을 얼마로 설정할까요?");
  }
  if (!mentionsApproval && !mentionsAutomatic) {
    missingFields.push("autoApprovalLimit");
    warnings.push("자동 승인 기준을 추측하지 않고 모든 거래를 사용자 승인 대상으로 두었습니다.");
    clarifyingQuestions.push("얼마까지 자동 승인하고, 그 이상은 직접 확인할까요?");
  }
  if (allowedCategories.includes("general")) {
    missingFields.push("allowedCategories");
    clarifyingQuestions.push("구매하려는 상품 종류를 알려주세요.");
  }
  if (explicitlyNamedMerchants.length === 0 && !hasApprovedMerchantIntent) {
    missingFields.push("allowedMerchants");
    warnings.push("판매자 조건이 없어 카탈로그의 등록 판매자를 임시 표시했습니다.");
    clarifyingQuestions.push("등록된 판매자 전체를 허용할까요?");
  }
  if (!hasDeadline) {
    missingFields.push("deadline");
    warnings.push("구매 기한을 추측하지 않고 오늘 23:59를 임시 표시했습니다.");
    clarifyingQuestions.push("이 정책은 언제까지 유효해야 하나요?");
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
    requireHumanApproval: !mentionsAutomatic || mentionsApproval || autoApprovalLimit < budget,
    provider: options.provider ?? "safe_fallback",
    warnings,
    missingFields,
    clarifyingQuestions,
    fieldSources: {
      name: "safe_default",
      budget: amounts.length > 0 ? "user" : "needs_confirmation",
      autoApprovalLimit: mentionsApproval || mentionsAutomatic ? "user" : "needs_confirmation",
      allowedMerchants: explicitlyNamedMerchants.length > 0 ? "user" : hasApprovedMerchantIntent ? "catalog" : "needs_confirmation",
      allowedCategories: allowedCategories.includes("general") ? "needs_confirmation" : "user",
      deadline: hasDeadline ? "user" : "needs_confirmation"
    }
  };
}

export function validatePolicyDraft(draft: PolicyDraft, options: { allowIncomplete?: boolean } = {}): string[] {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push("정책 이름이 필요합니다.");
  if (!draft.sourceText.trim()) errors.push("정책 원문이 필요합니다.");
  if (!Number.isFinite(draft.budget) || draft.budget <= 0) errors.push("최대 예산은 0보다 커야 합니다.");
  if (!Number.isFinite(draft.autoApprovalLimit) || draft.autoApprovalLimit < 0) {
    errors.push("자동 승인 한도는 0 이상이어야 합니다.");
  }
  if (draft.autoApprovalLimit > draft.budget) errors.push("자동 승인 한도는 최대 예산보다 클 수 없습니다.");
  if (!draft.requireHumanApproval && draft.autoApprovalLimit < draft.budget) {
    errors.push("사람의 승인을 사용하지 않으면 자동 승인 한도는 최대 예산과 같아야 합니다.");
  }
  if (draft.allowedMerchants.length === 0) errors.push("허용 판매자를 한 곳 이상 선택해야 합니다.");
  if (draft.allowedCategories.length === 0) errors.push("허용 카테고리를 한 개 이상 선택해야 합니다.");
  if (!Number.isFinite(new Date(draft.deadline).getTime())) errors.push("유효한 정책 기한이 필요합니다.");
  if (draft.currency !== "KRW") errors.push("현재 데모에서는 KRW 정책만 지원합니다.");
  if (draft.provider !== "kiln" && draft.provider !== "safe_fallback") errors.push("알 수 없는 정책 해석 방식입니다.");
  if (!options.allowIncomplete && draft.missingFields.length > 0) errors.push("확인이 필요한 정책 항목을 모두 입력해주세요.");
  return errors;
}
