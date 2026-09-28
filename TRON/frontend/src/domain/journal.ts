import type { MarketSnapshot, Opportunity } from '../data/sources';
import type { Needs } from './needs';
import type { Action, Plan } from './plans';

export type ExecutionMode = 'simulated' | 'nile';
export type ActionStatus = 'success' | 'failed' | 'pending' | 'rejected';

export type ActionLog = {
  id: string;
  recordId: string;
  at: string;
  label: string;
  kind: Action['kind'] | 'rebalance';
  mode: ExecutionMode;
  status: ActionStatus;
  amount: number;
  asset: string;
  feeTrx: number;
  approvalScope?: string;
  txHash?: string;
  message?: string;
};

export type RateAssumption = { opportunityId: Opportunity['id']; name: string; baseApy: number; incentiveApy: number };

// Everything needed to review the plan later: the plan itself, the rates it assumed, and when.
export type PlanRecord = {
  id: string;
  createdAt: string;
  needs: Needs;
  plan: Plan;
  marketFetchedAt: string;
  assumptions: RateAssumption[];
  version: number;
  parentId?: string;
};

export type Journal = { records: PlanRecord[]; logs: ActionLog[] };

const STORAGE_KEY = 'tron-yield-studio-journal-v2';

export function loadJournal(): Journal {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { records: [], logs: [] };
    const parsed = JSON.parse(raw) as Journal;
    return { records: Array.isArray(parsed.records) ? parsed.records : [], logs: Array.isArray(parsed.logs) ? parsed.logs : [] };
  } catch { return { records: [], logs: [] }; }
}

export function saveJournal(journal: Journal) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(journal)); } catch { /* storage may be unavailable */ }
}

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function createRecord(needs: Needs, plan: Plan, snapshot: MarketSnapshot, parent?: PlanRecord): PlanRecord {
  const used = new Set(plan.allocations.map(item => item.opportunityId));
  return {
    id: newId('plan'),
    createdAt: new Date().toISOString(),
    needs,
    plan,
    marketFetchedAt: snapshot.fetchedAt,
    assumptions: snapshot.opportunities.filter(item => used.has(item.id)).map(item => ({ opportunityId: item.id, name: item.name, baseApy: item.baseApy, incentiveApy: item.incentiveApy })),
    version: parent ? parent.version + 1 : 1,
    parentId: parent?.id,
  };
}

export function createLog(recordId: string, partial: Omit<ActionLog, 'id' | 'recordId' | 'at'>): ActionLog {
  return { id: newId('log'), recordId, at: new Date().toISOString(), ...partial };
}

export type ReviewLine = {
  key: string;
  label: string;
  usd: number;
  assumedApy: number;
  currentApy: number | null;
  expectedUsd: number;
  replayUsd: number | null;
  driftUsd: number | null;
};

export type Review = { days: number; lines: ReviewLine[]; expectedUsd: number; replayUsd: number; driftUsd: number };

// Expected yield uses the rates recorded with the plan; the replay re-prices the same positions
// with the latest fetched rates. The replay is a simulation and is labeled as such in the UI.
export function reviewRecord(record: PlanRecord, snapshot: MarketSnapshot | null, days: number): Review {
  const current = new Map(snapshot?.opportunities.map(item => [item.id, item]) ?? []);
  const lines = record.plan.allocations.filter(item => item.opportunityId !== 'reserve').map(item => {
    const assumed = item.baseApy + item.incentiveApy;
    const live = current.get(item.opportunityId as Opportunity['id']);
    const currentApy = live ? live.baseApy + live.incentiveApy : null;
    const expectedUsd = item.usd * assumed * days / 365;
    const replayUsd = currentApy == null ? null : item.usd * currentApy * days / 365;
    return { key: item.key, label: item.label, usd: item.usd, assumedApy: assumed, currentApy, expectedUsd, replayUsd, driftUsd: replayUsd == null ? null : replayUsd - expectedUsd };
  });
  const expectedUsd = lines.reduce((sum, line) => sum + line.expectedUsd, 0);
  const replayUsd = lines.reduce((sum, line) => sum + (line.replayUsd ?? line.expectedUsd), 0);
  return { days, lines, expectedUsd, replayUsd, driftUsd: replayUsd - expectedUsd };
}

export type Proposal = { id: string; reason: string; from: string; to: string; amount: number; asset: string; expectedGainUsd: number };

// Monitoring rules: propose a move when a reward the plan relied on has shrunk, or when the
// user's liquidity need no longer fits a position with an unstake wait.
export function proposeAdjustments(record: PlanRecord, snapshot: MarketSnapshot, needsNow: Needs, horizonDays: number): Proposal[] {
  const current = new Map(snapshot.opportunities.filter(item => item.usable).map(item => [item.id, item]));
  const proposals: Proposal[] = [];
  const jusdt = current.get('jl-usdt');
  const jtrx = current.get('jl-trx');
  for (const item of record.plan.allocations) {
    if (item.opportunityId === 'reserve') continue;
    const assumed = record.assumptions.find(entry => entry.opportunityId === item.opportunityId);
    const live = current.get(item.opportunityId as Opportunity['id']);
    if (!assumed || !live) continue;
    const incentiveDropped = assumed.incentiveApy > 0 && live.incentiveApy < assumed.incentiveApy * 0.5;
    if (item.opportunityId === 'jl-usdd' && jusdt && (incentiveDropped || live.baseApy + live.incentiveApy < jusdt.baseApy)) {
      const gain = item.usd * (jusdt.baseApy - (live.baseApy + live.incentiveApy)) * horizonDays / 365;
      proposals.push({
        id: `${item.key}-to-jusdt`,
        reason: incentiveDropped
          ? `USDD 채굴 보상이 ${(assumed.incentiveApy * 100).toFixed(2)}%에서 ${(live.incentiveApy * 100).toFixed(2)}%로 줄었습니다.`
          : `USDD 공급 수익률(${((live.baseApy + live.incentiveApy) * 100).toFixed(2)}%)이 USDT 공급(${(jusdt.baseApy * 100).toFixed(2)}%)보다 낮아졌습니다.`,
        from: item.label, to: jusdt.name, amount: item.amount, asset: item.asset, expectedGainUsd: gain,
      });
    }
    if (item.opportunityId === 'strx' && needsNow.liquidity && needsNow.liquidity !== 'long' && jtrx) {
      proposals.push({
        id: `${item.key}-to-jtrx`,
        reason: '유동성 조건이 바뀌어 회수 대기가 있는 sTRX가 더 이상 맞지 않습니다.',
        from: item.label, to: jtrx.name, amount: item.amount, asset: item.asset,
        expectedGainUsd: item.usd * (jtrx.baseApy - live.baseApy) * horizonDays / 365,
      });
    }
  }
  return proposals;
}
