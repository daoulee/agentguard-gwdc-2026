export type Currency = "KRW" | "USDT";
export type PolicyInterpretationProvider = "kiln" | "safe_fallback";
export type PolicyMissingField = "budget" | "autoApprovalLimit" | "allowedMerchants" | "allowedCategories" | "deadline";
export type PolicyFieldSource = "user" | "catalog" | "ai" | "safe_default" | "needs_confirmation";
export type PolicyFieldKey = "name" | PolicyMissingField;

export type PolicyDraft = {
  name: string;
  sourceText: string;
  budget: number;
  autoApprovalLimit: number;
  currency: Currency;
  allowedMerchants: string[];
  allowedCategories: string[];
  deadline: string;
  requireHumanApproval: boolean;
  provider: PolicyInterpretationProvider;
  warnings: string[];
  missingFields: PolicyMissingField[];
  clarifyingQuestions: string[];
  fieldSources: Partial<Record<PolicyFieldKey, PolicyFieldSource>>;
};

export type SpendingPolicy = {
  id: string;
  name: string;
  budget: number;
  autoApprovalLimit: number;
  currency: Currency;
  allowedMerchants: string[];
  allowedCategories: string[];
  deadline: string;
  requireHumanApproval: boolean;
  sourceText: string;
  interpretationProvider: PolicyInterpretationProvider;
  version: number;
  updatedAt: string;
  status: "active" | "stopped";
  spentKrw: number;
  reservedKrw: number;
};

export type Product = {
  id: string;
  name: string;
  merchant: string;
  category: string;
  priceKrw: number;
  scenario: "safe" | "approval" | "blocked";
};

export type MerchantProfile = {
  name: string;
  trusted: boolean;
  categories: string[];
};

export type PurchaseRequest = {
  id: string;
  policyId: string;
  productId: string;
  amount: number;
  fee: number;
  merchant: string;
  category: string;
  requestedAt: string;
  source?: "simulator" | "agent";
  agentId?: string;
  clientRequestId?: string;
};

export type DecisionReason =
  | "allowed"
  | "budget_exceeded"
  | "merchant_not_allowed"
  | "category_not_allowed"
  | "deadline_expired"
  | "human_approval_required"
  | "delegation_stopped";

export type PolicyDecision = {
  status: "allow" | "block" | "needs_approval";
  reasons: DecisionReason[];
  totalAmount: number;
  evaluatedAt: string;
};

export type AuditEvent = {
  id: string;
  requestId: string;
  type:
    | "policy_interpreted"
    | "policy_reviewed"
    | "policy_created"
    | "request_received"
    | "allowed"
    | "blocked"
    | "approval_requested"
    | "approved"
    | "rejected"
    | "submitted"
    | "delegation_stopped";
  occurredAt: string;
  details: Record<string, unknown>;
  previousHash: string;
  hash: string;
  transactionHash?: string;
};

export type PurchaseEvaluation = {
  product: Product;
  request: PurchaseRequest;
  decision: PolicyDecision;
  processingMs?: number;
};

export type HealthResponse = {
  service: "agentguard-server";
  status: "ok";
  timestamp: string;
};

export type AiStatusResponse = {
  provider: string;
  configured: boolean;
  model: string;
};

export type AiUsageRecord = {
  id: string;
  flow: "policy_interpretation";
  provider: PolicyInterpretationProvider;
  model: string;
  status: "success" | "failed" | "not_configured";
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  occurredAt: string;
  processingMs?: number;
};

export const mockProducts: Product[] = [
  {
    id: "keyboard-safe",
    name: "Quiet Mechanical Keyboard",
    merchant: "KeyboardLab",
    category: "keyboard",
    priceKrw: 82000,
    scenario: "safe"
  },
  {
    id: "keyboard-over-budget",
    name: "Creator Pro Keyboard",
    merchant: "TechStore",
    category: "keyboard",
    priceKrw: 98000,
    scenario: "approval"
  },
  {
    id: "keyboard-unknown-merchant",
    name: "Unknown Deal Keyboard",
    merchant: "UnlistedMarket",
    category: "keyboard",
    priceKrw: 65000,
    scenario: "blocked"
  },
  {
    id: "monitor-safe",
    name: "VisionPlay 27 Gaming Monitor",
    merchant: "DisplayHub",
    category: "gaming_monitor",
    priceKrw: 249000,
    scenario: "safe"
  },
  {
    id: "monitor-approval",
    name: "Arena QHD Gaming Monitor",
    merchant: "TechStore",
    category: "gaming_monitor",
    priceKrw: 299000,
    scenario: "approval"
  },
  {
    id: "monitor-unknown-merchant",
    name: "Ultra Deal Gaming Monitor",
    merchant: "UnlistedMarket",
    category: "gaming_monitor",
    priceKrw: 219000,
    scenario: "blocked"
  }
];

export const merchantDirectory: MerchantProfile[] = [
  { name: "KeyboardLab", trusted: true, categories: ["keyboard"] },
  { name: "DisplayHub", trusted: true, categories: ["gaming_monitor"] },
  { name: "TechStore", trusted: true, categories: ["keyboard", "gaming_monitor"] },
  { name: "UnlistedMarket", trusted: false, categories: ["keyboard", "gaming_monitor"] }
];

export const categoryLabels: Record<string, string> = {
  keyboard: "키보드",
  gaming_monitor: "게이밍 모니터",
  monitor: "모니터",
  software: "소프트웨어",
  travel: "여행",
  office: "사무용품",
  general: "일반 구매"
};
