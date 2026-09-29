import { useMemo, useState } from 'react';
import type { MarketSnapshot } from '../data/sources';
import { proposeAdjustments, reviewRecord, type ActionLog, type PlanRecord, type Proposal } from '../domain/journal';
import { liquidityLabel, type Liquidity } from '../domain/needs';
import { fmt, pct, time, usd } from '../format';
import { LogTable } from './Execution';

export type NilePosition = { address: string; jTokens: number; underlyingTrx: number; supplyApy: number; readAt: string };

type Props = {
  records: PlanRecord[];
  logs: ActionLog[];
  snapshot: MarketSnapshot | null;
  nilePosition: NilePosition | null;
  onApplyProposal: (record: PlanRecord, proposal: Proposal, liquidity: Liquidity) => void;
  onBack: () => void;
};

export function Activity({ records, logs, snapshot, nilePosition, onApplyProposal, onBack }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const record = records.find(item => item.id === selectedId) ?? records[records.length - 1];
  const [replayDays, setReplayDays] = useState(30);
  const [liquidityNow, setLiquidityNow] = useState<Liquidity | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const review = useMemo(() => (record ? reviewRecord(record, snapshot, replayDays) : null), [record, snapshot, replayDays]);
  const liquidity = liquidityNow ?? record?.needs.liquidity ?? 'long';
  const proposals = useMemo(() => (record && snapshot ? proposeAdjustments(record, snapshot, { ...record.needs, liquidity }, Math.max(1, (record.needs.horizonDays ?? 90) - replayDays)) : []), [record, snapshot, liquidity, replayDays]);
  const recordLogs = record ? logs.filter(log => log.recordId === record.id) : [];
  const nileLogs = logs.filter(log => log.mode === 'nile' && log.status === 'success');
  const nileNetDeposit = nileLogs.reduce((sum, log) => sum + (log.kind === 'supply' ? log.amount : log.kind === 'redeem' ? -log.amount : 0), 0);

  if (!record || !review) {
    return (
      <section className="activity-page">
        <p className="eyebrow">05 / POSITIONS & REVIEW</p>
        <h1>계획 이후도<br /><i>보이도록.</i></h1>
        <div className="empty-card"><span className="empty-icon">◎</span><h2>기록된 계획이 없습니다</h2><p>계획을 실행(시뮬레이션 또는 Nile)하면 원래 계획, 가정한 금리, 실행 결과가 여기에 쌓입니다.</p><button className="button primary" onClick={onBack}>계획 설계로 <span>↗</span></button></div>
      </section>
    );
  }

  return (
    <section className="activity-page">
      <p className="eyebrow">05 / POSITIONS & REVIEW</p>
      <h1>계획 이후도<br /><i>보이도록.</i></h1>
      <div className="record-tabs">{records.map(item => <button key={item.id} className={item.id === record.id ? 'active' : ''} onClick={() => setSelectedId(item.id)}>v{item.version} · {item.plan.name}<small>{time(item.createdAt)}</small></button>)}</div>

      <div className="review-grid">
        <div className="detail-card">
          <p className="eyebrow">ORIGINAL PLAN · v{record.version}</p>
          <h3>{record.plan.name}</h3>
          <ul className="summary-list">
            <li>보유 자산: {record.needs.holdings.map(item => `${fmt(item.amount)} ${item.asset}`).join(', ')}</li>
            <li>기간 {record.needs.horizonDays}일 · {record.needs.liquidity && liquidityLabel[record.needs.liquidity]}</li>
            <li>예상 순수익 {usd(record.plan.totals.netUsd)} (기본 {usd(record.plan.totals.baseUsd)} + 보상 {usd(record.plan.totals.incentiveUsd)} − 비용 {usd(record.plan.totals.entryCostUsd + record.plan.totals.exitCostUsd)})</li>
          </ul>
          <h4>가정한 금리 (데이터 조회 {time(record.marketFetchedAt)})</h4>
          <ul className="summary-list">{record.assumptions.map(item => <li key={item.opportunityId}>{item.name}: 기본 {pct(item.baseApy, 3)}{item.incentiveApy > 0 && ` + 보상 ${pct(item.incentiveApy)}`}</li>)}</ul>
        </div>

        <div className="detail-card">
          <div className="detail-header"><div><p className="eyebrow">EXPECTED VS REPLAY</p><h3>예상 대비 결과</h3></div><span className="pill">시뮬레이션 리플레이</span></div>
          <label className="field"><span>경과 일수 <small>{replayDays}일 — 같은 포지션을 최신 금리로 다시 계산합니다</small></span><input className="range" type="range" min="1" max={record.needs.horizonDays ?? 365} value={replayDays} onChange={event => setReplayDays(Number(event.target.value))} /></label>
          <div className="table-scroll">
            <table className="data-table compact">
              <thead><tr><th>포지션</th><th>가정 금리</th><th>최신 금리</th><th>예상</th><th>리플레이</th><th>차이</th></tr></thead>
              <tbody>{review.lines.map(line => (
                <tr key={line.key}><td><strong>{line.label}</strong><small>{usd(line.usd)}</small></td><td className="num">{pct(line.assumedApy)}</td><td className="num">{line.currentApy == null ? '조회 실패' : pct(line.currentApy)}</td><td className="num">{usd(line.expectedUsd, 4)}</td><td className="num">{line.replayUsd == null ? '—' : usd(line.replayUsd, 4)}</td><td className={`num ${line.driftUsd != null && line.driftUsd < 0 ? 'bad-text' : 'ok-text'}`}>{line.driftUsd == null ? '—' : `${line.driftUsd >= 0 ? '+' : ''}${usd(line.driftUsd, 4)}`}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <div className="yield-breakdown three"><div><span>예상 ({replayDays}일)</span><strong>{usd(review.expectedUsd, 4)}</strong></div><div><span>리플레이</span><strong>{usd(review.replayUsd, 4)}</strong></div><div className="net-row"><span>차이</span><strong>{review.driftUsd >= 0 ? '+' : ''}{usd(review.driftUsd, 4)}</strong></div></div>
          <p className="fine">메인넷 포지션은 시뮬레이션입니다. 금리가 바뀌면 차이가 생깁니다. 실제 잔고 변화는 아래 Nile 포지션에서 확인합니다.</p>
        </div>
      </div>

      <div className="detail-card">
        <div className="detail-header"><div><p className="eyebrow">LIVE NILE POSITION</p><h3>실제 온체인 포지션 (Nile jTRX)</h3></div><span className="pill ok">체인 조회</span></div>
        {nilePosition ? (
          <div className="yield-breakdown">
            <div><span>보유 jTRX</span><strong>{fmt(nilePosition.jTokens, 4)}</strong></div>
            <div><span>현재 TRX 가치</span><strong>{fmt(nilePosition.underlyingTrx, 6)} TRX</strong></div>
            <div><span>순 예치액 (기록 기준)</span><strong>{fmt(nileNetDeposit, 6)} TRX</strong></div>
            <div className="net-row"><span>실제 변화</span><strong>{nileNetDeposit > 0 ? `${nilePosition.underlyingTrx - nileNetDeposit >= 0 ? '+' : ''}${fmt(nilePosition.underlyingTrx - nileNetDeposit, 6)} TRX` : '—'}</strong><small>공급 APY {pct(nilePosition.supplyApy, 4)} · {time(nilePosition.readAt)}</small></div>
          </div>
        ) : <p className="fine">실행 화면에서 TronLink(Nile)를 연결하면 jTRX 잔고를 체인에서 직접 읽어 표시합니다.</p>}
      </div>

      <div className="detail-card">
        <div className="detail-header"><div><p className="eyebrow">MONITOR & ADJUST</p><h3>조건 변화와 재배분 제안</h3></div></div>
        <fieldset className="field"><legend>지금의 유동성 필요 (바뀌었다면 선택)</legend><div className="segmented three">{(['instant', 'month', 'long'] as Liquidity[]).map(option => <button key={option} type="button" className={liquidity === option ? 'selected' : ''} onClick={() => setLiquidityNow(option)}>{liquidityLabel[option]}</button>)}</div></fieldset>
        {proposals.length === 0 ? <p className="fine">최신 데이터 기준으로 조정할 필요가 없습니다. 보상이 절반 아래로 줄거나, 유동성 조건이 바뀌어 sTRX(회수 대기)·USDD(PSM 교환 필요)가 맞지 않게 되면 제안합니다.</p> : (
          <ul className="proposal-list">{proposals.map(proposal => (
            <li key={proposal.id}>
              <strong>{proposal.from} → {proposal.to}</strong>
              <p>{proposal.reason}</p>
              <dl className="mini-preview">
                <div><dt>금액</dt><dd>{fmt(proposal.amount)} {proposal.asset}</dd></div>
                <div><dt>남은 기간 예상 효과</dt><dd>{proposal.expectedGainUsd >= 0 ? '+' : ''}{usd(proposal.expectedGainUsd)}</dd></div>
                <div><dt>필요 행동</dt><dd>회수 → (필요 시 교환) → 새 시장 공급. 각 단계 수수료가 듭니다.</dd></div>
              </dl>
              {confirming === proposal.id ? (
                <div className="button-row"><button className="button primary" onClick={() => { onApplyProposal(record, proposal, liquidity); setConfirming(null); }}>확인: 재배분 시뮬레이션 실행 <span>↗</span></button><button className="button secondary" onClick={() => setConfirming(null)}>취소 <span>×</span></button></div>
              ) : <button className="button secondary" onClick={() => setConfirming(proposal.id)}>재배분 검토 <span>↗</span></button>}
            </li>
          ))}</ul>
        )}
      </div>

      {recordLogs.length > 0 && <div className="detail-card"><div className="detail-header"><div><p className="eyebrow">ACTION LOG · v{record.version}</p><h3>실행 기록</h3></div></div><LogTable logs={recordLogs} /></div>}
    </section>
  );
}
