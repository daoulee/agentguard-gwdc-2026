import {
  categoryLabels,
  merchantDirectory,
  mockProducts,
  type AiStatusResponse,
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

const decisionCopy = {
  allow: { label: "자동 승인", caption: "정책 범위 안에서 안전하게 실행할 수 있습니다." },
  needs_approval: { label: "사용자 승인 필요", caption: "자동 승인 한도를 넘어 사람의 확인을 기다립니다." },
  block: { label: "즉시 차단", caption: "허용된 정책 범위를 벗어나 결제를 중단했습니다." }
} as const;

const reasonLabels: Record<DecisionReason, string> = {
  allowed: "모든 정책 조건 충족",
  budget_exceeded: "총액이 예산 한도 초과",
  merchant_not_allowed: "허용되지 않은 판매자",
  category_not_allowed: "허용되지 않은 카테고리",
  deadline_expired: "정책 유효 기한 만료",
  human_approval_required: "자동 승인 한도 초과"
};

const eventLabels: Record<AuditEvent["type"], string> = {
  policy_created: "정책 적용",
  request_received: "구매 요청 수신",
  allowed: "자동 승인",
  blocked: "정책 차단",
  approval_requested: "승인 요청",
  approved: "사용자 승인",
  rejected: "사용자 거절",
  submitted: "거래 제출"
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
  const response = await fetch(url, init);
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

export function App() {
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
  const [integrityValid, setIntegrityValid] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [isDemoRunning, setIsDemoRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [actionToast, setActionToast] = useState<{ message: string; tone: "success" | "neutral" | "danger" } | null>(null);
  const [resolvingApproval, setResolvingApproval] = useState<{ id: string; action: "approve" | "reject" } | null>(null);
  const navigationLockRef = useRef(false);
  const navigationTimerRef = useRef<number | undefined>(undefined);
  const flowTimerRef = useRef<number | undefined>(undefined);
  const toastTimerRef = useRef<number | undefined>(undefined);

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
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, delay);
  }, []);

  const refreshActivity = useCallback(async () => {
    const [approvalPayload, auditPayload] = await Promise.all([
      requestJson<{ approvals: PurchaseEvaluation[] }>("/api/approvals"),
      requestJson<{ events: AuditEvent[]; integrityValid: boolean }>("/api/audit")
    ]);
    setApprovals(approvalPayload.approvals);
    setAuditEvents(auditPayload.events);
    setIntegrityValid(auditPayload.integrityValid);
  }, []);

  useEffect(() => {
    Promise.all([
      requestJson<{ policy: SpendingPolicy }>("/api/policy"),
      requestJson<AiStatusResponse>("/api/ai/status"),
      refreshActivity()
    ]).then(([policyPayload, statusPayload]) => {
      setPolicy(policyPayload.policy);
      setAiStatus(statusPayload);
      setPolicyPrompt(policyPayload.policy.sourceText);
    }).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "서버에 연결할 수 없습니다.");
    });
  }, [refreshActivity]);

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
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (navigationTimerRef.current !== undefined) window.clearTimeout(navigationTimerRef.current);
    navigationTimerRef.current = window.setTimeout(() => {
      navigationLockRef.current = false;
      setActiveSection(id);
    }, 900);
  };

  const interpretPrompt = async () => {
    setIsInterpreting(true);
    setErrorMessage("");
    setPolicyNotice("");
    try {
      const payload = await requestJson<{ draft: PolicyDraft }>("/api/policies/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: policyPrompt })
      });
      setPolicyDraft(payload.draft);
      showToast("정책 초안을 만들었습니다. 내용을 확인해주세요.", "neutral");
      if (window.innerWidth <= 960) {
        window.setTimeout(() => document.getElementById("policy-review")?.scrollIntoView({ behavior: "smooth", block: "center" }), 250);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "정책 해석에 실패했습니다.");
    } finally {
      setIsInterpreting(false);
    }
  };

  const resolveMissingField = (draft: PolicyDraft, field: PolicyMissingField) => {
    const questionIndex = draft.missingFields.indexOf(field);
    const warningKeyword: Partial<Record<PolicyMissingField, string>> = {
      budget: "금액을 찾지 못해",
      autoApprovalLimit: "자동 승인 기준을",
      allowedMerchants: "판매자 조건이",
      deadline: "구매 기한을"
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
      ...(resolves ? resolveMissingField(current, resolves) : {})
    } : current);
    setPolicyNotice("");
  };

  const fieldSource = (field: PolicyFieldKey) => {
    if (!policyDraft) return null;
    const source = policyDraft.fieldSources[field];
    return source ? <em className={`field-source source-${source}`}>{sourceLabels[source]}</em> : null;
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
    if (!policyDraft) return;
    setIsApplyingPolicy(true);
    setErrorMessage("");
    try {
      const payload = await requestJson<{ policy: SpendingPolicy }>("/api/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(policyDraft)
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

  const evaluateProduct = async (productId: string, requestFee: number) => requestJson<{ evaluation: PurchaseEvaluation }>("/api/evaluate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId, fee: requestFee })
  });

  const runEvaluation = async () => {
    setIsRunning(true);
    setErrorMessage("");
    try {
      const payload = await evaluateProduct(selectedProductId, fee);
      setEvaluation(payload.evaluation);
      await refreshActivity();
      if (payload.evaluation.decision.status === "needs_approval") {
        showToast("사용자 확인이 필요한 거래입니다. 승인함으로 이동합니다.", "neutral");
        moveToSection("approvals", 1_250);
      } else if (payload.evaluation.decision.status === "block") {
        showToast("정책 위반 거래를 차단했습니다. 감사 로그로 이동합니다.", "danger");
        moveToSection("audit", 1_250);
      } else {
        showToast("정책 범위 안에서 자동 승인했습니다. 감사 로그로 이동합니다.");
        moveToSection("audit", 1_250);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "정책 검사에 실패했습니다.");
    } finally {
      setIsRunning(false);
    }
  };

  const runDemoSequence = async () => {
    setIsDemoRunning(true);
    setErrorMessage("");
    try {
      await requestJson("/api/reset", { method: "POST" });
      let lastEvaluation: PurchaseEvaluation | null = null;
      for (const product of policyProducts) {
        const payload = await evaluateProduct(product.id, 0);
        lastEvaluation = payload.evaluation;
      }
      setEvaluation(lastEvaluation);
      setSelectedProductId(policyProducts.at(-1)?.id ?? selectedProductId);
      await refreshActivity();
      showToast("세 가지 판정을 완료했습니다. 승인 대기 건을 확인해주세요.", "neutral");
      moveToSection("approvals", 1_000);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "데모 시나리오 실행에 실패했습니다.");
    } finally {
      setIsDemoRunning(false);
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
      showToast(action === "approve" ? "거래를 승인하고 감사 기록에 저장했습니다." : "거래를 거절하고 감사 기록에 저장했습니다.", action === "approve" ? "success" : "danger");
      moveToSection("audit", 650);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "승인 처리에 실패했습니다.");
    } finally {
      setResolvingApproval(null);
    }
  };

  const resetDemo = async () => {
    try {
      await requestJson("/api/reset", { method: "POST" });
      setEvaluation(null);
      await refreshActivity();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "기록 초기화에 실패했습니다.");
    }
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
        <div className="network-status"><span /> Policy engine live</div>
      </nav>

      {errorMessage && <div className="error-banner" role="alert"><span>!</span>{errorMessage}<button onClick={() => setErrorMessage("")} type="button">닫기</button></div>}
      {actionToast && <div aria-live="polite" className={`action-toast toast-${actionToast.tone}`} role="status"><span>{actionToast.tone === "success" ? "✓" : actionToast.tone === "danger" ? "!" : "→"}</span>{actionToast.message}</div>}

      <main>
        <section className="hero" id="overview">
          <div className="hero-copy-block">
            <div className="challenge-badge"><span>GWDC 2026</span>FuriosaAI Challenge B</div>
            <h1>AI 지출은,<br /><span>승인된 범위 안에서만.</span></h1>
            <p className="hero-copy">자연어로 권한을 정하면 AgentGuard가 결제 전에 정책을 검사하고,<br />승인과 차단의 모든 근거를 검증 가능한 기록으로 남깁니다.</p>
            <div className="hero-actions">
              <a className="button button-primary" href="#policy">내 정책 만들기 <ArrowIcon /></a>
              <a className="button button-secondary" href="#simulator">거래 시뮬레이션</a>
            </div>
          </div>

          <div className="policy-preview" aria-label="활성 지출 정책 미리보기">
            <div className="preview-header">
              <div><p className="micro-label">ACTIVE POLICY · V{policy?.version ?? 1}</p><h2>{policy?.name ?? "정책 불러오는 중"}</h2></div>
              <span className="live-badge"><i /> 적용 중</span>
            </div>
            <div className="policy-statement">“{policy?.sourceText ?? "정책을 불러오고 있습니다."}”</div>
            <dl className="policy-grid">
              <div><dt>최대 예산</dt><dd>{policy ? formatKrw(policy.budget) : "-"}</dd></div>
              <div><dt>자동 승인</dt><dd>{policy ? `${formatKrw(policy.autoApprovalLimit)} 이하` : "-"}</dd></div>
              <div><dt>허용 판매자</dt><dd>{policy?.allowedMerchants.length ?? 0}곳</dd></div>
              <div><dt>유효 기한</dt><dd>{policy ? formatDeadline(policy.deadline) : "-"}</dd></div>
            </dl>
            <div className="policy-footer"><div className="avatar-stack" aria-hidden="true"><span>U</span><span>AI</span><span>✓</span></div><p>자연어 해석 → 사용자 확인 → 결정론적 검증</p></div>
          </div>
        </section>

        <section className="metrics" aria-label="AgentGuard 현재 지표">
          <article><span className="metric-dot metric-dot-green" /><div><strong>{allowedCount}</strong><p>승인된 요청</p></div></article>
          <article><span className="metric-dot metric-dot-blue" /><div><strong>{approvals.length}</strong><p>승인 대기</p></div></article>
          <article><span className="metric-dot metric-dot-violet" /><div><strong>{blockedCount}</strong><p>차단·거절</p></div></article>
        </section>

        <section className="section" id="policy">
          <div className="section-heading">
            <div><p className="micro-label">NATURAL LANGUAGE POLICY</p><h2>말로 정하고, 눈으로 확인하세요</h2></div>
            <p>AI는 문장을 정책 초안으로 바꿀 뿐입니다. 사용자가 확인하고 적용하기 전에는 어떤 지출 권한도 바뀌지 않습니다.</p>
          </div>

          <div className="policy-builder">
            <div className="policy-input-pane">
              <div className="builder-step"><span>01</span><div><strong>지출 조건 작성</strong><p>금액, 판매자, 품목, 승인 기준과 기한을 포함하면 더 정확합니다.</p></div></div>
              <textarea aria-label="자연어 지출 정책" maxLength={1000} onChange={(event) => { setPolicyPrompt(event.target.value); setPolicyDraft(null); setPolicyNotice(""); }} value={policyPrompt} />
              <div className="prompt-footer"><span>{policyPrompt.length} / 1,000</span><span className={aiStatus?.configured ? "provider-chip is-ai" : "provider-chip"}>{aiStatus?.provider ?? "연결 확인 중"}</span></div>
              <div className="template-list">
                <p>예시로 시작하기</p>
                {policyTemplates.map((template, index) => <button key={template} onClick={() => { setPolicyPrompt(template); setPolicyDraft(null); setPolicyNotice(""); }} type="button">예시 {index + 1}</button>)}
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
                    <span className={`provider-chip ${policyDraft.provider === "kiln" ? "is-ai" : ""}`}>{policyDraft.provider === "kiln" ? "Kiln · Qwen 해석" : "안전 규칙 변환"}</span>
                    <span>적용 전 초안</span>
                  </div>
                  {policyDraft.missingFields.length > 0 && (
                    <div className="clarification-card" role="status">
                      <div><span>?</span><strong>적용 전에 {policyDraft.missingFields.length}가지만 확인해주세요</strong></div>
                      <ol>{policyDraft.clarifyingQuestions.map((question, index) => <li key={question}><b>{missingFieldLabels[policyDraft.missingFields[index] ?? "deadline"]}</b>{question}</li>)}</ol>
                      <p>값을 직접 수정하면 확인 완료로 표시됩니다.</p>
                    </div>
                  )}
                  <label className="field full-field"><span>정책 이름 {fieldSource("name")}</span><input onChange={(event) => updateDraft("name", event.target.value)} value={policyDraft.name} /></label>
                  <div className="field-grid">
                    <label className={`field ${policyDraft.missingFields.includes("budget") ? "needs-confirmation" : ""}`}><span>최대 예산 {fieldSource("budget")}</span><div className="unit-input"><input min="1" onChange={(event) => updateDraft("budget", Number(event.target.value), "budget")} type="number" value={policyDraft.budget} /><b>원</b></div></label>
                    <label className={`field ${policyDraft.missingFields.includes("autoApprovalLimit") ? "needs-confirmation" : ""}`}><span>자동 승인 한도 {fieldSource("autoApprovalLimit")}</span><div className="unit-input"><input min="0" onChange={(event) => updateDraft("autoApprovalLimit", Number(event.target.value), "autoApprovalLimit")} type="number" value={policyDraft.autoApprovalLimit} /><b>원</b></div></label>
                  </div>
                  <fieldset className={`merchant-field ${policyDraft.missingFields.includes("allowedMerchants") ? "needs-confirmation" : ""}`}><legend>허용 판매자 {fieldSource("allowedMerchants")}</legend><div>{merchantOptions.map((merchant) => <label key={merchant.name} className={policyDraft.allowedMerchants.includes(merchant.name) ? "merchant-check is-checked" : "merchant-check"}><input checked={policyDraft.allowedMerchants.includes(merchant.name)} onChange={() => toggleMerchant(merchant.name)} type="checkbox" /><span>{merchant.name}{merchant.trusted ? " · 검증됨" : " · 미등록"}</span></label>)}</div></fieldset>
                  <div className="field-grid">
                    <label className={`field ${policyDraft.missingFields.includes("allowedCategories") ? "needs-confirmation" : ""}`}><span>허용 카테고리 {fieldSource("allowedCategories")}</span><input onChange={(event) => updateDraft("allowedCategories", event.target.value.split(",").map((value) => value.trim()).filter(Boolean), "allowedCategories")} value={policyDraft.allowedCategories.join(", ")} /></label>
                    <label className={`field ${policyDraft.missingFields.includes("deadline") ? "needs-confirmation" : ""}`}><span>유효 기한 {fieldSource("deadline")}</span><input onChange={(event) => updateDraft("deadline", event.target.value ? new Date(event.target.value).toISOString() : "", event.target.value ? "deadline" : undefined)} type="datetime-local" value={toLocalDateTimeValue(policyDraft.deadline)} /></label>
                  </div>
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
            <div><p className="micro-label">LIVE POLICY SIMULATOR</p><h2>AI 구매 요청을 실행해보세요</h2></div>
            <div className="heading-actions"><p>상품 하나를 고르면 현재 정책을 기준으로 판정합니다.</p><button disabled={isDemoRunning} onClick={runDemoSequence} type="button">{isDemoRunning ? "데모 실행 중…" : "핵심 3건 자동 실행"}</button></div>
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
              <button className="button button-primary run-button" disabled={isRunning || !selectedProduct} onClick={runEvaluation} type="button">{isRunning ? "정책 검사 중…" : "AI 구매 요청 실행"}<ArrowIcon /></button>
            </div>

            <div className={`decision-panel ${evaluation ? `decision-${evaluation.decision.status}` : ""}`}>
              {!evaluation ? (
                <div className="decision-empty"><span className="empty-shield"><ShieldMark /></span><p className="micro-label">WAITING FOR REQUEST</p><h3>아직 검사한 거래가 없습니다</h3><p>왼쪽에서 상품을 선택하고 구매 요청을 실행하세요.</p></div>
              ) : (
                <div className="decision-content">
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
          <div className="section-heading compact-heading"><div><p className="micro-label">HUMAN IN THE LOOP</p><h2>승인 대기함</h2></div><span className="dataset-count">{approvals.length} pending</span></div>
          {approvals.length === 0 ? <div className="empty-state"><span>✓</span><div><strong>대기 중인 요청이 없습니다</strong><p>자동 승인 한도를 초과하고 최대 예산 이하인 거래가 여기에 표시됩니다.</p></div></div> : <div className="approval-list">{approvals.map((item) => { const transition = resolvingApproval?.id === item.request.id ? `is-resolving is-${resolvingApproval.action}` : ""; return <article className={`approval-card ${transition}`} key={item.request.id}><div><p className="approval-kicker">APPROVAL REQUIRED</p><h3>{item.product.name}</h3><p>{item.product.merchant} · 요청 {formatTime(item.request.requestedAt)}</p></div><strong className="approval-price">{formatKrw(item.decision.totalAmount)}</strong><div className="approval-actions"><button className="button reject-button" disabled={resolvingApproval !== null} onClick={() => resolveApproval(item.request.id, "reject")} type="button">{resolvingApproval?.id === item.request.id && resolvingApproval.action === "reject" ? "거절 중…" : "거절"}</button><button className="button approve-button" disabled={resolvingApproval !== null} onClick={() => resolveApproval(item.request.id, "approve")} type="button">{resolvingApproval?.id === item.request.id && resolvingApproval.action === "approve" ? "승인 중…" : "승인"}</button></div></article>; })}</div>}
        </section>

        <section className="section audit-section" id="audit">
          <div className="section-heading compact-heading"><div><p className="micro-label">TAMPER-EVIDENT AUDIT TRAIL</p><h2>감사 로그</h2></div><div className="audit-actions"><span className={integrityValid ? "integrity-badge" : "integrity-badge is-invalid"}>{integrityValid ? "✓ 해시 체인 정상" : "! 기록 검증 실패"}</span><button className="text-button" onClick={resetDemo} type="button">기록 초기화</button></div></div>
          {auditEvents.length === 0 ? <div className="empty-state"><span>⌁</span><div><strong>기록된 이벤트가 없습니다</strong><p>첫 구매 요청부터 모든 판단 근거가 해시로 연결되어 저장됩니다.</p></div></div> : <div className="audit-table" role="table" aria-label="정책 감사 로그">{auditEvents.map((event) => <div className="audit-row" role="row" key={event.id}><span className={`event-dot event-${event.type}`} /><div><strong>{eventLabels[event.type]}</strong><span>{String(event.details.product ?? event.details.name ?? event.requestId.split("-").slice(-2).join("-"))}</span></div><code title={event.hash}>#{event.hash.slice(0, 8)}</code><time dateTime={event.occurredAt}>{formatTime(event.occurredAt)}</time></div>)}</div>}
        </section>
      </main>

      <footer><div className="brand footer-brand"><span className="brand-mark"><ShieldMark /></span><span>AgentGuard</span></div><p>Built for accountable AI spending · GWDC 2026</p></footer>
    </div>
  );
}
