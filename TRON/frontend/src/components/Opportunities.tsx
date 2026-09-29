import { isStale, type MarketSnapshot } from '../data/sources';
import { fmt, pct, time } from '../format';

type Props = { snapshot: MarketSnapshot | null; loading: boolean; onRefresh: () => void };

export function Opportunities({ snapshot, loading, onRefresh }: Props) {
  const stale = snapshot ? isStale(snapshot.fetchedAt) : false;
  return (
    <section className="block" id="screening">
      <div className="results-top">
        <div><p className="eyebrow">02 / OPPORTUNITY SCREENING</p><h2>실제 상품 데이터</h2></div>
        <button className="button secondary" onClick={onRefresh} disabled={loading}>{loading ? '불러오는 중…' : '다시 조회'} <span>↻</span></button>
      </div>
      <p className="section-lead">JustLend와 USDD 메인넷 공개 API에서 직접 불러온 값입니다. 조회만 하며 메인넷 자산은 움직이지 않습니다.{snapshot && <> 조회 시각 <b>{time(snapshot.fetchedAt)}</b>{stale && <em className="stale"> · 10분이 지나 오래된 값입니다. 다시 조회하세요.</em>}</>}</p>
      {snapshot?.errors.length ? <div className="warn-box">{snapshot.errors.map(error => <p key={error}>{error}</p>)}</div> : null}
      {!snapshot && !loading && <div className="warn-box"><p>데이터를 불러오지 못했습니다. 추천을 멈춥니다.</p></div>}
      {snapshot && (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>프로젝트 · 상품</th><th>자산</th><th>기본 수익률</th><th>인센티브</th><th>회수 조건</th><th>출처</th><th>계획 사용</th></tr></thead>
            <tbody>
              {snapshot.opportunities.map(item => (
                <tr key={item.id} className={item.usable ? '' : 'muted-row'}>
                  <td><strong>{item.name}</strong><small>{item.project} · <code>{item.contract}</code></small></td>
                  <td>{item.asset}</td>
                  <td className="num">{pct(item.baseApy, 3)}</td>
                  <td className="num">{item.incentiveApy > 0 ? <>{pct(item.incentiveApy)}<small>{item.incentiveToken} 보상 · 기간 한정</small></> : '—'}</td>
                  <td className="wrap">{item.exit}{item.liquidity && <small>가용 현금 {fmt(item.liquidity.available, 0)} {item.liquidity.unit}</small>}</td>
                  <td className="wrap">{item.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>)}<small>{time(item.fetchedAt)}</small></td>
                  <td>{item.usable ? <span className="pill ok">사용</span> : <span className="pill no" title={item.unusableReason}>제외</span>}{!item.usable && <small>{item.unusableReason}</small>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {snapshot && (
        <div className="fee-strip">
          <div><span>에너지 가격 (소각)</span><strong>{snapshot.fees.energyFeeSun} sun</strong><small>1만 에너지 = {fmt(snapshot.fees.burnTrxPer10kEnergy)} TRX</small></div>
          <div><span>에너지 대여 (JustLend)</span><strong>{snapshot.fees.rentTrxPer10kEnergy != null ? `${fmt(snapshot.fees.rentTrxPer10kEnergy, 3)} TRX` : '—'}</strong><small>1만 에너지당</small></div>
          <div><span>TRX 가격</span><strong>{snapshot.fees.trxUsd != null ? `$${fmt(snapshot.fees.trxUsd, 4)}` : '—'}</strong><small>JustLend sTRX API</small></div>
          <div><span>USDT approve 에너지</span><strong>{snapshot.fees.approveEnergyMeasured != null ? fmt(snapshot.fees.approveEnergyMeasured, 0) : '—'}</strong><small>TronGrid 실측{snapshot.fees.approveEnergyMeasuredAt && snapshot.fees.approveEnergyMeasuredAt < snapshot.fetchedAt ? ` · ${time(snapshot.fees.approveEnergyMeasuredAt)} 값` : ''}</small></div>
          <div><span>USDD PSM 수수료</span><strong>{snapshot.fees.psmFeeIn != null ? pct(snapshot.fees.psmFeeIn) : '—'}</strong><small>USDT → USDD</small></div>
        </div>
      )}
      {snapshot?.usdd && (
        <div className="usdd-card">
          <div><p className="eyebrow">USDD PROTOCOL · TRON</p><h3>USDD 상태와 교환 경로</h3><p className="fine">USDD를 쓰는 계획은 이 값으로 회수 경로와 위험을 판단합니다. {snapshot.usdd.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label} ↗ </a>)}</p></div>
          <div className="fee-strip inline">
            <div><span>담보율 (TRON)</span><strong className={snapshot.usdd.collateralRatio < 1.2 ? 'bad-text' : ''}>{pct(snapshot.usdd.collateralRatio, 0)}</strong><small>담보 ÷ 발행</small></div>
            <div><span>발행량</span><strong>${fmt(snapshot.usdd.supplyUsd / 1e6, 0)}M</strong><small>USDD (TRON)</small></div>
            <div><span>USDT → USDD</span><strong>{snapshot.usdd.psmTin != null ? pct(snapshot.usdd.psmTin) : '—'}</strong><small>PSM tin (API)</small></div>
            <div><span>USDD → USDT</span><strong>{snapshot.usdd.psmTout != null ? pct(snapshot.usdd.psmTout) : '미확인'}</strong><small>PSM tout (체인)</small></div>
          </div>
        </div>
      )}
      <p className="fine">바이낸스 월렛 TRON Carnival 같은 공동 캠페인은 기간·자격·보상 규칙을 API로 검증할 수 없어 포함하지 않았습니다.</p>
    </section>
  );
}
