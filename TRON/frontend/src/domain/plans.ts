import type { Asset, FeeContext, MarketSnapshot, Opportunity } from '../data/sources';
import { MAINNET } from '../data/sources';
import type { Needs } from './needs';

// Energy per action. approve is measured live when possible; the rest are stated assumptions
// until we measure them on-chain, and the UI labels them as such.
export const ENERGY_ASSUMPTIONS = {
  supplyTrc20: 150_000,
  supplyTrx: 70_000,
  redeem: 120_000,
  psmSwap: 160_000,
  stakeTrx: 100_000,
  approveFallback: 100_000,
} as const;
export const BANDWIDTH_BYTES_PER_TX = 350;

export type ActionKind = 'approve' | 'supply' | 'psm-swap' | 'stake' | 'redeem' | 'hold';

export type Action = {
  id: string;
  kind: ActionKind;
  label: string;
  asset: Asset;
  amount: number;
  target: string; // contract address or 'wallet'
  targetName: string;
  approvalScope: string;
  energy: number;
  energyMeasured: boolean;
  feeTrx: number;
  feeTrxIfRented: number | null;
  feeUsd: number | null;
  risk: string;
};

export type Allocation = {
  key: string;
  opportunityId: Opportunity['id'] | 'reserve';
  label: string;
  asset: Asset;
  amount: number;
  usd: number;
  baseApy: number;
  incentiveApy: number;
  baseUsd: number;
  incentiveUsd: number;
  exit: string;
};

export type Plan = {
  id: 'core' | 'reward';
  name: string;
  tagline: string;
  allocations: Allocation[];
  actions: Action[];
  totals: { investedUsd: number; baseUsd: number; incentiveUsd: number; entryCostUsd: number; exitCostUsd: number; netUsd: number; costTrx: number };
  exitConditions: string[];
  risks: string[];
  rationale: string[];
  warnings: string[];
  incentiveShare: number; // share of gross yield that depends on time-limited rewards
};

export type PlanSet = { plans: Plan[]; recommendedId: Plan['id']; recommendationReason: string; excluded: Array<{ name: string; reason: string }> };

export const priceUsd = (asset: Asset, fees: FeeContext) => (asset === 'TRX' ? fees.trxUsd ?? 0 : 1);

function feeFor(energy: number, fees: FeeContext) {
  const burnTrx = energy * fees.energyFeeSun / 1_000_000 + BANDWIDTH_BYTES_PER_TX * fees.bandwidthFeeSun / 1_000_000;
  const rentTrx = fees.rentTrxPer10kEnergy != null ? energy / 10_000 * fees.rentTrxPer10kEnergy : null;
  return { feeTrx: burnTrx, feeTrxIfRented: rentTrx, feeUsd: fees.trxUsd != null ? burnTrx * fees.trxUsd : null };
}

let actionSeq = 0;
function action(partial: Omit<Action, 'id' | 'feeTrx' | 'feeTrxIfRented' | 'feeUsd' | 'energyMeasured'> & { energyMeasured?: boolean }, fees: FeeContext): Action {
  actionSeq += 1;
  return { id: `a${actionSeq}`, energyMeasured: false, ...partial, ...feeFor(partial.energy, fees) };
}

const fmt = (value: number, digits = 2) => value.toLocaleString('en-US', { maximumFractionDigits: digits });
const pct = (value: number) => `${(value * 100).toFixed(2)}%`;

function supplyActions(opportunity: Opportunity, amount: number, fees: FeeContext): Action[] {
  const actions: Action[] = [];
  if (opportunity.asset !== 'TRX') {
    const measured = fees.approveEnergyMeasured;
    actions.push(action({
      kind: 'approve',
      label: `${opportunity.asset} 사용 승인 → ${opportunity.name}`,
      asset: opportunity.asset,
      amount,
      target: opportunity.contract,
      targetName: opportunity.name,
      approvalScope: `${opportunity.contract} 계약이 내 지갑에서 ${fmt(amount)} ${opportunity.asset}까지만 가져갈 수 있습니다 (무제한 승인 아님).`,
      energy: measured ?? ENERGY_ASSUMPTIONS.approveFallback,
      energyMeasured: measured != null,
      risk: '승인 범위를 넘는 금액은 이동할 수 없습니다. 사용 후 남은 승인은 0으로 되돌릴 수 있습니다.',
    }, fees));
  }
  actions.push(action({
    kind: 'supply',
    label: `${opportunity.name}: ${fmt(amount)} ${opportunity.asset} 공급`,
    asset: opportunity.asset,
    amount,
    target: opportunity.contract,
    targetName: opportunity.name,
    approvalScope: opportunity.asset === 'TRX' ? `${fmt(amount)} TRX를 계약으로 직접 보냅니다.` : '위 승인 범위 안에서만 실행됩니다.',
    energy: opportunity.asset === 'TRX' ? ENERGY_ASSUMPTIONS.supplyTrx : ENERGY_ASSUMPTIONS.supplyTrc20,
    risk: opportunity.risks[0],
  }, fees));
  return actions;
}

function allocation(key: string, opportunity: Opportunity, amount: number, days: number, fees: FeeContext): Allocation {
  const usd = amount * priceUsd(opportunity.asset, fees);
  return {
    key,
    opportunityId: opportunity.id,
    label: opportunity.name,
    asset: opportunity.asset,
    amount,
    usd,
    baseApy: opportunity.baseApy,
    incentiveApy: opportunity.incentiveApy,
    baseUsd: usd * opportunity.baseApy * days / 365,
    incentiveUsd: usd * opportunity.incentiveApy * days / 365,
    exit: opportunity.exit,
  };
}

function reserveAllocation(asset: Asset, amount: number, fees: FeeContext): Allocation {
  return {
    key: `reserve-${asset}`,
    opportunityId: 'reserve',
    label: `지갑 보유 (${asset})`,
    asset,
    amount,
    usd: amount * priceUsd(asset, fees),
    baseApy: 0,
    incentiveApy: 0,
    baseUsd: 0,
    incentiveUsd: 0,
    exit: '지갑에 그대로 있어 언제든 사용할 수 있습니다.',
  };
}

// Share kept in the wallet: JustLend supply is itself redeemable, so only a buffer against
// low market cash is kept liquid, plus whatever the user explicitly asked to keep on hand.
export function reserveShare(needs: Needs): number {
  return needs.liquidity === 'instant' ? 0.2 : needs.liquidity === 'month' ? 0.1 : 0;
}

// Share of stablecoins moved into the USDD reward market in the reward plan.
export function rewardShare(needs: Needs): number {
  return needs.risk === 'conservative' ? 0.3 : needs.risk === 'aggressive' ? 0.7 : 0.5;
}

function finalizePlan(base: Omit<Plan, 'totals' | 'incentiveShare' | 'exitConditions' | 'risks'>, opportunities: Opportunity[], fees: FeeContext, days: number): Plan {
  const invested = base.allocations.filter(item => item.opportunityId !== 'reserve');
  const baseUsd = base.allocations.reduce((sum, item) => sum + item.baseUsd, 0);
  const incentiveUsd = base.allocations.reduce((sum, item) => sum + item.incentiveUsd, 0);
  const entryTrx = base.actions.reduce((sum, item) => sum + item.feeTrx, 0);
  const exitTrx = invested.length * feeFor(ENERGY_ASSUMPTIONS.redeem, fees).feeTrx;
  const trxUsd = fees.trxUsd ?? 0;
  const entryCostUsd = entryTrx * trxUsd;
  const exitCostUsd = exitTrx * trxUsd;
  const used = new Set(invested.map(item => item.opportunityId));
  const usedOpportunities = opportunities.filter(item => used.has(item.id));
  const warnings = [...base.warnings];
  if (baseUsd + incentiveUsd < entryCostUsd + exitCostUsd) warnings.push(`${days}일 동안의 예상 수익이 진입·회수 비용보다 작습니다. 금액을 늘리거나 기간을 늘리는 편이 낫습니다.`);
  if (!fees.trxUsd) warnings.push('TRX 가격을 불러오지 못해 비용을 달러로 환산하지 못했습니다.');
  return {
    ...base,
    warnings,
    totals: {
      investedUsd: invested.reduce((sum, item) => sum + item.usd, 0),
      baseUsd,
      incentiveUsd,
      entryCostUsd,
      exitCostUsd,
      netUsd: baseUsd + incentiveUsd - entryCostUsd - exitCostUsd,
      costTrx: entryTrx + exitTrx,
    },
    incentiveShare: baseUsd + incentiveUsd > 0 ? incentiveUsd / (baseUsd + incentiveUsd) : 0,
    exitConditions: [...new Set(usedOpportunities.map(item => `${item.name}: ${item.exit}`))],
    risks: [...new Set(usedOpportunities.flatMap(item => item.risks))],
  };
}

export function buildPlans(needs: Needs, snapshot: MarketSnapshot): PlanSet {
  const days = needs.horizonDays ?? 90;
  const { fees } = snapshot;
  const byId = new Map(snapshot.opportunities.filter(item => item.usable).map(item => [item.id, item]));
  const excluded = snapshot.opportunities.filter(item => !item.usable).map(item => ({ name: item.name, reason: item.unusableReason ?? '사용 불가' }));
  const reserveRatio = reserveShare(needs);
  const plans: Plan[] = [];

  // Plan 1: base yield on each held asset in its own JustLend market.
  {
    const allocations: Allocation[] = [];
    const actions: Action[] = [];
    const rationale: string[] = [];
    const warnings: string[] = [];
    for (const holding of needs.holdings) {
      const market = byId.get(holding.asset === 'USDT' ? 'jl-usdt' : holding.asset === 'USDD' ? 'jl-usdd' : 'jl-trx');
      const reserve = Math.min(holding.amount, Math.max(holding.amount * reserveRatio, holding.asset !== 'TRX' ? needs.reserveAmount ?? 0 : 0));
      const invest = holding.amount - reserve;
      if (reserve > 0) allocations.push(reserveAllocation(holding.asset, reserve, fees));
      if (!market) { warnings.push(`${holding.asset} 공급 시장 데이터를 불러오지 못해 전액 보유로 둡니다.`); if (invest > 0) allocations.push(reserveAllocation(holding.asset, invest, fees)); continue; }
      if (invest > 0) {
        allocations.push(allocation(`core-${market.id}`, market, invest, days, fees));
        actions.push(...supplyActions(market, invest, fees));
        rationale.push(`${holding.asset}는 전환 없이 ${market.name}에 공급합니다. 현재 기본 수익률 ${pct(market.baseApy)}${market.incentiveApy > 0 ? `, 보상 ${pct(market.incentiveApy)}` : ''}.`);
      }
    }
    if (reserveRatio > 0) rationale.push(`유동성 조건(${needs.liquidity === 'instant' ? '언제든 인출' : '30일 내 사용'})에 맞춰 ${Math.round(reserveRatio * 100)}%는 지갑에 둡니다. JustLend 공급분도 시장 현금 한도 안에서 언제든 회수할 수 있습니다.`);
    plans.push(finalizePlan({ id: 'core', name: '기본 수익 중심', tagline: '자산을 바꾸지 않고 JustLend 공급 이자만 받습니다. 기간 한정 보상에 기대지 않습니다.', allocations, actions, rationale, warnings }, snapshot.opportunities, fees, days));
  }

  // Plan 2: move part of stablecoins into the USDD reward market; TRX goes to sTRX when the
  // user can wait out the unstake period.
  {
    const allocations: Allocation[] = [];
    const actions: Action[] = [];
    const rationale: string[] = [];
    const warnings: string[] = [];
    const jusdt = byId.get('jl-usdt');
    const jusdd = byId.get('jl-usdd');
    const share = rewardShare(needs);
    for (const holding of needs.holdings) {
      const reserve = Math.min(holding.amount, Math.max(holding.amount * reserveRatio, holding.asset !== 'TRX' ? needs.reserveAmount ?? 0 : 0));
      const invest = holding.amount - reserve;
      if (reserve > 0) allocations.push(reserveAllocation(holding.asset, reserve, fees));
      if (invest <= 0) continue;
      if (holding.asset === 'TRX') {
        const strx = byId.get('strx');
        const jtrx = byId.get('jl-trx');
        // sTRX has an unstake wait: all of it when the user won't touch the money, part of it
        // when some is needed within a month, none when it must be withdrawable any time.
        const stakeRatio = !strx || (needs.horizonDays ?? 0) < 30 ? 0 : needs.liquidity === 'long' ? 1 : needs.liquidity === 'month' ? share : 0;
        const toStake = invest * stakeRatio;
        const toSupply = invest - toStake;
        if (strx && toStake > 0) {
          allocations.push(allocation('reward-strx', strx, toStake, days, fees));
          actions.push(action({ kind: 'stake', label: `sTRX 스테이킹: ${fmt(toStake)} TRX`, asset: 'TRX', amount: toStake, target: MAINNET.sTRX, targetName: strx.name, approvalScope: `${fmt(toStake)} TRX를 sTRX 계약으로 보냅니다.`, energy: ENERGY_ASSUMPTIONS.stakeTrx, risk: strx.risks[1] }, fees));
          rationale.push(`TRX ${Math.round(stakeRatio * 100)}%는 sTRX 스테이킹(${pct(strx.baseApy)})에 둡니다. 회수에 대기 기간이 있어 ${needs.liquidity === 'long' ? '당분간 쓰지 않는 자금' : '당장 쓰지 않을 부분'}만 넣습니다.`);
        }
        if (toSupply > 0) {
          if (!jtrx) { allocations.push(reserveAllocation('TRX', toSupply, fees)); continue; }
          allocations.push(allocation('reward-jl-trx', jtrx, toSupply, days, fees));
          actions.push(...supplyActions(jtrx, toSupply, fees));
          rationale.push(`즉시 회수가 필요할 수 있는 TRX는 JustLend TRX 공급(${pct(jtrx.baseApy)})에 둡니다.`);
        }
        if (stakeRatio === 0 && needs.holdings.every(item => item.asset === 'TRX')) warnings.push('유동성·기간 조건 때문에 sTRX를 쓸 수 없어 이 계획이 기본 수익 중심과 같아졌습니다.');
        continue;
      }
      if (!jusdd || !jusdt) { warnings.push('스테이블코인 시장 데이터가 부족해 이 계획을 완성하지 못했습니다.'); allocations.push(reserveAllocation(holding.asset, invest, fees)); continue; }
      const toReward = holding.asset === 'USDD' ? invest : invest * share;
      const toBase = invest - toReward;
      if (holding.asset === 'USDT' && toReward > 0) {
        const psmFee = fees.psmFeeIn;
        if (psmFee == null) warnings.push('USDD PSM 수수료를 확인하지 못했습니다. 실행 전 다시 조회해야 합니다.');
        actions.push(action({ kind: 'approve', label: `USDT 사용 승인 → USDD PSM`, asset: 'USDT', amount: toReward, target: MAINNET.usddPsm, targetName: 'USDD PSM (USDT→USDD)', approvalScope: `USDD PSM이 ${fmt(toReward)} USDT까지만 가져갈 수 있습니다.`, energy: fees.approveEnergyMeasured ?? ENERGY_ASSUMPTIONS.approveFallback, energyMeasured: fees.approveEnergyMeasured != null, risk: '승인 범위를 넘는 금액은 이동할 수 없습니다.' }, fees));
        actions.push(action({ kind: 'psm-swap', label: `USDD PSM: ${fmt(toReward)} USDT → USDD`, asset: 'USDT', amount: toReward, target: MAINNET.usddPsm, targetName: 'USDD PSM', approvalScope: `교환 수수료 ${psmFee != null ? pct(psmFee) : '미확인'} (USDD 공시값).`, energy: ENERGY_ASSUMPTIONS.psmSwap, risk: 'USDD로 바꾸면 USDD 디페그 위험을 지게 됩니다. 되돌릴 때 PSM 역교환 수수료를 다시 확인해야 합니다.' }, fees));
        rationale.push(`USDT ${Math.round(share * 100)}%를 USDD PSM(수수료 ${psmFee != null ? pct(psmFee) : '미확인'})으로 USDD로 바꿔 JustLend USDD 시장의 채굴 보상(${pct(jusdd.incentiveApy)})을 받습니다. 비율은 위험 성향에 따라 정했습니다.`);
      }
      const rewardAmount = toReward * (1 - (holding.asset === 'USDT' ? fees.psmFeeIn ?? 0 : 0));
      if (rewardAmount > 0) {
        allocations.push(allocation(`reward-jl-usdd-${holding.asset}`, jusdd, rewardAmount, days, fees));
        actions.push(...supplyActions(jusdd, rewardAmount, fees));
      }
      if (toBase > 0) {
        allocations.push(allocation(`reward-jl-usdt`, jusdt, toBase, days, fees));
        actions.push(...supplyActions(jusdt, toBase, fees));
        rationale.push(`나머지 USDT는 기본 수익률이 높은 JustLend USDT 공급(${pct(jusdt.baseApy)})에 둡니다.`);
      }
    }
    if (jusdd && jusdd.incentiveApy > 0) warnings.push(`이 계획 수익의 상당 부분이 기간 한정 USDD 채굴 보상(${pct(jusdd.incentiveApy)})입니다. 보상이 끝나면 USDD 공급의 기본 수익률은 ${pct(jusdd.baseApy)}입니다.`);
    plans.push(finalizePlan({ id: 'reward', name: '보상 포함 수익형', tagline: 'USDD 채굴 보상과 스테이킹을 더해 수익을 높입니다. 보상 종료·디페그·회수 대기 위험을 함께 집니다.', allocations, actions, rationale, warnings }, snapshot.opportunities, fees, days));
  }

  // Recommendation: conservative users avoid plans whose yield depends mostly on rewards.
  const [core, reward] = plans;
  let recommendedId: Plan['id'] = reward.totals.netUsd > core.totals.netUsd ? 'reward' : 'core';
  let recommendationReason = recommendedId === 'reward'
    ? `예상 순수익이 ${fmt(reward.totals.netUsd - core.totals.netUsd)} USD 더 높습니다.`
    : `예상 순수익이 같거나 더 높고 구조가 단순합니다.`;
  if (needs.risk === 'conservative' && reward.incentiveShare > 0.5) {
    recommendedId = 'core';
    recommendationReason = `안정형을 선택하셨고, 보상 포함 수익형은 수익의 ${Math.round(reward.incentiveShare * 100)}%가 기간 한정 보상이라 기본 수익 중심을 추천합니다.`;
  }
  return { plans, recommendedId, recommendationReason, excluded };
}
