import { MoneyInput } from "./components/MoneyInput";
import { AuditTrail } from "./components/AuditTrail";
import { OperatorAccess } from "./components/OperatorAccess";
import {
  categoryLabels,
  merchantDirectory,
  mockProducts,
  type AiStatusResponse,
  type AiUsageRecord,
  type AuditEvent,
  type DecisionReason,
  type PolicyDraft,
  type PolicyFieldKey,
  type PolicyMissingField,
  type PurchaseEvaluation,
  type SpendingPolicy
} from "@agentguard/shared";
import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

const navigationItems = [
  { id: "overview", label: "개요" },
  { id: "policy", label: "정책 만들기" },
  { id: "simulator", label: "시뮬레이터" },
  { id: "approvals", label: "승인함" },
  { id: "audit", label: "감사 로그" }
] as const;

const policyTemplates = [
  "승인된 판매자에서 게이밍 모니터를 30만원 이내로 구매해.",
  "승인된 판매자에서 10만원 이하 키보드를 구매하고, 9만원이 넘으면 내 승인을 받아. 오늘까지.",
  "KeyboardLab에서 오늘 안에 8만 5천원 이하 키보드만 자동 구매해.",
  "TechStore에서 내일까지 12만원 이하 키보드를 구매하고, 7만원이 넘으면 확인을 받아."
];

type SectionId = (typeof navigationItems)[number]["id"];
type ChainStatus = { configured: boolean; chainId: number; network: string };
type AnchorRecord = { transactionHash: string; anchoredHash: string; chainId: number; blockNumber: number };
type PendingAnchor = { transactionHash: string; auditHash: string };
type WalletProvider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

const decisionCopy = {
  allow: { label: "자동 승인", caption: "정책 범위 안에서 안전하게 실행할 수 있습니다." },
  needs_approval: { label: "사용자 승인 필요", caption: "자동 승인 한도를 넘어 사람의 확인을 기다립니다." },
  block: { label: "즉시 차단", caption: "허용된 정책 범위를 벗어나 요청을 차단했습니다." }
} as const;

const reasonLabels: Record<DecisionReason, string> = {
  allowed: "모든 정책 조건 충족",
  budget_exceeded: "총액이 예산 한도 초과",
  merchant_not_allowed: "허용되지 않은 판매자",
  category_not_allowed: "허용되지 않은 카테고리",
  deadline_expired: "정책 유효 기한 만료",
  human_approval_required: "자동 승인 한도 초과",
  delegation_stopped: "사용자가 지출 위임을 중지함"
};

const eventLabels: Record<AuditEvent["type"], string> = {
  policy_interpreted: "정책 초안 생성",
  policy_reviewed: "사용자 검토·수정",
  policy_created: "정책 적용",
  request_received: "구매 요청 수신",
  allowed: "자동 승인",
  blocked: "정책 차단",
  approval_requested: "승인 요청",
  approved: "사용자 승인",
  rejected: "사용자 거절",
  submitted: "감사 해시 온체인 기록",
  delegation_stopped: "지출 위임 중지"
};

const sourceLabels = {
  user: "사용자 입력",
  catalog: "카탈로그 대조",
  ai: "AI 해석",
  safe_default: "안전 기본값",
  needs_confirmation: "확인 필요"
} as const;

const missingFieldLabels: Record<PolicyMissingField, string> = {
  budget: "최대 예산",
  autoApprovalLimit: "자동 승인 한도",
  allowedMerchants: "허용 판매자",
  allowedCategories: "허용 카테고리",
  deadline: "유효 기한"
};

function ShieldMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 36">
      <path d="M16 2 29 7v9c0 8.5-5.2 14.8-13 18C8.2 30.8 3 24.5 3 16V7l13-5Z" />
      <path d="m10.5 17 3.4 3.4 7.9-8" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M4 10h11M11 6l4 4-4 4" />
    </svg>
  );
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, credentials: "same-origin" });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(error?.message ?? "요청을 처리하지 못했습니다.");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const formatKrw = (amount: number) => `${amount.toLocaleString("ko-KR")}원`;
const formatTime = (iso: string) => new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
}).format(new Date(iso));
const formatDeadline = (iso: string) => new Intl.DateTimeFormat("ko-KR", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
}).format(new Date(iso));
const toLocalDateTimeValue = (iso: string) => {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

type EnergySummary = {
  aiInferenceCalls: number;
  deterministicDecisions: number;
  measuredTotalTokens: number | null;
  aiCallsAvoided: number;
  tokensAvoidedEstimate: number;
  energySavedWhEstimate: number;
  reductionRatio: number;
  assumptions: { tokensPerAiDecision: number; whPer1kTokens: number; note: string };
};

export function App() {
  const [accessEpoch, setAccessEpoch] = useState(0);
  const [interpretationId, setInterpretationId] = useState<string | null>(null);
  const evaluationAttempt = useRef<{ fingerprint: string; id: string } | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>("overview");
  const [policy, setPolicy] = useState<SpendingPolicy | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatusResponse | null>(null);
  const [policyPrompt, setPolicyPrompt] = useState(policyTemplates[0] ?? "");
  const [policyDraft, setPolicyDraft] = useState<PolicyDraft | null>(null);
  const [policyNotice, setPolicyNotice] = useState("");
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [isApplyingPolicy, setIsApplyingPolicy] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState(mockProducts[0]?.id ?? "");
  const [fee, setFee] = useState(0);
  const [evaluation, setEvaluation] = useState<PurchaseEvaluation | null>(null);
  const [approvals, setApprovals] = useState<PurchaseEvaluation[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [chainStatus, setChainStatus] = useState<ChainStatus | null>(null);
  const [pendingAnchor, setPendingAnchor] = useState<PendingAnchor | null>(() => {
    try {
      return JSON.parse(window.localStorage.getItem("agentguard-pending-anchor") ?? "null") as PendingAnchor | null;
    } catch {
      return null;
    }
  });
  const [isAnchoring, setIsAnchoring] = useState(false);
  const [isVerifyingAnchor, setIsVerifyingAnchor] = useState(false);
  const [selectedReceiptId, setSelectedReceiptId] = useState("");
  const [receipt, setReceipt] = useState<{ requestId: string; events: AuditEvent[]; anchors: AnchorRecord[]; integrityValid: boolean } | null>(null);
  const [aiUsage, setAiUsage] = useState<AiUsageRecord[]>([]);
  const [energy, setEnergy] = useState<EnergySummary | null>(null);
  const [integrityValid, setIntegrityValid] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [actionToast, setActionToast] = useState<{ message: string; tone: "success" | "neutral" | "danger" } | null>(null);
  const [resolvingApproval, setResolvingApproval] = useState<{ id: string; action: "approve" | "reject" } | null>(null);
  const navigationLockRef = useRef(false);
  const navigationTimerRef = useRef<number | undefined>(undefined);
  const flowTimerRef = useRef<number | undefined>(undefined);
  const toastTimerRef = useRef<number | undefined>(undefined);
  const interpretationRequestRef = useRef<AbortController | null>(null);

  const showToast = useCallback((message: string, tone: "success" | "neutral" | "danger" = "success") => {
    setActionToast({ message, tone });
    if (toastTimerRef.current !== undefined) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setActionToast(null), 2_600);
  }, []);

  const moveToSection = useCallback((id: SectionId, delay = 700) => {
    if (flowTimerRef.current !== undefined) window.clearTimeout(flowTimerRef.current);
    flowTimerRef.current = window.setTimeout(() => {
      setActiveSection(id);
      window.history.replaceState(null, "", `#${id}`);
      document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    }, delay);
  }, []);

  const refreshActivity = useCallback(async () => {
    const [approvalPayload, auditPayload, usagePayload, policyPayload, chainPayload, energyPayload] = await Promise.all([
      requestJson<{ approvals: PurchaseEvaluation[] }>("/api/approvals"),
      requestJson<{ events: AuditEvent[]; integrityValid: boolean }>("/api/audit"),
      requestJson<{ records: AiUsageRecord[] }>("/api/ai/usage"),
      requestJson<{ policy: SpendingPolicy }>("/api/policy"),
      requestJson<ChainStatus>("/api/chain/status"),
      requestJson<EnergySummary>("/api/energy")
    ]);
    setApprovals(approvalPayload.approvals);
    setAuditEvents(auditPayload.events);
    setIntegrityValid(auditPayload.integrityValid);
    setAiUsage(usagePayload.records);
    setEnergy(energyPayload);
    setPolicy(policyPayload.policy);
    setChainStatus(chainPayload);
  }, []);

  useEffect(() => {
    requestJson<{ authenticated: boolean }>("/api/session").then(session => {
      if (!session.authenticated) { setPolicy(null); setAuditEvents([]); setApprovals([]); setPolicyDraft(null); setReceipt(null); setAiUsage([]); setEnergy(null); setAiStatus(null); setChainStatus(null); return; }
      return Promise.all([
      requestJson<{ policy: SpendingPolicy }>("/api/policy"),
      requestJson<AiStatusResponse>("/api/ai/status"),
      refreshActivity()
    ]).then(([policyPayload, statusPayload]) => {
      setPolicy(policyPayload.policy);
      setAiStatus(statusPayload);
      setPolicyPrompt(policyPayload.policy.sourceText);
    });
    }).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "서버에 연결할 수 없습니다.");
    });
  }, [refreshActivity, accessEpoch]);

  const resetDemo = useCallback(async () => {
    if (!window.confirm("데모 상태를 초기화할까요? 누적 지출·감사 로그·승인·AI 사용량이 모두 지워집니다.")) return;
    try {
      await requestJson("/api/demo/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      await refreshActivity();
      showToast("데모 상태를 초기화했습니다.", "success");
    } catch {
      showToast("초기화에 실패했습니다.", "danger");
    }
  }, [refreshActivity, showToast]);

  useEffect(() => {
    const updateActiveSection = () => {
      if (navigationLockRef.current) return;
      const isAtPageBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (isAtPageBottom) {
        setActiveSection("audit");
        return;
      }
      const markerPosition = window.scrollY + 150;
      const currentSection = navigationItems.reduce<SectionId>((current, { id }) => {
        const section = document.getElementById(id);
        return section && section.offsetTop <= markerPosition ? id : current;
      }, "overview");
      setActiveSection(currentSection);
    };
    window.addEventListener("scroll", updateActiveSection, { passive: true });
    updateActiveSection();
    return () => {
      window.removeEventListener("scroll", updateActiveSection);
      if (navigationTimerRef.current !== undefined) window.clearTimeout(navigationTimerRef.current);
      if (flowTimerRef.current !== undefined) window.clearTimeout(flowTimerRef.current);
      if (toastTimerRef.current !== undefined) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const handleNavigation = (event: MouseEvent<HTMLAnchorElement>, id: SectionId) => {
    event.preventDefault();
    navigationLockRef.current = true;
    setActiveSection(id);
    window.history.replaceState(null, "", `#${id}`);
    document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    if (navigationTimerRef.current !== undefined) window.clearTimeout(navigationTimerRef.current);
    navigationTimerRef.current = window.setTimeout(() => {
      navigationLockRef.current = false;
      setActiveSection(id);
    }, 900);
  };

  const interpretPrompt = async () => {
    interpretationRequestRef.current?.abort();
    const controller = new AbortController();
    interpretationRequestRef.current = controller;
    setIsInterpreting(true);
    setErrorMessage("");
    setPolicyNotice("");
    try {
      const payload = await requestJson<{ draft: PolicyDraft; interpretationId: string }>("/api/policies/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: policyPrompt }),
        signal: controller.signal
      });
      if (interpretationRequestRef.current !== controller) return;
      setPolicyDraft(payload.draft);
      setInterpretationId(payload.interpretationId);
      await refreshActivity();
      showToast("정책 초안을 만들었습니다. 내용을 확인해주세요.", "neutral");
      if (window.innerWidth <= 960) {
        window.setTimeout(() => document.getElementById("policy-review")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" }), 250);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setErrorMessage(error instanceof Error ? error.message : "정책 해석에 실패했습니다.");
    } finally {
      if (interpretationRequestRef.current === controller) {
        interpretationRequestRef.current = null;
        setIsInterpreting(false);
      }
    }
  };

  const changePrompt = (value: string) => {
    interpretationRequestRef.current?.abort();
    interpretationRequestRef.current = null;
    setIsInterpreting(false);
    setPolicyPrompt(value);
    setPolicyDraft(null);
    setInterpretationId(null);
    setPolicyNotice("");
  };

  const resolveMissingField = (draft: PolicyDraft, field: PolicyMissingField) => {
    const questionIndex = draft.missingFields.indexOf(field);
    const warningKeyword: Partial<Record<PolicyMissingField, string>> = {
      budget: "예산 조건이",
      autoApprovalLimit: "자동 승인 기준을",
      allowedMerchants: "판매자 조건이",
      deadline: "기한"
    };
    return {
      missingFields: draft.missingFields.filter((item) => item !== field),
      clarifyingQuestions: questionIndex >= 0
        ? draft.clarifyingQuestions.filter((_, index) => index !== questionIndex)
        : draft.clarifyingQuestions,
      warnings: warningKeyword[field]
        ? draft.warnings.filter((warning) => !warning.includes(warningKeyword[field] ?? ""))
        : draft.warnings,
      fieldSources: { ...draft.fieldSources, [field]: "user" as const }
    };
  };

  const updateDraft = <Key extends keyof PolicyDraft>(key: Key, value: PolicyDraft[Key], resolves?: PolicyMissingField) => {
    setPolicyDraft((current) => current ? {
      ...current,
      [key]: value,
      ...(resolves && (resolves !== "deadline" || new Date(String(value)).getTime() > Date.now()) ? resolveMissingField(current, resolves) : {})
    } : current);
    setPolicyNotice("");
  };

  const fieldSource = (field: PolicyFieldKey) => {
    if (!policyDraft) return null;
    const source = policyDraft.fieldSources[field];
    const expired = field === "deadline" && new Date(policyDraft.deadline).getTime() <= Date.now();
    const label = expired ? "기한 지남" : source === "needs_confirmation"
      ? field === "allowedMerchants" ? "판매자 선택 필요" : "조건 확인 필요"
      : source === "user" || source === "ai" ? "인식 완료" : sourceLabels[source ?? "safe_default"];
    return source ? <em className={`field-source source-${source}${expired ? " source-expired" : ""}`}>{label}</em> : null;
  };

  const toggleMerchant = (merchant: string) => {
    if (!policyDraft) return;
    const selected = policyDraft.allowedMerchants.includes(merchant);
    updateDraft(
      "allowedMerchants",
      selected
        ? policyDraft.allowedMerchants.filter((item) => item !== merchant)
        : [...policyDraft.allowedMerchants, merchant],
      "allowedMerchants"
    );
  };

  const applyPolicy = async () => {
    if (!policyDraft || !interpretationId) return;
    setIsApplyingPolicy(true);
    setErrorMessage("");
    try {
      const payload = await requestJson<{ policy: SpendingPolicy }>("/api/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: policyDraft, interpretationId })
      });
      setPolicy(payload.policy);
      const firstMatchingProduct = mockProducts.find((product) => payload.policy.allowedCategories.includes(product.category));
      if (firstMatchingProduct) setSelectedProductId(firstMatchingProduct.id);
      setEvaluation(null);
      setPolicyNotice(`정책 v${payload.policy.version}이 현재 지출 방화벽에 적용됐습니다.`);
      await refreshActivity();
      showToast(`정책 v${payload.policy.version} 저장 완료 · 시뮬레이터로 이동합니다.`);
      moveToSection("simulator", 900);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "정책 적용에 실패했습니다.");
    } finally {
      setIsApplyingPolicy(false);
    }
  };

  const evaluateProduct = async (productId: string, requestFee: number) => {
    if (!policy) throw new Error("적용할 정책을 먼저 확인해주세요.");
    const fingerprint = JSON.stringify([productId, requestFee, policy.id]);
    if (evaluationAttempt.current?.fingerprint !== fingerprint) {
      evaluationAttempt.current = { fingerprint, id: crypto.randomUUID() };
    }
    const result = await requestJson<{ evaluation: PurchaseEvaluation }>("/api/evaluate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, fee: requestFee, policyId: policy.id, clientRequestId: evaluationAttempt.current.id })
    });
    evaluationAttempt.current = null;
    return result;
  };

  const runEvaluation = async () => {
    setIsRunning(true);
    setErrorMessage("");
    try {
      const payload = await evaluateProduct(selectedProductId, fee);
      setEvaluation(payload.evaluation);
      await refreshActivity();
      // Stay on the simulator so several requests can be checked in a row; the result shows inline.
      if (payload.evaluation.decision.status === "needs_approval") {
        showToast("사용자 확인이 필요한 거래입니다. 승인함에 추가했습니다.", "neutral");
      } else if (payload.evaluation.decision.status === "block") {
        showToast("정책 위반 거래를 차단하고 감사 로그에 기록했습니다.", "danger");
      } else {
        showToast("정책 범위 안에서 자동 승인하고 감사 로그에 기록했습니다.");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "정책 검사에 실패했습니다.");
    } finally {
      setIsRunning(false);
    }
  };

  const resolveApproval = async (requestId: string, action: "approve" | "reject") => {
    setErrorMessage("");
    setResolvingApproval({ id: requestId, action });
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 220));
      await requestJson(`/api/approvals/${requestId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      await refreshActivity();
      // Stay in the approval inbox so several pending requests can be handled in a row.
      showToast(action === "approve" ? "거래를 승인하고 감사 기록에 저장했습니다." : "거래를 거절하고 감사 기록에 저장했습니다.", action === "approve" ? "success" : "danger");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "승인 처리에 실패했습니다.");
    } finally {
      setResolvingApproval(null);
    }
  };

  const stopDelegation = async () => {
    try {
      const payload = await requestJson<{ policy: SpendingPolicy }>("/api/policy/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      setPolicy(payload.policy);
      await refreshActivity();
      showToast("지출 위임을 중지했습니다. 대기 중인 요청도 무효화했습니다.", "danger");
      moveToSection("audit", 700);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "위임 중지에 실패했습니다.");
    }
  };

  const loadReceipt = async (requestId: string) => {
    try {
      setReceipt(await requestJson<{ requestId: string; events: AuditEvent[]; anchors: AnchorRecord[]; integrityValid: boolean }>(`/api/receipts/${encodeURIComponent(requestId)}`));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "영수증을 불러오지 못했습니다.");
    }
  };

  const submitAuditAnchor = async () => {
    setIsAnchoring(true);
    setErrorMessage("");
    try {
      const wallet = (window as Window & { ethereum?: WalletProvider }).ethereum;
      if (!wallet) throw new Error("브라우저에 EVM 지갑이 필요합니다.");
      const payload = await requestJson<{ auditHash: string; chainId: number; data: string; to: string }>("/api/audit/anchor-payload");
      const currentChainId = await wallet.request({ method: "eth_chainId" });
      if (BigInt(String(currentChainId)) !== BigInt(payload.chainId)) {
        // Sepolia is built into MetaMask, so ask the wallet to switch before giving up.
        try {
          await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${payload.chainId.toString(16)}` }] });
        } catch {
          throw new Error("지갑 네트워크를 Ethereum Sepolia로 바꿔주세요.");
        }
        const switchedChainId = await wallet.request({ method: "eth_chainId" });
        if (BigInt(String(switchedChainId)) !== BigInt(payload.chainId)) {
          throw new Error("지갑 네트워크를 Ethereum Sepolia로 바꿔주세요.");
        }
      }
      const accounts = await wallet.request({ method: "eth_requestAccounts" }) as string[];
      const account = accounts[0];
      if (!account) throw new Error("지갑 계정을 선택해주세요.");
      const transactionHash = await wallet.request({
        method: "eth_sendTransaction",
        params: [{ from: account, to: payload.to, value: "0x0", data: payload.data }]
      });
      if (typeof transactionHash !== "string" || !/^0x[0-9a-f]{64}$/i.test(transactionHash)) {
        throw new Error("지갑이 거래 해시를 반환하지 않았습니다.");
      }
      const pending = { transactionHash, auditHash: payload.auditHash };
      setPendingAnchor(pending);
      window.localStorage.setItem("agentguard-pending-anchor", JSON.stringify(pending));
      showToast("테스트넷 거래를 제출했습니다. 확정 후 검증 버튼을 눌러주세요.", "neutral");
    } catch (error) {
      // Wallet errors are plain { code, message } objects, not Error instances.
      const walletMessage = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : "";
      setErrorMessage(walletMessage ? `테스트넷 거래를 제출하지 못했습니다: ${walletMessage}` : "테스트넷 거래를 제출하지 못했습니다.");
    } finally {
      setIsAnchoring(false);
    }
  };

  const verifyPendingAnchor = async () => {
    if (!pendingAnchor) return;
    setIsVerifyingAnchor(true);
    setErrorMessage("");
    try {
      await requestJson("/api/audit/anchors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pendingAnchor)
      });
      setPendingAnchor(null);
      window.localStorage.removeItem("agentguard-pending-anchor");
      setReceipt(null);
      await refreshActivity();
      showToast("테스트넷 거래와 감사 기록이 연결됐습니다.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "거래를 아직 검증하지 못했습니다.");
    } finally {
      setIsVerifyingAnchor(false);
    }
  };

  const clearPendingAnchor = () => {
    setPendingAnchor(null);
    window.localStorage.removeItem("agentguard-pending-anchor");
  };

  const policyProducts = useMemo(() => {
    const matches = policy
      ? mockProducts.filter((product) => policy.allowedCategories.includes(product.category))
      : [];
    return matches.length > 0 ? matches : mockProducts.slice(0, 3);
  }, [policy]);
  const selectedProduct = useMemo(
    () => policyProducts.find((product) => product.id === selectedProductId) ?? policyProducts[0],
    [policyProducts, selectedProductId]
  );
  const merchantOptions = useMemo(() => {
    const categories = policyDraft?.allowedCategories ?? [];
    const matches = merchantDirectory.filter((merchant) => (
      categories.length === 0 || categories.some((category) => merchant.categories.includes(category))
    ));
    return matches.length > 0 ? matches : merchantDirectory;
  }, [policyDraft?.allowedCategories]);
  const decision = evaluation ? decisionCopy[evaluation.decision.status] : null;
  const allowedCount = auditEvents.filter((event) => event.type === "allowed" || event.type === "approved").length;
  const blockedCount = auditEvents.filter((event) => event.type === "blocked" || event.type === "rejected").length;
  const receiptRequestIds = auditEvents.filter((event) => event.type === "request_received").map((event) => event.requestId);
  const receiptInput = receipt?.events.find((event) => event.type === "request_received");
  const receiptPolicy = receiptInput?.details.policySnapshot as SpendingPolicy | undefined;
  const budgetExhausted = Boolean(policy && policy.spentKrw + policy.reservedKrw >= policy.budget);

  const measuredDecisions = auditEvents.filter(event => ["allowed", "blocked", "approval_requested"].includes(event.type) && typeof event.details.processingMs === "number");
  const averageProcessingMs = measuredDecisions.length ? measuredDecisions.reduce((sum, event) => sum + Number(event.details.processingMs), 0) / measuredDecisions.length : null;

  return (
    <div className="app-shell">
      <nav className="topbar" aria-label="주요 메뉴">
        <a className="brand" href="#overview" aria-label="AgentGuard 홈"><span className="brand-mark"><ShieldMark /></span><span>AgentGuard</span></a>
        <div className="nav-links">
          {navigationItems.map(({ id, label }) => (
            <a aria-current={activeSection === id ? "page" : undefined} className={activeSection === id ? "is-active" : undefined} href={`#${id}`} key={id} onClick={(event) => handleNavigation(event, id)}>
              {label}{id === "approvals" && approvals.length > 0 && <b className="nav-count">{approvals.length}</b>}
            </a>
          ))}
        </div>
        <div className="network-status"><span className={policy ? "is-live" : ""} />{policy ? "정책 엔진 연결됨" : "연결 확인 필요"}</div>
      </nav>

      {errorMessage && <div className="error-banner" role="alert"><span>!</span>{errorMessage}<button onClick={() => setErrorMessage("")} type="button">닫기</button></div>}
      {actionToast && <div aria-live="polite" className={`action-toast toast-${actionToast.tone}`} role="status"><span>{actionToast.tone === "success" ? "✓" : actionToast.tone === "danger" ? "!" : "→"}</span>{actionToast.message}</div>}

      <OperatorAccess onChange={() => setAccessEpoch(epoch => epoch + 1)} />
      <main>
        <section className="hero" id="overview">
          <div className="hero-copy-block">
            <div className="challenge-badge"><span>GWDC 2026</span>FuriosaAI Challenge B</div>
            <h1><span className="hero-line">Human limits.</span><span className="hero-line">Agent freedom<span className="hero-period">.</span></span></h1>
            <p className="hero-copy">AI는 지출을 요청하고, 사람은 범위를 정합니다.<br />허용한 예산과 조건을 코드로 검사하고, 모든 결정을 기록합니다.</p>
            <div className="hero-actions">
              <a className="button button-primary" href="#policy">내 정책 만들기 <ArrowIcon /></a>
              <a className="button button-secondary" href="#simulator">거래 시뮬레이션</a>
            </div>
            <p className="hero-footnote">01 / Spending control · 사람의 정책, 코드의 판정</p>
          </div>

          <div className="policy-preview" aria-label="활성 지출 정책 미리보기">
            <div className="preview-header">
              <div><p className="micro-label">ACTIVE POLICY · V{policy?.version ?? 1}</p><h2>{policy?.name ?? "정책 불러오는 중"}</h2></div>
              <span className={policy?.status === "stopped" || budgetExhausted ? "live-badge is-stopped" : "live-badge"}><i /> {policy?.status === "stopped" ? "중지됨" : budgetExhausted ? "예산 소진" : "적용 중"}</span>
            </div>
            <div className="permission-balance">
              <span>에이전트에게 열어둔 예산</span>
              <strong>{policy ? Math.max(0, policy.budget - policy.spentKrw - policy.reservedKrw).toLocaleString("ko-KR") : "—"}<small>원</small></strong>
              <p>총 {policy ? formatKrw(policy.budget) : "—"} 중 · 사용 {policy ? formatKrw(policy.spentKrw) : "—"} · 대기 {policy ? formatKrw(policy.reservedKrw) : "—"}</p>
            </div>
            <div className="permission-range">
              <div className="permission-track" aria-hidden="true"><span style={{ width: `${policy ? Math.min(100, Math.max(0, policy.autoApprovalLimit / policy.budget * 100)) : 0}%` }} /></div>
              <div className="permission-legend"><span><i />자동 승인</span><span><i />사람 승인</span></div>
              <p>{policy?.autoApprovalLimit === 0 ? "모든 요청에 당신의 승인이 필요합니다." : <><b>{policy ? formatKrw(policy.autoApprovalLimit) : "—"}</b>까지 자유롭게.<br />그 이상은 당신에게 묻습니다.</>}</p>
              <span className="permission-boundary">예산과 허용 조건을 벗어나면 차단</span>
            </div>
            <div className="permission-tags" aria-label="정책 허용 범위">
              {policy?.allowedMerchants.map(merchant => <span key={merchant}>{merchant}</span>)}
              {policy?.allowedCategories.map(category => <span key={category}>{categoryLabels[category] ?? category}</span>)}
              <span>{policy ? `${formatDeadline(policy.deadline)}까지` : "기한 확인 중"}</span>
            </div>
            <details className="permission-original"><summary>내가 정한 조건 보기</summary><p>{policy?.sourceText ?? "정책을 불러오고 있습니다."}</p></details>
            <div className="policy-footer"><p>권한은 언제든 거둘 수 있습니다.</p>{policy?.status === "active" && <button className="stop-button" onClick={stopDelegation} type="button">지출 위임 중지</button>}</div>
          </div>
        </section>

        <section className="metrics" aria-label="AgentGuard 현재 지표">
          <article><span className="metric-dot metric-dot-green" /><div><strong>{allowedCount}</strong><p>승인된 요청</p></div></article>
          <article><span className="metric-dot metric-dot-blue" /><div><strong>{approvals.length}</strong><p>승인 대기</p></div></article>
          <article><span className="metric-dot metric-dot-violet" /><div><strong>{blockedCount}</strong><p>차단·거절</p></div></article>
          <article><span className="metric-dot metric-dot-mint" /><div><strong>{averageProcessingMs === null ? "—" : `${averageProcessingMs.toFixed(2)}`}<small> ms</small></strong><p>평균 요청 검사 · 실측</p></div></article>
        </section>

        <section className="section" id="policy">
          <div className="section-heading">
            <div><p className="micro-label">01 / YOUR POLICY</p><h2>말로 정하고, 눈으로 확인하세요</h2></div>
            <p>AI는 문장을 정책 초안으로 바꿀 뿐입니다. 사용자가 확인하고 적용하기 전에는 어떤 지출 권한도 바뀌지 않습니다.</p>
          </div>

          <div className="policy-builder">
            <div className="policy-input-pane">
              <div className="builder-step"><span>01</span><div><strong>지출 조건 작성</strong><p>금액, 판매자, 품목, 승인 기준과 기한을 포함하면 더 정확합니다.</p></div></div>
              <textarea aria-label="자연어 지출 정책" maxLength={1000} onChange={(event) => changePrompt(event.target.value)} value={policyPrompt} />
              <div className="prompt-footer"><span>{policyPrompt.length} / 1,000</span><span className={aiStatus?.configured ? "provider-chip is-ai" : "provider-chip"}>{aiStatus?.provider ?? "연결 확인 중"}</span></div>
              <div className="template-list">
                <p>예시로 시작하기</p>
                {policyTemplates.map((template, index) => <button key={template} onClick={() => changePrompt(template)} type="button">예시 {index + 1}</button>)}
              </div>
              <button className="button button-primary interpret-button" disabled={isInterpreting || policyPrompt.trim().length < 10} onClick={interpretPrompt} type="button">
                {isInterpreting ? <><span className="spinner" />정책 해석 중…</> : <>정책 초안 만들기 <ArrowIcon /></>}
              </button>
            </div>

            <div className="policy-review-pane" id="policy-review">
              <div className="builder-step"><span>02</span><div><strong>해석 결과 확인</strong><p>숫자와 허용 범위를 직접 고친 뒤 최종 적용하세요.</p></div></div>
              {!policyDraft ? (
                <div className="review-empty"><span className="empty-shield"><ShieldMark /></span><strong>아직 정책 초안이 없습니다</strong><p>왼쪽 문장을 해석하면 구조화된 규칙이 여기에 표시됩니다.</p></div>
              ) : (
                <div className="draft-form">
                  <div className="draft-heading">
                    <span className={`provider-chip ${policyDraft.provider === "kiln" ? "is-ai" : ""}`}>{policyDraft.provider === "kiln" ? `Kiln · ${aiStatus?.model ?? "모델 확인 필요"} 해석` : "안전 규칙 변환"}</span>
                    <span>적용 전 초안</span>
                  </div>
                  <p className="draft-source">해석한 문장: “{policyDraft.sourceText}”</p>
                  <div className="interpretation-summary" role="status">
                    <strong>문장을 해석했습니다</strong>
                    <p>{!policyDraft.missingFields.includes("budget") && `예산 ${formatKrw(policyDraft.budget)}`}{!policyDraft.missingFields.includes("autoApprovalLimit") && ` · 자동 승인 ${formatKrw(policyDraft.autoApprovalLimit)}`}{!policyDraft.missingFields.includes("allowedCategories") && ` · ${policyDraft.allowedCategories.map(category => categoryLabels[category] ?? category).join(", ")}`}</p>
                    <span>{policyDraft.missingFields.length ? "아래 항목을 보완하면 적용할 수 있습니다." : "조건을 검토한 뒤 적용해주세요."}</span>
                  </div>
                  {policyDraft.missingFields.length > 0 && (
                    <div className="clarification-card" role="status">
                      <div><span>!</span><strong>적용을 위해 {policyDraft.missingFields.length}개 항목을 보완해주세요</strong></div>
                      <ol>{policyDraft.missingFields.map((field, index) => <li key={field}><b>{missingFieldLabels[field]}</b>{field === "deadline" && new Date(policyDraft.deadline).getTime() <= Date.now() ? `날짜는 인식했지만 ${formatDeadline(policyDraft.deadline)}은 이미 지났습니다. 미래 기한으로 바꿔주세요.` : field === "allowedMerchants" ? "문장에 판매자 조건이 없습니다. 아래에서 선택하거나 현재 선택을 확인해주세요." : policyDraft.clarifyingQuestions[index]}</li>)}</ol>
                      <p>미래 기한 입력과 판매자 확인을 마치면 적용할 수 있습니다.</p>
                    </div>
                  )}
                  <label className="field full-field"><span>정책 이름 {fieldSource("name")}</span><input onChange={(event) => updateDraft("name", event.target.value)} value={policyDraft.name} /></label>
                  <div className="field-grid">
                    <label className={`field ${policyDraft.missingFields.includes("budget") ? "needs-confirmation" : ""}`}><span>최대 예산 {fieldSource("budget")}</span><div className="unit-input"><MoneyInput onChange={(value) => updateDraft("budget", value, "budget")} value={policyDraft.budget} /><b>원</b></div></label>
                    <label className={`field ${policyDraft.missingFields.includes("autoApprovalLimit") ? "needs-confirmation" : ""}`}><span>자동 승인 한도 {fieldSource("autoApprovalLimit")}</span><div className="unit-input"><MoneyInput onChange={(value) => updateDraft("autoApprovalLimit", value, "autoApprovalLimit")} value={policyDraft.autoApprovalLimit} /><b>원</b></div></label>
                  </div>
                  <fieldset className={`merchant-field ${policyDraft.missingFields.includes("allowedMerchants") ? "needs-confirmation" : ""}`}><legend>허용 판매자 {fieldSource("allowedMerchants")}</legend><div>{merchantOptions.map((merchant) => <label key={merchant.name} className={policyDraft.allowedMerchants.includes(merchant.name) ? "merchant-check is-checked" : "merchant-check"}><input checked={policyDraft.allowedMerchants.includes(merchant.name)} onChange={() => toggleMerchant(merchant.name)} type="checkbox" /><span>{merchant.name}{merchant.trusted ? " · 검증됨" : " · 미등록"}</span></label>)}</div></fieldset>
                  {policyDraft.missingFields.includes("allowedMerchants") && <button className="confirm-merchants" type="button" disabled={policyDraft.allowedMerchants.length === 0} onClick={() => updateDraft("allowedMerchants", policyDraft.allowedMerchants, "allowedMerchants")}>현재 선택한 판매자 허용</button>}
                  <div className="field-grid">
                    <label className={`field ${policyDraft.missingFields.includes("allowedCategories") ? "needs-confirmation" : ""}`}><span>허용 카테고리 {fieldSource("allowedCategories")}</span><input onChange={(event) => updateDraft("allowedCategories", event.target.value.split(",").map((value) => value.trim()).filter(Boolean), "allowedCategories")} value={policyDraft.allowedCategories.join(", ")} /></label>
                    <label className={`field ${policyDraft.missingFields.includes("deadline") ? "needs-confirmation" : ""}`}><span>유효 기한 {fieldSource("deadline")}</span><input onChange={(event) => updateDraft("deadline", event.target.value ? new Date(event.target.value).toISOString() : "", event.target.value ? "deadline" : undefined)} type="datetime-local" value={toLocalDateTimeValue(policyDraft.deadline)} /></label>
                  </div>
                  <div className="approval-rule"><strong>사용자 승인 조건</strong><p>{policyDraft.autoApprovalLimit === 0 ? "모든 요청을 직접 승인합니다." : `${formatKrw(policyDraft.autoApprovalLimit)}까지 자동 승인, 그 이상은 직접 승인합니다.`} 최대 예산·판매자·품목·기한을 벗어난 요청은 승인할 수 없습니다.</p></div>
                  {policyDraft.warnings.length > 0 && <div className="warning-list">{policyDraft.warnings.map((warning) => <p key={warning}><span>!</span>{warning}</p>)}</div>}
                  {policyNotice && <div className="success-notice">✓ {policyNotice}</div>}
                  <button className="button apply-policy-button" disabled={isApplyingPolicy || policyDraft.allowedMerchants.length === 0 || policyDraft.missingFields.length > 0} onClick={applyPolicy} type="button">{isApplyingPolicy ? "정책 적용 중…" : policyDraft.missingFields.length > 0 ? `확인 필요 항목 ${policyDraft.missingFields.length}개` : "검토한 정책 적용"}</button>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="section" id="simulator">
          <div className="section-heading simulator-heading">
            <div><p className="micro-label">02 / REQUEST CHECK</p><h2>요청은 자유롭게. 지출은 정책대로.</h2></div>
            <div className="heading-actions"><p>여기서는 구매 요청을 시뮬레이션합니다. 외부 에이전트의 요청도 같은 정책 엔진으로 검사합니다. 실제 결제는 실행하지 않습니다.</p></div>
          </div>

          <div className="simulator-layout">
            <div className="simulator-controls">
              <div className="control-heading"><span>01</span><div><strong>구매 대상 선택</strong><p>각 상품은 서로 다른 정책 결과를 보여줍니다.</p></div></div>
              <div className="product-options">
                {policyProducts.map((product) => (
                  <button className={selectedProductId === product.id ? "product-option is-selected" : "product-option"} key={product.id} onClick={() => { setSelectedProductId(product.id); setEvaluation(null); }} type="button">
                    <span className="option-radio" /><span><strong>{product.name}</strong><small>{product.merchant} · {categoryLabels[product.category] ?? product.category}</small></span><b>{formatKrw(product.priceKrw)}</b>
                  </button>
                ))}
              </div>
              <label className="fee-field"><span><strong>추가 수수료</strong><small>상품 가격과 합산해 예산을 검사합니다.</small></span><span className="fee-input"><input min="0" onChange={(event) => setFee(Math.max(0, Number(event.target.value)))} type="number" value={fee} />원</span></label>
              <button className="button button-primary run-button" disabled={isRunning || !selectedProduct} onClick={runEvaluation} type="button">{isRunning ? "정책 검사 중…" : "구매 요청 검사"}<ArrowIcon /></button>
            </div>

            <div className={`decision-panel ${evaluation ? `decision-${evaluation.decision.status}` : ""}`}>
              {!evaluation ? (
                <div className="decision-empty"><span className="empty-shield"><ShieldMark /></span><p className="micro-label">WAITING FOR REQUEST</p><h3>아직 검사한 거래가 없습니다</h3><p>왼쪽에서 상품을 선택하고 구매 요청을 실행하세요.</p></div>
              ) : (
                <div className="decision-content">
                  <p className="decision-measure">요청 검사 {evaluation.processingMs?.toFixed(2) ?? "미측정"} ms · 실제 결제 없음</p>
                  <div className="decision-status"><span>{evaluation.decision.status === "allow" ? "✓" : evaluation.decision.status === "block" ? "×" : "!"}</span><p>POLICY DECISION · V{policy?.version}</p></div>
                  <h3>{decision?.label}</h3><p className="decision-caption">{decision?.caption}</p>
                  <div className="decision-total"><span>검사 총액</span><strong>{formatKrw(evaluation.decision.totalAmount)}</strong></div>
                  <ul className="reason-list">{evaluation.decision.reasons.map((reason) => <li key={reason}><span />{reasonLabels[reason]}</li>)}</ul>
                  <div className="check-flow"><span className="is-done">요청 수신</span><i /><span className="is-done">정책 검사</span><i /><span className="is-done">해시 기록</span></div>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="section approval-section" id="approvals">
          <div className="section-heading compact-heading"><div><p className="micro-label">03 / HUMAN APPROVAL</p><h2>승인 대기함</h2></div><span className="dataset-count">{approvals.length} pending</span></div>
          {approvals.length === 0 ? <div className="empty-state"><span>✓</span><div><strong>대기 중인 요청이 없습니다</strong><p>자동 승인 한도를 초과하고 최대 예산 이하인 거래가 여기에 표시됩니다.</p></div></div> : <div className="approval-list">{approvals.map((item) => { const transition = resolvingApproval?.id === item.request.id ? `is-resolving is-${resolvingApproval.action}` : ""; return <article className={`approval-card ${transition}`} key={item.request.id}><div><p className="approval-kicker">APPROVAL REQUIRED</p><h3>{item.product.name}</h3><p>{item.product.merchant} · 요청 {formatTime(item.request.requestedAt)}</p></div><strong className="approval-price">{formatKrw(item.decision.totalAmount)}</strong><div className="approval-actions"><button className="button reject-button" disabled={resolvingApproval !== null} onClick={() => resolveApproval(item.request.id, "reject")} type="button">{resolvingApproval?.id === item.request.id && resolvingApproval.action === "reject" ? "거절 중…" : "거절"}</button><button className="button approve-button" disabled={resolvingApproval !== null} onClick={() => resolveApproval(item.request.id, "approve")} type="button">{resolvingApproval?.id === item.request.id && resolvingApproval.action === "approve" ? "승인 중…" : "승인"}</button></div></article>; })}</div>}
        </section>

        <section className="section audit-section" id="audit">
          <div className="section-heading compact-heading"><div><p className="micro-label">TAMPER-EVIDENT AUDIT TRAIL</p><h2>감사 로그</h2></div><div className="audit-actions"><span className={integrityValid ? "integrity-badge" : "integrity-badge is-invalid"}>{integrityValid ? "✓ 해시 체인 정상" : "! 기록 검증 실패"}</span><button className="reset-demo-button" onClick={resetDemo} type="button" title="데모 시연 전 상태를 초기화합니다.">데모 초기화</button></div></div>
          {auditEvents.length === 0 ? <div className="empty-state"><span>⌁</span><div><strong>기록된 이벤트가 없습니다</strong><p>첫 구매 요청부터 모든 판단 근거가 해시로 연결되어 저장됩니다.</p></div></div> : <AuditTrail events={auditEvents} labels={eventLabels} />}
          {auditEvents.length > 0 && <div className="anchor-panel"><div><strong>감사 해시 테스트넷 기록</strong><p>최신 해시 #{auditEvents[0]?.hash.slice(0, 16)}… · {chainStatus?.network ?? "네트워크 확인 중"}</p><p>소각 주소(0x…dEaD)로 0 ETH 거래를 보내고 거래 데이터에 감사 해시를 기록합니다. 테스트넷 가스가 필요합니다.</p></div>{!chainStatus?.configured ? <span>Sepolia RPC 설정 필요</span> : pendingAnchor ? <div className="anchor-actions"><code title={pendingAnchor.transactionHash}>{pendingAnchor.transactionHash.slice(0, 14)}…</code><button disabled={isVerifyingAnchor} onClick={verifyPendingAnchor} type="button">{isVerifyingAnchor ? "검증 중…" : "확정 거래 검증"}</button><button className="anchor-clear" onClick={clearPendingAnchor} title="블록체인 거래는 취소되지 않습니다." type="button">대기 표시 지우기</button></div> : <button disabled={isAnchoring || !integrityValid} onClick={submitAuditAnchor} type="button">{isAnchoring ? "지갑 확인 중…" : "지갑으로 해시 기록"}</button>}</div>}
          {receiptRequestIds.length > 0 && <div className="receipt-panel"><div className="receipt-controls"><div><strong>구매 판단 영수증</strong><p>요청 당시 정책과 이후 판정을 한곳에서 확인합니다.</p></div><select aria-label="영수증 요청 선택" onChange={(event) => { setSelectedReceiptId(event.target.value); setReceipt(null); }} value={selectedReceiptId || receiptRequestIds[0]}>{receiptRequestIds.map((id) => <option key={id} value={id}>{id}</option>)}</select><button onClick={() => loadReceipt(selectedReceiptId || receiptRequestIds[0] || "")} type="button">영수증 보기</button></div>{receipt && <div className="receipt-body">{receiptPolicy ? <p>정책 v{receiptPolicy.version} · 예산 {formatKrw(receiptPolicy.budget)} · 허용 판매자 {receiptPolicy.allowedMerchants.join(", ")} · 카테고리 {receiptPolicy.allowedCategories.join(", ")} · 기한 {formatDeadline(receiptPolicy.deadline)}</p> : <p>이전 기록에는 정책 스냅샷이 없어 허용 범위를 완전히 재구성할 수 없습니다.</p>}<p>요청 총액 {formatKrw(Number(receiptInput?.details.totalAmount ?? 0))} · 기록 검증 {receipt.integrityValid ? "정상" : "실패"}</p><ol>{receipt.events.map((event) => <li key={event.id}>{eventLabels[event.type]} · {formatTime(event.occurredAt)} · #{event.hash.slice(0, 12)}</li>)}</ol><div className="receipt-anchors">{receipt.anchors.length === 0 ? <p>온체인 거래 해시: 아직 연결되지 않음</p> : receipt.anchors.map((anchor) => <p key={anchor.transactionHash}>Sepolia 블록 {anchor.blockNumber} · <a href={`https://sepolia.etherscan.io/tx/${anchor.transactionHash}`} rel="noreferrer" target="_blank">거래 #{anchor.transactionHash.slice(0, 16)}…</a> · 기록 해시 #{anchor.anchoredHash.slice(0, 12)}…</p>)}</div></div>}</div>}
          {energy && (
            <details className="energy-panel"><summary>추론 효율 · 가정에 따른 절감 추정</summary>
              <div className="energy-head">
                <strong>추론 효율 · 에너지 절감 추정</strong>
                <span className="energy-badge">코드 판정 {energy.deterministicDecisions}건 · AI 추론 {energy.aiInferenceCalls}건</span>
              </div>
              <div className="energy-grid">
                <div><b>{energy.aiCallsAvoided}</b><small>줄인 AI 추론 호출</small></div>
                <div><b>{energy.tokensAvoidedEstimate.toLocaleString()}</b><small>줄인 토큰(추정)</small></div>
                <div><b>{energy.energySavedWhEstimate} Wh</b><small>줄인 에너지(추정)</small></div>
                <div><b>{Math.round(energy.reductionRatio * 100)}%</b><small>추론 절감률</small></div>
              </div>
              <p className="energy-note">
                정책은 AI가 한 번 구조화하고, 이후 지출 판정은 결정론적 코드가 수행합니다. 판정마다 AI를 호출하는 방식 대비 절감치입니다.
                판정·호출 수는 감사 기록의 실측이며, 토큰·에너지는 공개 문헌 기반 가정({energy.assumptions.tokensPerAiDecision}토큰/판정, {energy.assumptions.whPer1kTokens}Wh/1k토큰)으로 계산한 추정치입니다. NPU 실측이 아닙니다.
                {energy.measuredTotalTokens != null && <> 실제 보고된 누적 토큰: {energy.measuredTotalTokens.toLocaleString()}.</>}
              </p>
            </details>
          )}
          <div className="usage-panel"><strong>AI 추론 사용량 · 정책 해석 흐름</strong>{aiUsage.length === 0 ? <p>아직 정책 해석 기록이 없습니다.</p> : aiUsage.slice(0, 5).map((record) => <p key={record.id}>{formatTime(record.occurredAt)} · {record.status === "success" ? record.model : record.status === "failed" ? "Kiln 실패 · 안전 규칙 전환" : "Kiln 미설정 · 안전 규칙"} · 입력 {record.promptTokens ?? "측정 안 됨"} / 출력 {record.completionTokens ?? "측정 안 됨"} / 합계 {record.totalTokens ?? "측정 안 됨"} 토큰 · 처리 {record.processingMs?.toFixed(2) ?? "미측정"} ms</p>)}</div>
        </section>
      </main>

      <footer><div className="brand footer-brand"><span className="brand-mark"><ShieldMark /></span><span>AgentGuard</span></div><p>AI proposes. You permit. · GWDC 2026</p></footer>
    </div>
  );
}
