export type Currency = "KRW" | "USDT";

export type SpendingPolicy = {
  id: string;
  budget: number;
  currency: Currency;
  allowedMerchants: string[];
  allowedCategories: string[];
  deadline: string;
  requireHumanApproval: boolean;
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
  evaluatedAt: string;
};

export type AuditEvent = {
  id: string;
  requestId: string;
  type: "policy_created" | "request_received" | "allowed" | "blocked" | "approved" | "submitted";
  occurredAt: string;
  details: Record<string, unknown>;
  transactionHash?: string;
};

export type HealthResponse = {
  service: "agentguard-server";
  status: "ok";
  timestamp: string;
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

