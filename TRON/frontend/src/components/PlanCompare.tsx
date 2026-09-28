import { useState } from 'react';
import { callAi } from '../data/ai';
import { ENERGY_ASSUMPTIONS, type Plan, type PlanSet } from '../domain/plans';
import { fmt, pct, usd } from '../format';

type Props = {
  planSet: PlanSet;
  selectedId: Plan['id'];
  onSelect: (id: Plan['id']) => void;
  horizonDays: number;
  aiModel: string | null;
  onAiUsage: (tokens: number | null) => void;
};

export function PlanCompare({ planSet, selectedId, onSelect, horizonDays, aiModel, onAiUsage }: Props) {
  const plan = planSet.plans.find(item => item.id === selectedId) ?? planSet.plans[0];
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState('');

  async function explain() {
    setExplaining(true);
    setExplainError('');
    const payload = {
      plan: plan.name,
      horizonDays,
      allocations: plan.allocations.map(item => ({ product: item.label, asset: item.asset, amount: Number(item.amount.toFixed(2)), baseApy: pct(item.baseApy, 3), incentiveApy: pct(item.incentiveApy), exit: item.exit })),
      totals: { baseYieldUsd: usd(plan.totals.baseUsd), incentiveYieldUsd: usd(plan.totals.incentiveUsd), entryCostUsd: usd(plan.totals.entryCostUsd), exitCostUsd: usd(plan.totals.exitCostUsd), netUsd: usd(plan.totals.netUsd) },
      approvals: plan.actions.filter(item => item.kind === 'approve').map(item => item.approvalScope),
      rationale: plan.rationale,
      risks: plan.risks,
      warnings: plan.warnings,
    };
    const response = await callAi<string>({ mode: 'explain', plan: payload });
    setExplaining(false);
    if (response.ok) {
      onAiUsage(response.usage.totalTokens);
      setExplanations(current => ({ ...current, [plan.id]: String(response.result) }));
    } else setExplainError(response.configured ? `AI 설명을 받지 못했습니다 (${response.error}). 아래 코드 근거는 그대로 유효합니다.` : 'AI가 연결되지 않았습니다. 아래 코드 근거를 확인하세요.');
  }

  return (
    <section className="block" id="plans">
      <div className="results-top">
        <div><p className="eyebrow">03 / PLAN COMPARISON</p><h2>두 가지 계획 비교</h2></div>
        <span className="scenario-count">0{planSet.plans.length} <small>PLANS · {horizonDays}일</small></span>
      </div>
      <p className="section-lead"><b>추천: {planSet.plans.find(item => item.id === planSet.recommendedId)?.name}</b> — {planSet.recommendationReason}</p>
      <div className="plans">
        {planSet.plans.map((item, index) => (
          <button key={item.id} type="button" className={`plan-card ${selectedId === item.id ? 'chosen' : ''}`} onClick={() => onSelect(item.id)} aria-pressed={selectedId === item.id}>
            <div className="plan-top"><span>PLAN 0{index + 1}</span>{planSet.recommendedId === item.id ? <span className="pill ok">추천</span> : <span className="plan-arrow">↗</span>}</div>
            <div><h3>{item.name}</h3><p>{item.tagline}</p></div>
            <div className="plan-metric"><span>{horizonDays}일 예상 순수익 <small>현재 금리 유지 가정</small></span><strong>{usd(item.totals.netUsd)}</strong></div>
            <div className="split-line"><span>기본 {usd(item.totals.baseUsd)}</span><span>보상 {usd(item.totals.incentiveUsd)}</span><span>비용 −{usd(item.totals.entryCostUsd + item.totals.exitCostUsd)}</span></div>
            <div className="allocation-bar" aria-hidden="true">{item.allocations.map(allocation => <span key={allocation.key} style={{ width: `${allocation.usd / Math.max(item.allocations.reduce((sum, a) => sum + a.usd, 0), 1e-9) * 100}%` }} />)}</div>
            <div className="plan-bottom"><span>보상 의존도 {Math.round(item.incentiveShare * 100)}%</span><span>{selectedId === item.id ? '선택됨' : '자세히 보기'}</span></div>
          </button>
        ))}
      </div>

      <div className="detail-card">
        <div className="detail-header"><div><p className="eyebrow">PLAN BREAKDOWN</p><h3>{plan.name} <span>배분 상세</span></h3></div><span className="demo-pill">실데이터 · {horizonDays}일 기준</span></div>
        <div className="table-scroll">
          <table className="data-table compact">
            <thead><tr><th>배분 대상</th><th>금액</th><th>기본 수익률</th><th>보상률</th><th>기본 수익</th><th>보상 수익</th><th>회수</th></tr></thead>
            <tbody>
              {plan.allocations.map(item => (
                <tr key={item.key}>
                  <td><strong>{item.label}</strong></td>
                  <td className="num">{fmt(item.amount)} {item.asset}<small>{usd(item.usd)}</small></td>
                  <td className="num">{pct(item.baseApy, 3)}</td>
                  <td className="num">{item.incentiveApy > 0 ? pct(item.incentiveApy) : '—'}</td>
                  <td className="num">{usd(item.baseUsd)}</td>
                  <td className="num">{item.incentiveUsd > 0 ? usd(item.incentiveUsd) : '—'}</td>
                  <td className="wrap">{item.exit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="yield-breakdown">
          <div><span>기본 수익</span><strong>+{usd(plan.totals.baseUsd)}</strong></div>
          <div><span>기간 한정 보상</span><strong>+{usd(plan.totals.incentiveUsd)}</strong></div>
          <div><span>진입 + 회수 비용</span><strong>−{usd(plan.totals.entryCostUsd + plan.totals.exitCostUsd)}</strong><small>{fmt(plan.totals.costTrx)} TRX 소각 기준</small></div>
          <div className="net-row"><span>예상 순수익 <small>/{horizonDays}일</small></span><strong>{usd(plan.totals.netUsd)}</strong></div>
        </div>
        {plan.warnings.length > 0 && <div className="warn-box">{plan.warnings.map(warning => <p key={warning}>⚠ {warning}</p>)}</div>}
        <div className="two-col">
          <div><h4>배분 근거 (코드 계산)</h4><ul>{plan.rationale.map(line => <li key={line}>{line}</li>)}</ul></div>
          <div><h4>회수 조건</h4><ul>{plan.exitConditions.map(line => <li key={line}>{line}</li>)}</ul><h4>주요 위험</h4><ul>{plan.risks.map(line => <li key={line}>{line}</li>)}</ul></div>
        </div>
        <div className="ai-box">
          <div className="ai-head"><strong>AI 설명 {aiModel ? `· Kiln ${aiModel}` : ''}</strong><button className="button secondary" onClick={explain} disabled={!aiModel || explaining}>{explaining ? '작성 중…' : explanations[plan.id] ? '다시 설명' : '쉬운 말로 설명 듣기'} <span>↗</span></button></div>
          {explanations[plan.id] ? <p className="ai-text">{explanations[plan.id]}</p> : <p className="fine">{aiModel ? 'AI는 위 표의 숫자만 사용해 설명하도록 제한됩니다.' : 'AI가 연결되지 않아 코드 근거만 표시합니다.'}</p>}
          {explainError && <p className="field-error">{explainError}</p>}
        </div>
        <p className="fine">비용 산식: 에너지 × 체인 에너지 가격 + 거래당 대역폭 {350}바이트. approve 에너지는 TronGrid 실측값, 공급 {fmt(ENERGY_ASSUMPTIONS.supplyTrc20, 0)} · TRX 공급 {fmt(ENERGY_ASSUMPTIONS.supplyTrx, 0)} · PSM {fmt(ENERGY_ASSUMPTIONS.psmSwap, 0)} · 회수 {fmt(ENERGY_ASSUMPTIONS.redeem, 0)} 에너지는 <b>가정값</b>입니다. 에너지를 대여하면 비용이 줄어듭니다.</p>
      </div>
    </section>
  );
}
