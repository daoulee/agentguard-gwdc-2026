import { useState } from 'react';
import { connectWallet, hasTronLink, NILE, readNilePosition, redeemTrxOnNile, supplyTrxOnNile, waitForReceipt, type WalletState } from '../chain/tronlink';
import type { FeeContext } from '../data/sources';
import type { ActionLog, PlanRecord } from '../domain/journal';
import { ENERGY_ASSUMPTIONS, type Plan } from '../domain/plans';
import { fmt, shortAddress, usd } from '../format';

type Props = {
  plan: Plan;
  fees: FeeContext;
  ensureRecord: () => PlanRecord;
  addLog: (recordId: string, log: Omit<ActionLog, 'id' | 'recordId' | 'at'>) => void;
  logs: ActionLog[];
  onNilePosition: (position: Awaited<ReturnType<typeof readNilePosition>> & { address: string }) => void;
};

const kindLabel = { approve: '승인', supply: '공급', 'psm-swap': '교환', stake: '스테이킹', redeem: '회수', hold: '보유' } as const;

export function Execution({ plan, fees, ensureRecord, addLog, logs, onNilePosition }: Props) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [running, setRunning] = useState(false);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [walletError, setWalletError] = useState('');
  const [nileAmount, setNileAmount] = useState(10);
  const [nileAck, setNileAck] = useState(false);
  const [nileBusy, setNileBusy] = useState<'supply' | 'redeem' | null>(null);
  const [nileStatus, setNileStatus] = useState('');
  const totalFeeTrx = plan.actions.reduce((sum, item) => sum + item.feeTrx, 0);
  const nileFeeTrx = ENERGY_ASSUMPTIONS.supplyTrx * fees.energyFeeSun / 1_000_000 + 0.35;

  async function runSimulated() {
    if (!acknowledged) return;
    setRunning(true);
    const record = ensureRecord();
    for (const item of plan.actions) {
      await new Promise(resolve => setTimeout(resolve, 180));
      addLog(record.id, { label: item.label, kind: item.kind, mode: 'simulated', status: 'success', amount: item.amount, asset: item.asset, feeTrx: item.feeTrx, approvalScope: item.approvalScope, message: '메인넷 시뮬레이션: 서명·전송 없음' });
    }
    setRunning(false);
    setAcknowledged(false);
  }

  async function connect() {
    setWalletError('');
    try {
      const state = await connectWallet();
      setWallet(state);
      if (state.network === 'nile') onNilePosition({ ...(await readNilePosition(state.address)), address: state.address });
    } catch (error) { setWalletError(error instanceof Error ? error.message : '지갑 연결 실패'); }
  }

  async function runNile(kind: 'supply' | 'redeem') {
    if (!wallet || !nileAck || nileAmount <= 0) return;
    const record = ensureRecord();
    setNileBusy(kind);
    setNileAck(false); // one confirmation per transaction
    setNileStatus('TronLink에서 서명을 확인해주세요…');
    const label = kind === 'supply' ? `Nile jTRX 공급: ${fmt(nileAmount)} TRX` : `Nile jTRX 회수: ${fmt(nileAmount)} TRX`;
    const scope = kind === 'supply' ? `Nile jTRX 계약(${NILE.jTRX})으로 ${fmt(nileAmount)} TRX를 보냅니다.` : `Nile jTRX에서 ${fmt(nileAmount)} TRX만 회수합니다.`;
    try {
      const txid = kind === 'supply' ? await supplyTrxOnNile(nileAmount) : await redeemTrxOnNile(nileAmount);
      setNileStatus('전송됨. 블록 확정을 기다리는 중…');
      const receipt = await waitForReceipt(txid);
      addLog(record.id, { label, kind: kind === 'supply' ? 'supply' : 'redeem', mode: 'nile', status: receipt.status, amount: nileAmount, asset: 'TRX', feeTrx: nileFeeTrx, approvalScope: scope, txHash: txid, message: receipt.message });
      try {
        const refreshed = await connectWallet();
        setWallet(refreshed);
        onNilePosition({ ...(await readNilePosition(refreshed.address)), address: refreshed.address });
      } catch { /* the transaction result above stands even if the refresh fails */ }
      setNileStatus(receipt.status === 'success'
        ? `${kind === 'supply' ? '공급' : '회수'} 성공. ${kind === 'supply' ? '회수하려면 금액을 확인하고 다시 체크한 뒤 "Nile에서 회수"를 누르세요.' : '아래 기록과 포지션 화면에서 확인하세요.'}`
        : `상태: ${receipt.status} ${receipt.message ?? ''}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const rejected = /cancel|reject|거부|declined/i.test(message);
      addLog(record.id, { label, kind: kind === 'supply' ? 'supply' : 'redeem', mode: 'nile', status: rejected ? 'rejected' : 'failed', amount: nileAmount, asset: 'TRX', feeTrx: 0, approvalScope: scope, message });
      setNileStatus(rejected ? '사용자가 서명을 거부했습니다. 기록에 남겼습니다.' : `실패: ${message}`);
    } finally {
      setNileBusy(null);
    }
  }

  return (
    <section className="block" id="execute">
      <div className="results-top"><div><p className="eyebrow">04 / EXECUTION</p><h2>확인한 뒤에만 실행</h2></div></div>
      <p className="section-lead">행동마다 금액, 수수료, 위험, 승인 범위를 먼저 보여줍니다. <b>메인넷 행동은 시뮬레이션</b>으로 기록하고, <b>Nile 테스트넷 jTRX 공급·회수는 TronLink 서명으로 실제 실행</b>합니다.</p>

      <div className="detail-card">
        <div className="detail-header"><div><p className="eyebrow">ACTION PREVIEW · {plan.name}</p><h3>실행할 행동 {plan.actions.length}개</h3></div><span className="demo-pill">메인넷 시뮬레이션</span></div>
        <ol className="action-list">
          {plan.actions.map((item, index) => (
            <li key={item.id}>
              <div className="action-title"><span className="step">{String(index + 1).padStart(2, '0')}</span><span className="pill">{kindLabel[item.kind]}</span><strong>{item.label}</strong></div>
              <dl>
                <div><dt>금액</dt><dd>{fmt(item.amount)} {item.asset}</dd></div>
                <div><dt>예상 수수료</dt><dd>{fmt(item.feeTrx)} TRX {item.feeUsd != null && `(${usd(item.feeUsd)})`}{item.feeTrxIfRented != null && <small>에너지 대여 시 약 {fmt(item.feeTrxIfRented)} TRX</small>}<small>{fmt(item.energy, 0)} 에너지 · {item.energyMeasured ? '실측' : '가정값'}</small></dd></div>
                <div><dt>승인 범위</dt><dd>{item.approvalScope}</dd></div>
                <div><dt>위험</dt><dd>{item.risk}</dd></div>
                <div><dt>대상</dt><dd><code>{shortAddress(item.target)}</code> {item.targetName}</dd></div>
              </dl>
            </li>
          ))}
        </ol>
        <label className="ack"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /> 위 {plan.actions.length}개 행동의 금액·수수료(합계 약 {fmt(totalFeeTrx)} TRX)·위험·승인 범위를 확인했습니다.</label>
        <button className="button primary" disabled={!acknowledged || running} onClick={runSimulated}>{running ? '기록 중…' : '확인하고 시뮬레이션 실행'} <span>↗</span></button>
      </div>

      <div className="detail-card nile-card">
        <div className="detail-header"><div><p className="eyebrow">REAL TESTNET EXECUTION · NILE</p><h3>JustLend jTRX 공급·회수 실거래</h3></div><span className="pill ok">실제 거래</span></div>
        <p className="fine">메인넷 자금은 쓰지 않습니다. TronLink를 Nile 테스트넷으로 바꾸고, TRX가 없으면 <a href={NILE.faucet} target="_blank" rel="noreferrer">Nile Faucet ↗</a>에서 받으세요. 대상 계약: <code>{NILE.jTRX}</code> (JustLend Nile jTRX)</p>
        {!wallet ? (
          <button className="button secondary" onClick={connect}>{hasTronLink() ? 'TronLink 연결' : 'TronLink 필요 (설치 후 새로고침)'} <span>↗</span></button>
        ) : (
          <div className="wallet-row"><span>지갑 <code>{shortAddress(wallet.address)}</code></span><span>네트워크 <b className={wallet.network === 'nile' ? 'ok-text' : 'bad-text'}>{wallet.network === 'nile' ? 'Nile' : wallet.network === 'mainnet' ? '메인넷 (실행 차단)' : '알 수 없음'}</b></span><span>잔액 {fmt(wallet.trxBalance)} TRX</span><button className="text-button" onClick={connect}>새로고침</button></div>
        )}
        {walletError && <p className="field-error">{walletError}</p>}
        {wallet && (
          <>
            <div className="nile-form">
              <label className="field"><span>금액 <small>TRX (테스트넷)</small></span><div className="input-wrap"><input type="number" min="1" step="1" value={nileAmount} onChange={event => { setNileAmount(Number(event.target.value)); setNileAck(false); }} /><b>TRX</b></div></label>
              <dl className="mini-preview">
                <div><dt>예상 수수료</dt><dd>최대 약 {fmt(nileFeeTrx)} TRX (가정 {fmt(ENERGY_ASSUMPTIONS.supplyTrx, 0)} 에너지) · 상한 30 TRX</dd></div>
                <div><dt>승인 범위</dt><dd>토큰 승인 없음. 입력한 TRX만 이동합니다.</dd></div>
                <div><dt>위험</dt><dd>테스트넷 자산이라 금전 손실은 없습니다. 거래는 되돌릴 수 없습니다.</dd></div>
              </dl>
            </div>
            <label className="ack"><input type="checkbox" checked={nileAck} disabled={!!nileBusy} onChange={event => setNileAck(event.target.checked)} /> {fmt(nileAmount)} TRX 거래 내용을 확인했습니다.</label>
            <div className="button-row">
              <button className="button primary" disabled={!nileAck || !!nileBusy || wallet.network !== 'nile' || nileAmount <= 0 || nileAmount > wallet.trxBalance} onClick={() => runNile('supply')}>{nileBusy === 'supply' ? '진행 중…' : 'Nile에 공급 (mint)'} <span>↗</span></button>
              <button className="button secondary" disabled={!nileAck || !!nileBusy || wallet.network !== 'nile' || nileAmount <= 0} onClick={() => runNile('redeem')}>{nileBusy === 'redeem' ? '진행 중…' : 'Nile에서 회수 (redeem)'} <span>↙</span></button>
            </div>
            {nileAmount > wallet.trxBalance && <p className="field-error">잔액보다 큰 금액은 공급할 수 없습니다. Faucet에서 TRX를 받으세요.</p>}
            {nileStatus && <p className="status-line">{nileStatus}</p>}
          </>
        )}
      </div>

      {logs.length > 0 && (
        <div className="detail-card">
          <div className="detail-header"><div><p className="eyebrow">EXECUTION LOG</p><h3>실행 결과 기록</h3></div></div>
          <LogTable logs={logs} />
        </div>
      )}
    </section>
  );
}

export function LogTable({ logs }: { logs: ActionLog[] }) {
  return (
    <div className="table-scroll">
      <table className="data-table compact">
        <thead><tr><th>시각</th><th>방식</th><th>행동</th><th>결과</th><th>수수료</th><th>거래</th></tr></thead>
        <tbody>
          {[...logs].reverse().map(log => (
            <tr key={log.id}>
              <td>{new Date(log.at).toLocaleTimeString('ko-KR')}</td>
              <td>{log.mode === 'nile' ? <span className="pill ok">Nile 실거래</span> : <span className="pill">시뮬레이션</span>}</td>
              <td className="wrap"><strong>{log.label}</strong>{log.approvalScope && <small>{log.approvalScope}</small>}</td>
              <td><span className={`pill ${log.status === 'success' ? 'ok' : log.status === 'pending' ? '' : 'no'}`}>{{ success: '성공', failed: '실패', pending: '대기', rejected: '거부' }[log.status]}</span>{log.message && <small>{log.message}</small>}</td>
              <td className="num">{fmt(log.feeTrx)} TRX</td>
              <td>{log.txHash ? <a href={NILE.explorerTx(log.txHash)} target="_blank" rel="noreferrer"><code>{shortAddress(log.txHash)}</code> ↗</a> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
