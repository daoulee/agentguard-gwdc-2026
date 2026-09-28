import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, type NilePosition } from './components/Activity';
import { Execution } from './components/Execution';
import { NeedsChat } from './components/NeedsChat';
import { Opportunities } from './components/Opportunities';
import { PlanCompare } from './components/PlanCompare';
import { callAi } from './data/ai';
import { fetchMarketSnapshot, type MarketSnapshot } from './data/sources';
import { createLog, createRecord, loadJournal, saveJournal, type ActionLog, type Journal, type PlanRecord, type Proposal } from './domain/journal';
import { formatNeedsSummary, type Liquidity, type Needs } from './domain/needs';
import { buildPlans, type Plan } from './domain/plans';
import { fmt, usd } from './format';

export default function App() {
  const [view, setView] = useState<'planner' | 'activity'>('planner');
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiModel, setAiModel] = useState<string | null>(null);
  const [aiTokens, setAiTokens] = useState(0);
  const [needs, setNeeds] = useState<Needs>({ holdings: [] });
  const [confirmed, setConfirmed] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<Plan['id'] | null>(null);
  const [journal, setJournal] = useState<Journal>(loadJournal);
  const [sessionRecordIds, setSessionRecordIds] = useState<Record<string, string>>({});
  const [nilePosition, setNilePosition] = useState<NilePosition | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setSnapshot(await fetchMarketSnapshot()); } catch { setSnapshot(null); } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { void callAi<{ configured: boolean }>({ mode: 'status' }).then(result => setAiModel(result.ok ? result.model : null)); }, []);
  useEffect(() => { saveJournal(journal); }, [journal]);

  const planSet = useMemo(() => (confirmed && snapshot && snapshot.opportunities.some(item => item.usable) ? buildPlans(needs, snapshot) : null), [confirmed, snapshot, needs]);
  const plan = planSet ? planSet.plans.find(item => item.id === (selectedPlanId ?? planSet.recommendedId)) ?? planSet.plans[0] : null;
  const planKey = plan && snapshot ? `${plan.id}|${snapshot.fetchedAt}|${JSON.stringify(needs)}` : '';

  const onAiUsage = (tokens: number | null) => { if (tokens) setAiTokens(total => total + tokens); };

  const ensureRecord = (): PlanRecord => {
    const existing = journal.records.find(item => item.id === sessionRecordIds[planKey]);
    if (existing) return existing;
    const record = createRecord(needs, plan!, snapshot!);
    setJournal(current => ({ ...current, records: [...current.records, record] }));
    setSessionRecordIds(current => ({ ...current, [planKey]: record.id }));
    return record;
  };

  const addLog = (recordId: string, partial: Omit<ActionLog, 'id' | 'recordId' | 'at'>) => {
    setJournal(current => ({ ...current, logs: [...current.logs, createLog(recordId, partial)] }));
  };

  const applyProposal = (record: PlanRecord, proposal: Proposal, liquidity: Liquidity) => {
    if (!snapshot) return;
    const nextNeeds = { ...record.needs, liquidity };
    const rebuilt = buildPlans(nextNeeds, snapshot);
    const nextPlan = rebuilt.plans.find(item => item.id === rebuilt.recommendedId) ?? rebuilt.plans[0];
    const next = createRecord(nextNeeds, nextPlan, snapshot, record);
    setJournal(current => ({
      records: [...current.records, next],
      logs: [
        ...current.logs,
        createLog(record.id, { label: `재배분: ${proposal.from} → ${proposal.to}`, kind: 'rebalance', mode: 'simulated', status: 'success', amount: proposal.amount, asset: proposal.asset, feeTrx: 0, message: `${proposal.reason} 새 계획 v${next.version} (${nextPlan.name})로 기록했습니다. 메인넷 시뮬레이션.` }),
      ],
    }));
  };

  const resetNeeds = () => { setConfirmed(false); setSelectedPlanId(null); };

  return (
    <div className="site-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="TRON Yield Studio 홈" onClick={() => setView('planner')}><span className="brand-mark">T<span>↗</span></span><span>TRON Yield Studio</span></a>
        <nav className="main-nav" aria-label="주요 메뉴">
          <button className={view === 'planner' ? 'active' : ''} onClick={() => setView('planner')}>계획 설계</button>
          <button className={view === 'activity' ? 'active' : ''} onClick={() => setView('activity')}>포지션·리뷰{journal.records.length ? ` (${journal.records.length})` : ''}</button>
        </nav>
        <div className="header-right"><span className={`network-dot ${aiModel ? '' : 'off'}`} /> {aiModel ? `AI · Kiln ${aiModel}` : 'AI · 규칙 기반'}{aiTokens > 0 && ` · ${fmt(aiTokens, 0)} tokens`}</div>
      </header>

      <main id="top">
        <div className="notice"><strong>LIVE DATA</strong><span>JustLend·USDD 메인넷 공개 API 실시간 조회 · 메인넷 실행은 시뮬레이션 · Nile 테스트넷 jTRX 공급·회수는 실제 거래 · 투자 권유가 아닙니다.</span></div>

        {view === 'activity' ? (
          <Activity records={journal.records} logs={journal.logs} snapshot={snapshot} nilePosition={nilePosition} onApplyProposal={applyProposal} onBack={() => setView('planner')} />
        ) : (
          <>
            <section className="hero">
              <div className="hero-copy">
                <p className="eyebrow">TRON / CHALLENGE B <span>GWDC 2026</span></p>
                <h1>자산의 흐름을<br /><em>설계하다.</em></h1>
                <p className="lead">대화로 조건을 정리하고, JustLend·USDD 실데이터로 두 가지 계획을 비교한 뒤, 확인한 행동만 실행하고 기록합니다. 결정은 언제나 사용자가 내립니다.</p>
                <div className="hero-foot"><span>01 대화</span><span>→</span><span>02 탐색</span><span>→</span><span>03 비교</span><span>→</span><span>04 실행</span><span>→</span><span>05 리뷰</span></div>
              </div>
              <div className="hero-visual" aria-label="현재 상태">
                <div className="visual-header"><span>LIVE PLAN CANVAS</span><span className="visual-status"><i /> {loading ? '조회 중' : snapshot ? '실데이터' : '조회 실패'}</span></div>
                <div className="route-glyph" aria-hidden="true"><span>↗</span><span>↗</span><span>↗</span></div>
                <h2>{plan ? plan.name : confirmed ? '데이터 대기 중' : '조건을 알려주세요'}</h2>
                <p>{confirmed ? formatNeedsSummary(needs).join(' · ') : '왼쪽 아래 대화창에서 보유 자산과 목표를 말해주세요.'}</p>
                <div className="visual-amount"><small>{plan ? `${needs.horizonDays}일 예상 순수익` : '계획할 자산'}</small><strong>{plan ? usd(plan.totals.netUsd) : needs.holdings.length ? needs.holdings.map(item => `${fmt(item.amount, 0)} ${item.asset}`).join(' + ') : '—'}</strong></div>
                {plan && <div className="visual-chart"><div className="allocation-bar" aria-hidden="true">{plan.allocations.map(item => <span key={item.key} style={{ width: `${item.usd / Math.max(plan.allocations.reduce((sum, a) => sum + a.usd, 0), 1e-9) * 100}%` }} />)}</div><div>{plan.allocations.map(item => <span key={item.key}>{item.label}</span>)}</div></div>}
                <div className="visual-footer">기본 수익과 기간 한정 보상을 나눠 보여줍니다. <span>↗</span></div>
              </div>
            </section>

            <NeedsChat needs={needs} onNeedsChange={setNeeds} confirmed={confirmed} onConfirm={() => setConfirmed(true)} onReset={resetNeeds} aiModel={aiModel} onAiUsage={onAiUsage} />
            <Opportunities snapshot={snapshot} loading={loading} onRefresh={refresh} />
            {planSet && plan && snapshot ? (
              <>
                <PlanCompare planSet={planSet} selectedId={plan.id} onSelect={setSelectedPlanId} horizonDays={needs.horizonDays ?? 90} aiModel={aiModel} onAiUsage={onAiUsage} />
                <Execution key={planKey} plan={plan} fees={snapshot.fees} ensureRecord={ensureRecord} addLog={addLog} logs={journal.logs.filter(log => log.recordId === sessionRecordIds[planKey])} onNilePosition={setNilePosition} />
              </>
            ) : (
              <section className="block"><div className="execution-card"><div className="execution-symbol">↗</div><div><p className="eyebrow">NEXT STEP</p><h3>{confirmed ? '상품 데이터를 불러오면 계획을 만듭니다.' : '대화로 조건을 확정하면 계획 비교와 실행 단계가 열립니다.'}</h3><p>데이터 조회에 실패하면 추천하지 않습니다.</p></div></div></section>
            )}
          </>
        )}
      </main>
      <footer><span>TRON YIELD STUDIO <i>✳</i> GWDC 2026</span><span>데이터: JustLend OpenAPI · USDD data-platform · TronGrid · 실행: Nile 테스트넷 / 시뮬레이션</span></footer>
    </div>
  );
}
