import { mockProducts } from "@agentguard/shared";

const readinessItems = [
  "Kiln · Qwen3-32B 연결",
  "결정론적 정책 엔진",
  "사용자 승인 및 긴급 중지",
  "테스트넷 거래와 감사 기록"
];

export function App() {
  return (
    <main className="page-shell">
      <header className="hero">
        <p className="eyebrow">GWDC 2026 · FuriosaAI Challenge B</p>
        <h1>AI가 돈을 쓰기 전에, 경계를 확인합니다.</h1>
        <p className="hero-copy">
          AgentGuard는 AI 에이전트의 결제 요청을 정책으로 검증하고 승인·차단의 근거를 감사 가능한 기록으로 남깁니다.
        </p>
        <div className="status-pill">사전 준비 스캐폴딩 실행 중</div>
      </header>

      <section className="grid" aria-label="프로젝트 준비 현황">
        <article className="panel">
          <p className="panel-label">MVP FLOW</p>
          <h2>한 번의 정상 결제, 두 번의 정확한 차단</h2>
          <ol className="flow-list">
            <li>사용자 조건을 정책 JSON으로 변환</li>
            <li>예산·판매자·기한을 코드로 검사</li>
            <li>허용된 요청만 사용자에게 승인 요청</li>
            <li>거래 해시와 판단 근거를 함께 기록</li>
          </ol>
        </article>

        <article className="panel panel-accent">
          <p className="panel-label">BUILD CHECK</p>
          <h2>핵심 연동 준비</h2>
          <ul className="check-list">
            {readinessItems.map((item) => (
              <li key={item}>
                <span aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="catalog" aria-labelledby="catalog-title">
        <div>
          <p className="panel-label">MOCK CATALOG</p>
          <h2 id="catalog-title">정책 검사에 사용할 상품</h2>
        </div>
        <div className="product-grid">
          {mockProducts.map((product) => (
            <article className="product-card" key={product.id}>
              <div>
                <p>{product.merchant}</p>
                <h3>{product.name}</h3>
              </div>
              <strong>{product.priceKrw.toLocaleString("ko-KR")}원</strong>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

