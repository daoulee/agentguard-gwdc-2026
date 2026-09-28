import { useMemo, useState } from 'react';

type Risk = '안정형' | '균형형' | '적극형';
type Liquidity = '언제든 인출' | '30일 내 사용' | '장기 보유';
type Product = 'JustLend USDD 공급' | 'USDD 수익 전략' | '유동성 보유';
type Allocation = { product: Product; share: number; baseRate: number; incentiveRate: number };
type Plan = { id: string; name: string; eyebrow: string; description: string; allocations: Allocation[]; accent: 'mint' | 'blue' };
type SavedDraft = { planId: string; amount: number; days: number; risk: Risk; liquidity: Liquidity; savedAt: string };

const DEMO_RATES = {
  justLend: { base: 2.8, incentive: 1.4 },
  usdd: { base: 4.0, incentive: 1.0 },
};
const formatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const formatAmount = (value: number) => formatter.format(value);

function createPlans(risk: Risk, liquidity: Liquidity): Plan[] {
  const liquidBoost = liquidity === '언제든 인출' ? 15 : liquidity === '30일 내 사용' ? 8 : 0;
  const riskBoost = risk === '안정형' ? 10 : risk === '적극형' ? -8 : 0;
  const reserveA = Math.min(65, Math.max(12, 32 + liquidBoost + riskBoost));
  const justLendA = Math.max(15, 48 - Math.round((reserveA - 32) * 0.65));
  const reserveB = Math.min(45, Math.max(8, 15 + Math.round(liquidBoost * 0.65) + Math.round(riskBoost * 0.5)));
  const justLendB = Math.max(20, 53 - Math.round((reserveB - 15) * 0.5));
  const allocation = (j: number, reserve: number): Allocation[] => [
    { product: 'JustLend USDD 공급', share: j, baseRate: DEMO_RATES.justLend.base, incentiveRate: DEMO_RATES.justLend.incentive },
    { product: 'USDD 수익 전략', share: 100 - j - reserve, baseRate: DEMO_RATES.usdd.base, incentiveRate: DEMO_RATES.usdd.incentive },
    { product: '유동성 보유', share: reserve, baseRate: 0, incentiveRate: 0 },
  ];
  return [
    { id: 'liquid', name: '유동성 우선', eyebrow: 'PLAN 01 / FLEXIBLE', description: '필요할 때 쓸 금액을 더 남기고, 나머지만 수익 기회에 배분합니다.', allocations: allocation(justLendA, reserveA), accent: 'mint' },
    { id: 'growth', name: '수익 균형', eyebrow: 'PLAN 02 / BALANCED', description: '유동성을 일부 확보하면서 두 수익 경로의 비중을 높입니다.', allocations: allocation(justLendB, reserveB), accent: 'blue' },
  ];
}

function estimates(plan: Plan, amount: number, days: number) {
  const principal = Math.max(0, amount);
  const horizon = Math.max(0, days);
  const base = plan.allocations.reduce((sum, item) => sum + principal * item.share / 100 * item.baseRate / 100 * horizon / 365, 0);
  const incentives = plan.allocations.reduce((sum, item) => sum + principal * item.share / 100 * item.incentiveRate / 100 * horizon / 365, 0);
  const cost = principal > 0 && horizon > 0 ? 1.6 : 0; // 가상 온체인 비용. 실제 에너지 비용이 아님.
  return { base, incentives, cost, net: base + incentives - cost };
}

export default function App() {
  const [amount, setAmount] = useState(10_000);
  const [days, setDays] = useState(90);
  const [risk, setRisk] = useState<Risk>('균형형');
  const [liquidity, setLiquidity] = useState<Liquidity>('30일 내 사용');
  const [confirmed, setConfirmed] = useState(false);
  const [selected, setSelected] = useState('liquid');
  const [savedDraft, setSavedDraft] = useState<SavedDraft | null>(() => {
    try {
      const value = localStorage.getItem('tron-yield-studio-plan');
      return value ? JSON.parse(value) as SavedDraft : null;
    } catch { return null; }
  });
  const [activeSection, setActiveSection] = useState<'planner' | 'activity'>('planner');
  const [showNotes, setShowNotes] = useState(false);
  const plans = useMemo(() => createPlans(risk, liquidity), [risk, liquidity]);
  const current = plans.find(plan => plan.id === selected) ?? plans[0];
  const result = estimates(current, amount, days);
  const valid = Number.isFinite(amount) && amount > 0 && Number.isFinite(days) && days > 0;
  const currentSaved = savedDraft?.planId === current.id && savedDraft.amount === amount && savedDraft.days === days && savedDraft.risk === risk && savedDraft.liquidity === liquidity;

  function changeProfile(change: () => void) {
    change();
    setConfirmed(false);
  }

  function savePlan() {
    if (!valid || !confirmed) return;
    const value = { planId: current.id, amount, days, risk, liquidity, savedAt: new Date().toISOString() };
    try { localStorage.setItem('tron-yield-studio-plan', JSON.stringify(value)); } catch { /* private browsing may disallow storage */ }
    setSavedDraft(value);
  }

  return (
    <div className="site-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="TRON Yield Studio 홈"><span className="brand-mark">T<span>↗</span></span><span>TRON Yield Studio</span></a>
        <nav className="main-nav" aria-label="주요 메뉴">
          <button className={activeSection === 'planner' ? 'active' : ''} onClick={() => setActiveSection('planner')}>계획 설계</button>
          <button className={activeSection === 'activity' ? 'active' : ''} onClick={() => setActiveSection('activity')}>활동 내역</button>
        </nav>
        <div className="header-right"><span className="network-dot" /> TRON · 화면 시연 <span className="divider" /> <span>GWDC 2026</span></div>
      </header>

      <main id="top">
        <div className="notice"><strong>DEMO DATA</strong><span>표시된 수익률·비용은 시연용 가정값입니다. 실시간 상품 정보나 투자 권유가 아닙니다.</span><button onClick={() => setShowNotes(!showNotes)} aria-expanded={showNotes}>{showNotes ? '닫기' : '자세히 보기'} ↗</button></div>
        {showNotes && <div className="notice-details">JustLend와 USDD의 실제 상품 데이터, 이용 자격, 인센티브 조건, 에너지 비용은 아직 연결·검증되지 않았습니다. 예상 수익은 입력 금액과 기간에 단순 연율을 적용한 화면 예시이며 실제 수익과 다를 수 있습니다. 지갑 거래는 실행되지 않습니다.</div>}

        {activeSection === 'activity' ? (
          <section className="activity-page">
            <p className="eyebrow">POSITION MONITOR / 02</p>
            <h1>계획 이후도<br /><i>보이도록.</i></h1>
            <p className="lead">원래 계획과 실제 잔고·수익을 비교하는 공간입니다. 지금은 거래나 포지션 연동이 없어 실제 내역을 표시하지 않습니다.</p>
            <div className="empty-card"><span className="empty-icon">◎</span><h2>연결된 포지션이 없습니다</h2><p>지갑 연동과 실행 기록 기능이 추가되면 예치·회수 결과와 예상 대비 실제 수익을 이곳에서 확인할 수 있습니다.</p>{savedDraft && <div className="draft-summary"><small>브라우저에 저장한 계획 초안</small><strong>{savedDraft.planId === 'liquid' ? '유동성 우선' : '수익 균형'} · {formatAmount(savedDraft.amount)} USDD</strong><span>{savedDraft.days}일 / {savedDraft.liquidity} / {savedDraft.risk}</span></div>}<button className="button primary" onClick={() => setActiveSection('planner')}>계획 설계로 돌아가기 <span>↗</span></button></div>
          </section>
        ) : (
          <>
            <section className="hero">
              <div className="hero-copy"><p className="eyebrow">TRON / CHALLENGE B <span>GWDC 2026</span></p><h1>자산의 흐름을<br /><em>설계하다.</em></h1><p className="lead">보유 금액과 필요한 유동성을 바탕으로 TRON 생태계의 두 가지 배분안을 비교해보세요. 결정은 언제나 사용자가 내립니다.</p><div className="hero-foot"><span>01 / INPUT</span><span>→</span><span>02 / COMPARE</span><span>→</span><span>03 / CHOOSE</span></div></div>
              <div className="hero-visual" aria-label="현재 선택한 계획 미리보기"><div className="visual-header"><span>LIVE PLAN CANVAS / 01</span><span className="visual-status"><i /> 시연용</span></div><div className="route-glyph" aria-hidden="true"><span>↗</span><span>↗</span><span>↗</span></div><h2>{current.name}</h2><p>사용자 조건에 따라 달라지는 배분 초안</p><div className="visual-amount"><small>계획할 자산</small><strong>{formatAmount(amount)} <span>USDD</span></strong></div><div className="visual-chart"><div className="allocation-bar" aria-hidden="true">{current.allocations.map(item => <span key={item.product} style={{ width: `${item.share}%` }} />)}</div><div><span>JustLend {current.allocations[0].share}%</span><span>USDD {current.allocations[1].share}%</span><span>보유 {current.allocations[2].share}%</span></div></div><div className="visual-footer">수익률은 실시간 연동 전 가정값입니다. <span>↗</span></div></div>
            </section>

            <section className="workspace" id="planner">
              <aside className="profile-card">
                <div className="section-head"><span className="section-index">01</span><div><p className="eyebrow">YOUR PROFILE</p><h2>투자 조건 입력</h2></div></div>
                <p className="section-description">확실하지 않은 항목은 먼저 확인하세요. 입력을 바꾸면 기존 확인 상태가 해제됩니다.</p>
                <label className="field"><span>계획할 금액 <small>USDD 기준</small></span><div className="input-wrap"><input type="number" min="1" step="100" value={amount} onChange={event => changeProfile(() => setAmount(Number(event.target.value)))} /><b>USDD</b></div></label>
                <label className="field"><span>운용 기간 <small>일</small></span><div className="input-wrap"><input type="number" min="1" max="3650" step="1" value={days} onChange={event => changeProfile(() => setDays(Number(event.target.value)))} /><b>DAYS</b></div></label>
                <fieldset className="field"><legend>유동성 필요</legend><div className="segmented three">{(['언제든 인출', '30일 내 사용', '장기 보유'] as Liquidity[]).map(option => <button key={option} className={liquidity === option ? 'selected' : ''} onClick={() => changeProfile(() => setLiquidity(option))} type="button">{option}</button>)}</div></fieldset>
                <fieldset className="field"><legend>위험 성향</legend><div className="segmented">{(['안정형', '균형형', '적극형'] as Risk[]).map(option => <button key={option} className={risk === option ? 'selected' : ''} onClick={() => changeProfile(() => setRisk(option))} type="button">{option}</button>)}</div></fieldset>
                <div className="profile-summary"><span>확인할 조건</span><strong>{formatAmount(amount)} USDD · {days}일</strong><small>{liquidity} / {risk}</small></div>
                <button className="button primary full" disabled={!valid} onClick={() => setConfirmed(true)}>{confirmed ? '조건 확인 완료 ✓' : '이 조건으로 계획 확인'} <span>↗</span></button>
                {!valid && <p className="field-error" role="alert">금액과 기간을 0보다 크게 입력해주세요.</p>}
              </aside>

              <div className="results">
                <div className="results-top"><div><p className="eyebrow">ALLOCATION SCENARIOS</p><h2>두 가지 경로를 비교하세요.</h2></div><span className="scenario-count">02 <small>PLANS</small></span></div>
                <div className="plans">{plans.map((plan, index) => { const value = estimates(plan, amount, days); return <button key={plan.id} type="button" className={`plan-card ${plan.accent} ${selected === plan.id ? 'chosen' : ''}`} onClick={() => setSelected(plan.id)} aria-pressed={selected === plan.id}><div className="plan-top"><span>{plan.eyebrow}</span><span className="plan-arrow">↗</span></div><div><h3>{plan.name}</h3><p>{plan.description}</p></div><div className="plan-metric"><span>기간 예상 순수익 <small>시연용</small></span><strong>{formatAmount(value.net)} <small>USDD</small></strong></div><div className="allocation-bar" aria-hidden="true">{plan.allocations.map(item => <span key={item.product} style={{ width: `${item.share}%` }} />)}</div><div className="plan-bottom"><span>즉시 보유 {plan.allocations[2].share}%</span><span>{selected === plan.id ? '선택됨' : `플랜 0${index + 1} 보기`}</span></div></button>; })}</div>

                <div className="detail-card"><div className="detail-header"><div><p className="eyebrow">PLAN BREAKDOWN</p><h3>{current.name} <span>배분 상세</span></h3></div><span className="demo-pill">가정값으로 계산</span></div><div className="detail-table" role="table" aria-label="자산 배분 상세"><div className="table-head" role="row"><span>배분 대상</span><span>비중</span><span>금액</span><span>가정 연율</span></div>{current.allocations.map((item, i) => <div className="table-row" role="row" key={item.product}><span className="product"><i className={`product-dot dot-${i}`} />{item.product}</span><span>{item.share}%</span><span>{formatAmount(amount * item.share / 100)} USDD</span><span>{(item.baseRate + item.incentiveRate).toFixed(1)}%</span></div>)}</div><div className="yield-breakdown"><div><span>기본 수익 추정</span><strong>+{formatAmount(result.base)}</strong></div><div><span>인센티브 추정</span><strong>+{formatAmount(result.incentives)}</strong></div><div><span>동작 비용 가정</span><strong>−{formatAmount(result.cost)}</strong></div><div className="net-row"><span>예상 순수익 <small>/{days}일</small></span><strong>{formatAmount(result.net)} <small>USDD</small></strong></div></div></div>

                <div className="execution-card"><div className="execution-symbol">↗</div><div><p className="eyebrow">NEXT STEP</p><h3>{confirmed ? '계획을 기록할 준비가 됐어요.' : '먼저 투자 조건을 확인해주세요.'}</h3><p>실제 예치·회수·리밸런싱은 아직 연결되지 않았습니다. 지갑 승인이나 온체인 거래는 발생하지 않습니다.</p>{currentSaved && <p className="saved-message" role="status">‘{current.name}’ 계획 초안을 이 브라우저에 저장했습니다. 실제 포지션은 생성되지 않았습니다.</p>}</div><button className="button secondary" disabled={!confirmed || !valid} onClick={savePlan}>{currentSaved ? '초안 다시 저장' : '계획 초안 저장'} <span>↗</span></button></div>
              </div>
            </section>
          </>
        )}
      </main>
      <footer><span>TRON YIELD STUDIO <i>✳</i> GWDC 2026</span><span>시연용 프로토타입 · 실제 수익률 및 거래 미연결</span></footer>
    </div>
  );
}
