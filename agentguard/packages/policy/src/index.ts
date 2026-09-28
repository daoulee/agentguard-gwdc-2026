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

// Keep the phrase around each amount; magnitude does not establish its role.
export function extractSpendingAmounts(prompt: string) {
  const pattern = /(\d+(?:\.\d+)?)\s*(만원|만|천원|천|원)(?:\s*(\d+)\s*천원?)?/g;
  const entries = [...prompt.matchAll(pattern)].map((match) => {
    const unit = match[2]!;
    const multiplier = unit.startsWith("만") ? 10_000 : unit.startsWith("천") ? 1_000 : 1;
    return { amount: Math.round(Number(match[1]) * multiplier) + Number(match[3] ?? 0) * 1_000,
      start: match.index!, end: match.index! + match[0].length };
  });
  const budgets: number[] = [];
  const approvals: number[] = [];
  for (const [index, entry] of entries.entries()) {
    const before = prompt.slice(index ? entries[index - 1]!.end : 0, entry.start);
    const after = prompt.slice(entry.end, entries[index + 1]?.start ?? prompt.length);
    const prefix = before.split(/[,。.!?]|하고|그리고/).at(-1) ?? "";
    const suffix = after.split(/[,。.!?]|하고|그리고/)[0] ?? "";
    const approval = /(?:넘|초과|이상)[\s\S]*(?:승인|확인|허락)/.test(suffix)
      || /(?:자동\s*승인\s*(?:한도|기준)|승인\s*(?:기준|한도))[^\d]*$/.test(prefix)
      || /(?:이하|이내|까지)[\s\S]*자동\s*승인/.test(suffix);
    if (approval) approvals.push(entry.amount);
    else if (/(?:예산|최대|총액|한도)[^\d]*$/.test(prefix)
      || /^(?:\s*(?:이하|이내|안으로|안에서|내에서|내로|까지|미만))/.test(suffix)) budgets.push(entry.amount);
  }
  const unique = (values: number[]) => [...new Set(values.filter(value => value > 0))];
  return { budgets: unique(budgets), approvals: unique(approvals) };
}

const addDays = (date: Date, days: number) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  result.setHours(23, 59, 59, 999);
  return result;
};

const inferDeadline = (prompt: string, now: Date) => {
  const calendar = prompt.match(/(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*까지/);
  if (calendar) {
    const year = Number(calendar[1] ?? now.getFullYear());
    const month = Number(calendar[2]);
    const day = Number(calendar[3]);
    const date = new Date(year, month - 1, day, 23, 59, 59, 999);
    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) return date.toISOString();
    return null;
  }
  if (/내일/.test(prompt)) return addDays(now, 1).toISOString();
  const dayMatch = prompt.match(/(\d+)\s*일\s*(?:안|이내)/);
  if (dayMatch?.[1]) return addDays(now, Number(dayMatch[1])).toISOString();
  if (/오늘/.test(prompt)) return addDays(now, 0).toISOString();
  return null;
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
  const amounts = extractSpendingAmounts(normalized);
  const budget = amounts.budgets.length === 1 ? amounts.budgets[0]! : 100_000;
  const approvalCandidate = amounts.approvals.length === 1 ? amounts.approvals[0] : undefined;
  const approvalInstruction = normalized.replace(/승인된\s*판매자/g, "");
  const mentionsApproval = /승인|확인|허락/.test(approvalInstruction);
  const mentionsAutomatic = /자동/.test(normalized) && !mentionsApproval;
  const conflictingApproval = approvalCandidate !== undefined && approvalCandidate > budget;
  const autoApprovalLimit = conflictingApproval ? 0 : approvalCandidate ?? (mentionsAutomatic ? budget : 0);
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
  const parsedDeadline = inferDeadline(normalized, now);
  const hasDeadline = parsedDeadline !== null && new Date(parsedDeadline).getTime() > now.getTime();
  const hasApprovedMerchantIntent = /승인된 판매자|허용된 판매자|등록된 판매자/.test(normalized);

  if (amounts.budgets.length !== 1) {
    missingFields.push("budget");
    warnings.push("예산 조건이 없거나 서로 달라 임시 예산 100,000원을 표시했습니다. 최종 한도를 확인해주세요.");
    clarifyingQuestions.push("최대 구매 예산을 얼마로 설정할까요?");
  }
  if ((!mentionsApproval && !mentionsAutomatic) || amounts.approvals.length > 1 || conflictingApproval) {
    missingFields.push("autoApprovalLimit");
    warnings.push(conflictingApproval ? "승인 기준이 최대 예산보다 큽니다. 예산을 늘리지 않고 승인 기준의 확인을 요구합니다." : "자동 승인 기준을 추측하지 않고 모든 거래를 사용자 승인 대상으로 두었습니다.");
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
    warnings.push(parsedDeadline ? "입력한 구매 기한이 이미 지났습니다. 미래 기한을 지정해주세요." : "구매 기한이 없거나 유효하지 않아 오늘 23:59를 임시 표시했습니다.");
    clarifyingQuestions.push(parsedDeadline ? "입력한 기한이 지났습니다. 언제까지 구매하도록 할까요?" : "이 정책은 언제까지 유효해야 하나요?");
  }

  return {
    name: `${categoryName} 구매 위임`,
    sourceText: normalized,
    budget,
    autoApprovalLimit,
    currency: "KRW",
    allowedMerchants,
    allowedCategories,
    deadline: parsedDeadline ?? addDays(now, 0).toISOString(),
    requireHumanApproval: !mentionsAutomatic || mentionsApproval || autoApprovalLimit < budget,
    provider: options.provider ?? "safe_fallback",
    warnings,
    missingFields,
    clarifyingQuestions,
    fieldSources: {
      name: "safe_default",
      budget: amounts.budgets.length === 1 ? "user" : "needs_confirmation",
      autoApprovalLimit: missingFields.includes("autoApprovalLimit") ? "needs_confirmation" : "user",
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
  if (!Number.isSafeInteger(draft.budget) || draft.budget <= 0) errors.push("최대 예산은 0보다 커야 합니다.");
  if (!Number.isSafeInteger(draft.autoApprovalLimit) || draft.autoApprovalLimit < 0) {
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
