import {
  mockProducts,
  type AuditEvent,
  type DecisionReason,
  type PurchaseEvaluation,
  type SpendingPolicy
} from "@agentguard/shared";
import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

const navigationItems = [
  { id: "overview", label: "Overview" },
  { id: "simulator", label: "Simulator" },
  { id: "approvals", label: "Approvals" },
  { id: "audit", label: "Audit log" }
] as const;

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
  policy_created: "정책 생성",
  request_received: "구매 요청 수신",
  allowed: "자동 승인",
  blocked: "정책 차단",
  approval_requested: "승인 요청",
  approved: "사용자 승인",
  rejected: "사용자 거절",
  submitted: "거래 제출"
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

export function App() {
  const [activeSection, setActiveSection] = useState<SectionId>("overview");
  const [policy, setPolicy] = useState<SpendingPolicy | null>(null);
  const [selectedProductId, setSelectedProductId] = useState(mockProducts[0]?.id ?? "");
  const [fee, setFee] = useState(0);
  const [evaluation, setEvaluation] = useState<PurchaseEvaluation | null>(null);
  const [approvals, setApprovals] = useState<PurchaseEvaluation[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const navigationLockRef = useRef(false);
  const navigationTimerRef = useRef<number | undefined>(undefined);

  const refreshActivity = useCallback(async () => {
    const [approvalPayload, auditPayload] = await Promise.all([
      requestJson<{ approvals: PurchaseEvaluation[] }>("/api/approvals"),
      requestJson<{ events: AuditEvent[] }>("/api/audit")
    ]);
    setApprovals(approvalPayload.approvals);
    setAuditEvents(auditPayload.events);
  }, []);

  useEffect(() => {
    Promise.all([
      requestJson<{ policy: SpendingPolicy }>("/api/policy"),
      refreshActivity()
    ]).then(([policyPayload]) => {
      setPolicy(policyPayload.policy);
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

  const runEvaluation = async () => {
    setIsRunning(true);
    setErrorMessage("");
    try {
      const payload = await requestJson<{ evaluation: PurchaseEvaluation }>("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: selectedProductId, fee })
      });
      setEvaluation(payload.evaluation);
      await refreshActivity();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "정책 검사에 실패했습니다.");
    } finally {
      setIsRunning(false);
    }
  };

  const resolveApproval = async (requestId: string, action: "approve" | "reject") => {
    setErrorMessage("");
    try {
      await requestJson(`/api/approvals/${requestId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      await refreshActivity();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "승인 처리에 실패했습니다.");
    }
  };

  const resetDemo = async () => {
    await requestJson("/api/reset", { method: "POST" });
    setEvaluation(null);
    await refreshActivity();
  };

  const selectedProduct = useMemo(
    () => mockProducts.find((product) => product.id === selectedProductId) ?? mockProducts[0],
    [selectedProductId]
  );
  const decision = evaluation ? decisionCopy[evaluation.decision.status] : null;
  const allowedCount = auditEvents.filter((event) => event.type === "allowed" || event.type === "approved").length;
  const blockedCount = auditEvents.filter((event) => event.type === "blocked" || event.type === "rejected").length;

  return (
    <div className="app-shell">
      <nav className="topbar" aria-label="주요 메뉴">
        <a className="brand" href="#overview" aria-label="AgentGuard 홈">
          <span className="brand-mark"><ShieldMark /></span><span>AgentGuard</span>
        </a>
        <div className="nav-links">
          {navigationItems.map(({ id, label }) => (
            <a
              aria-current={activeSection === id ? "page" : undefined}
              className={activeSection === id ? "is-active" : undefined}
              href={`#${id}`}
              key={id}
              onClick={(event) => handleNavigation(event, id)}
            >{label}</a>
          ))}
        </div>
        <div className="network-status"><span /> Policy engine live</div>
      </nav>

      {errorMessage && <div className="error-banner" role="alert">{errorMessage}</div>}

      <main>
        <section className="hero" id="overview">
          <div className="hero-copy-block">
            <div className="challenge-badge"><span>GWDC 2026</span>FuriosaAI Challenge B</div>
            <h1>AI 지출은,<br /><span>승인된 범위 안에서만.</span></h1>
            <p className="hero-copy">AgentGuard는 AI 에이전트의 결제 요청을 정책으로 검증하고,<br />승인과 차단의 모든 근거를 감사 가능한 기록으로 남깁니다.</p>
            <div className="hero-actions">
              <a className="button button-primary" href="#simulator">거래 시뮬레이션 <ArrowIcon /></a>
              <a className="button button-secondary" href="#audit">감사 기록 보기</a>
            </div>
          </div>

          <div className="policy-preview" aria-label="활성 지출 정책 미리보기">
            <div className="preview-header">
              <div><p className="micro-label">ACTIVE POLICY</p><h2>{policy?.name ?? "정책 불러오는 중"}</h2></div>
              <span className="live-badge"><i /> 적용 중</span>
            </div>
            <div className="policy-statement">“승인된 판매자에서 10만원 이하 키보드를 오늘 안에 구매해.”</div>
            <dl className="policy-grid">
              <div><dt>최대 예산</dt><dd>{policy ? formatKrw(policy.budget) : "-"}</dd></div>
              <div><dt>자동 승인</dt><dd>{policy ? `${formatKrw(policy.autoApprovalLimit)} 이하` : "-"}</dd></div>
              <div><dt>허용 판매자</dt><dd>{policy?.allowedMerchants.length ?? 0}곳</dd></div>
              <div><dt>초과 처리</dt><dd>사용자 확인</dd></div>
            </dl>
            <div className="policy-footer">
              <div className="avatar-stack" aria-hidden="true"><span>U</span><span>AI</span><span>✓</span></div>
              <p>사용자 정책 → AI 요청 → 결정론적 검증</p>
            </div>
          </div>
        </section>

        <section className="metrics" aria-label="AgentGuard 현재 지표">
          <article><span className="metric-dot metric-dot-green" /><div><strong>{allowedCount}</strong><p>승인된 요청</p></div></article>
          <article><span className="metric-dot metric-dot-blue" /><div><strong>{approvals.length}</strong><p>승인 대기</p></div></article>
          <article><span className="metric-dot metric-dot-violet" /><div><strong>{blockedCount}</strong><p>차단·거절</p></div></article>
        </section>

        <section className="section" id="simulator">
          <div className="section-heading">
            <div><p className="micro-label">LIVE POLICY SIMULATOR</p><h2>AI 구매 요청을 실행해보세요</h2></div>
            <p>상품 하나를 고르면 서버의 정책 엔진이 예산, 판매자, 카테고리, 승인 한도를 순서대로 검사합니다.</p>
          </div>

          <div className="simulator-layout">
            <div className="simulator-controls">
              <div className="control-heading"><span>01</span><div><strong>구매 대상 선택</strong><p>각 상품은 서로 다른 정책 결과를 보여줍니다.</p></div></div>
              <div className="product-options">
                {mockProducts.map((product) => (
                  <button
                    className={selectedProductId === product.id ? "product-option is-selected" : "product-option"}
                    key={product.id}
                    onClick={() => { setSelectedProductId(product.id); setEvaluation(null); }}
                    type="button"
                  >
                    <span className="option-radio" />
                    <span><strong>{product.name}</strong><small>{product.merchant} · {product.category}</small></span>
                    <b>{formatKrw(product.priceKrw)}</b>
                  </button>
                ))}
              </div>

              <label className="fee-field">
                <span><strong>추가 수수료</strong><small>예산 초과 상황도 시험할 수 있습니다.</small></span>
                <span className="fee-input"><input min="0" onChange={(event) => setFee(Math.max(0, Number(event.target.value)))} type="number" value={fee} />원</span>
              </label>

              <button className="button button-primary run-button" disabled={isRunning || !selectedProduct} onClick={runEvaluation} type="button">
                {isRunning ? "정책 검사 중…" : "AI 구매 요청 실행"}<ArrowIcon />
              </button>
            </div>

            <div className={`decision-panel ${evaluation ? `decision-${evaluation.decision.status}` : ""}`}>
              {!evaluation ? (
                <div className="decision-empty">
                  <span className="empty-shield"><ShieldMark /></span>
                  <p className="micro-label">WAITING FOR REQUEST</p>
                  <h3>아직 검사한 거래가 없습니다</h3>
                  <p>왼쪽에서 상품을 선택하고 구매 요청을 실행하세요.</p>
                </div>
              ) : (
                <div className="decision-content">
                  <div className="decision-status"><span>{evaluation.decision.status === "allow" ? "✓" : evaluation.decision.status === "block" ? "×" : "!"}</span><p>POLICY DECISION</p></div>
                  <h3>{decision?.label}</h3>
                  <p className="decision-caption">{decision?.caption}</p>
                  <div className="decision-total"><span>검사 총액</span><strong>{formatKrw(evaluation.decision.totalAmount)}</strong></div>
                  <ul className="reason-list">
                    {evaluation.decision.reasons.map((reason) => <li key={reason}><span />{reasonLabels[reason]}</li>)}
                  </ul>
                  <div className="check-flow">
                    <span className="is-done">요청 수신</span><i />
                    <span className="is-done">정책 검사</span><i />
                    <span className="is-done">결정 기록</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="section approval-section" id="approvals">
          <div className="section-heading compact-heading">
            <div><p className="micro-label">HUMAN IN THE LOOP</p><h2>승인 대기함</h2></div>
            <span className="dataset-count">{approvals.length} pending</span>
          </div>
          {approvals.length === 0 ? (
            <div className="empty-state"><span>✓</span><div><strong>대기 중인 요청이 없습니다</strong><p>9만원을 초과하고 10만원 이하인 거래를 실행하면 여기에 표시됩니다.</p></div></div>
          ) : (
            <div className="approval-list">
              {approvals.map((item) => (
                <article className="approval-card" key={item.request.id}>
                  <div><p className="approval-kicker">APPROVAL REQUIRED</p><h3>{item.product.name}</h3><p>{item.product.merchant} · 요청 {formatTime(item.request.requestedAt)}</p></div>
                  <strong className="approval-price">{formatKrw(item.decision.totalAmount)}</strong>
                  <div className="approval-actions">
                    <button className="button reject-button" onClick={() => resolveApproval(item.request.id, "reject")} type="button">거절</button>
                    <button className="button approve-button" onClick={() => resolveApproval(item.request.id, "approve")} type="button">승인</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="section audit-section" id="audit">
          <div className="section-heading compact-heading">
            <div><p className="micro-label">AUDITABLE BY DESIGN</p><h2>감사 로그</h2></div>
            <button className="text-button" onClick={resetDemo} type="button">기록 초기화</button>
          </div>
          {auditEvents.length === 0 ? (
            <div className="empty-state"><span>⌁</span><div><strong>기록된 이벤트가 없습니다</strong><p>첫 구매 요청부터 모든 판단 근거가 시간순으로 남습니다.</p></div></div>
          ) : (
            <div className="audit-table" role="table" aria-label="정책 감사 로그">
              {auditEvents.map((event) => (
                <div className="audit-row" role="row" key={event.id}>
                  <span className={`event-dot event-${event.type}`} />
                  <div><strong>{eventLabels[event.type]}</strong><span>{String(event.details.product ?? event.requestId.split("-").slice(-2).join("-"))}</span></div>
                  <code>{event.requestId.slice(-10)}</code>
                  <time dateTime={event.occurredAt}>{formatTime(event.occurredAt)}</time>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer>
        <div className="brand footer-brand"><span className="brand-mark"><ShieldMark /></span><span>AgentGuard</span></div>
        <p>Built for accountable AI spending · GWDC 2026</p>
      </footer>
    </div>
  );
}
