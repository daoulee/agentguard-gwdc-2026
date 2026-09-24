export type Currency = "KRW" | "USDT";
export type PolicyInterpretationProvider = "kiln" | "safe_fallback";

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
};

export type Product = {
  id: string;
  name: string;
  merchant: string;
  category: string;
  priceKrw: number;
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
};

export type DecisionReason =
  | "allowed"
  | "budget_exceeded"
  | "merchant_not_allowed"
  | "category_not_allowed"
  | "deadline_expired"
  | "human_approval_required";

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
    | "policy_created"
    | "request_received"
    | "allowed"
    | "blocked"
    | "approval_requested"
    | "approved"
    | "rejected"
    | "submitted";
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
};

export type HealthResponse = {
  service: "agentguard-server";
  status: "ok";
  timestamp: string;
};

export type AiStatusResponse = {
  provider: "Kiln · Qwen3-32B" | "Safe fallback parser";
  configured: boolean;
  model: string;
};

export const mockProducts: Product[] = [
  {
    id: "keyboard-safe",
    name: "Quiet Mechanical Keyboard",
    merchant: "KeyboardLab",
    category: "keyboard",
    priceKrw: 82000
  },
  {
    id: "keyboard-over-budget",
    name: "Creator Pro Keyboard",
    merchant: "TechStore",
    category: "keyboard",
    priceKrw: 98000
  },
  {
    id: "keyboard-unknown-merchant",
    name: "Unknown Deal Keyboard",
    merchant: "UnlistedMarket",
    category: "keyboard",
    priceKrw: 65000
  }
];
