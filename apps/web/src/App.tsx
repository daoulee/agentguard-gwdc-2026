import { mockProducts } from "@agentguard/shared";
import { type MouseEvent, useEffect, useRef, useState } from "react";

type Scenario = {
  label: string;
  title: string;
  detail: string;
  amount: string;
  status: "approved" | "blocked";
};

const scenarios: Scenario[] = [
  { label: "정상 결제", title: "Quiet Mechanical Keyboard", detail: "KeyboardLab · 허용 판매자", amount: "87,000원", status: "approved" },
  { label: "예산 초과", title: "Creator Pro Keyboard", detail: "상품 98,000원 + 수수료 5,000원", amount: "103,000원", status: "blocked" },
  { label: "판매자 위반", title: "Unknown Deal Keyboard", detail: "UnlistedMarket · 미등록 판매자", amount: "65,000원", status: "blocked" }
];

const navigationItems = [
  { id: "overview", label: "Overview" },
  { id: "scenarios", label: "Scenarios" },
  { id: "catalog", label: "Catalog" }
] as const;

type SectionId = (typeof navigationItems)[number]["id"];

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

function DecisionIcon({ status }: Pick<Scenario, "status">) {
  return (
    <span className={`decision-icon decision-icon-${status}`} aria-hidden="true">
      {status === "approved" ? "✓" : "×"}
    </span>
  );
}

export function App() {
  const [activeSection, setActiveSection] = useState<SectionId>("overview");
  const navigationLockRef = useRef(false);
  const navigationTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const updateActiveSection = () => {
      if (navigationLockRef.current) return;

      const isAtPageBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (isAtPageBottom) {
        setActiveSection("catalog");
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

  return (
    <div className="app-shell">
      <nav className="topbar" aria-label="주요 메뉴">
        <a className="brand" href="#top" aria-label="AgentGuard 홈">
          <span className="brand-mark"><ShieldMark /></span>
          <span>AgentGuard</span>
        </a>

        <div className="nav-links">
          {navigationItems.map(({ id, label }) => (
            <a
              aria-current={activeSection === id ? "page" : undefined}
              className={activeSection === id ? "is-active" : undefined}
              href={`#${id}`}
              key={id}
              onClick={(event) => handleNavigation(event, id)}
            >
              {label}
            </a>
          ))}
        </div>

        <div className="network-status"><span /> Testnet ready</div>
      </nav>

      <main id="top">
        <section className="hero" id="overview">
          <div className="hero-copy-block">
            <div className="challenge-badge">
              <span>GWDC 2026</span>
              FuriosaAI Challenge B
            </div>
            <h1>AI 지출은,<br /><span>승인된 범위 안에서만.</span></h1>
            <p className="hero-copy">
              AgentGuard는 AI 에이전트의 결제 요청을 정책으로 검증하고,<br />
              승인과 차단의 모든 근거를 감사 가능한 기록으로 남깁니다.
            </p>
            <div className="hero-actions">
              <button className="button button-primary" type="button">새 정책 만들기 <ArrowIcon /></button>
              <a className="button button-secondary" href="#scenarios">데모 시나리오 보기</a>
            </div>
          </div>

          <div className="policy-preview" aria-label="활성 지출 정책 미리보기">
            <div className="preview-header">
              <div><p className="micro-label">ACTIVE POLICY</p><h2>키보드 구매 위임</h2></div>
              <span className="live-badge"><i /> 적용 중</span>
            </div>

            <div className="policy-statement">“승인된 판매자에서 10만원 이하 키보드를 오늘 안에 구매해.”</div>

            <dl className="policy-grid">
              <div><dt>예산 한도</dt><dd>100,000원</dd></div>
              <div><dt>허용 판매자</dt><dd>2곳</dd></div>
              <div><dt>승인 방식</dt><dd>결제 전 확인</dd></div>
              <div><dt>유효 기한</dt><dd>오늘 23:59</dd></div>
            </dl>

            <div className="policy-footer">
              <div className="avatar-stack" aria-hidden="true"><span>U</span><span>AI</span><span>✓</span></div>
              <p>사용자 → AI 요청 → 정책 검증</p>
            </div>
          </div>
        </section>

        <section className="metrics" aria-label="AgentGuard 핵심 지표">
          <article><span className="metric-dot metric-dot-green" /><div><strong>4</strong><p>정책 검사 항목</p></div></article>
          <article><span className="metric-dot metric-dot-blue" /><div><strong>100%</strong><p>결정 근거 기록</p></div></article>
          <article><span className="metric-dot metric-dot-violet" /><div><strong>1 + 2</strong><p>정상 결제 · 차단 시나리오</p></div></article>
        </section>

        <section className="section" id="scenarios">
          <div className="section-heading">
            <div><p className="micro-label">DECISION DEMO</p><h2>같은 요청, 다른 결정</h2></div>
            <p>AI의 말이 아니라 사용자가 승인한 정책을 기준으로 판단합니다.</p>
          </div>

          <div className="scenario-grid">
            {scenarios.map((scenario) => (
              <article className="scenario-card" key={scenario.title}>
                <div className="scenario-topline"><span className="scenario-label">{scenario.label}</span><DecisionIcon status={scenario.status} /></div>
                <div><h3>{scenario.title}</h3><p>{scenario.detail}</p></div>
                <div className="scenario-result">
                  <strong>{scenario.amount}</strong>
                  <span className={`result-${scenario.status}`}>{scenario.status === "approved" ? "승인 가능" : "자동 차단"}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="section catalog-section" id="catalog">
          <div className="section-heading compact-heading">
            <div><p className="micro-label">MOCK CATALOG</p><h2>정책 검사용 상품 데이터</h2></div>
            <span className="dataset-count">{mockProducts.length} products</span>
          </div>

          <div className="catalog-table" role="table" aria-label="목업 상품 목록">
            {mockProducts.map((product, index) => (
              <div className="catalog-row" role="row" key={product.id}>
                <div className="product-index" aria-hidden="true">0{index + 1}</div>
                <div className="product-main"><strong>{product.name}</strong><span>{product.merchant}</span></div>
                <span className="category-chip">{product.category}</span>
                <strong className="product-price">{product.priceKrw.toLocaleString("ko-KR")}원</strong>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer>
        <div className="brand footer-brand"><span className="brand-mark"><ShieldMark /></span><span>AgentGuard</span></div>
        <p>Built for accountable AI spending · GWDC 2026</p>
      </footer>
    </div>
  );
}
