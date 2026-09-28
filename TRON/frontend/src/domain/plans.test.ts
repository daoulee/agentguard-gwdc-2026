import { describe, expect, it } from 'vitest';
import { buildJustLendOpportunities, buildStrxOpportunity, buildUsddOpportunity, type MarketSnapshot } from '../data/sources';
import { buildPlans } from './plans';

const at = '2026-09-28T14:30:00.000Z';
// Values mirror the live responses fetched on 2026-09-28.
export const snapshot: MarketSnapshot = {
  fetchedAt: at,
  errors: [],
  opportunities: [
    ...buildJustLendOpportunities([
      { address: 'TXJgMdjVX5dKiQaUi9QobwNxtSQaFqccvd', symbol: 'jUSDT', underlyingSymbol: 'USDT', supplyRate: '0.022284828474912', cash: '79183720.88', totalBorrows: '0', underlyingPriceInTrx: '2.994129' },
      { address: 'TKFRELGGoRgiayhwJTNNLqCNjFoLBh3Mnf', symbol: 'jUSDD', underlyingSymbol: 'USDD', supplyRate: '0.000008595536256', cash: '395338989.38', totalBorrows: '0', underlyingPriceInTrx: '2.994129' },
      { address: 'TE2RzoSV3wFK99w6J9UnnZ4vLfXYoxvRwP', symbol: 'jTRX', underlyingSymbol: 'TRX', supplyRate: '0.003156586869168', cash: '2062622807.62', totalBorrows: '0', underlyingPriceInTrx: '1' },
    ], { TKFRELGGoRgiayhwJTNNLqCNjFoLBh3Mnf: { USDD: '0.04031659' } }, at),
    buildStrxOpportunity({ stakeInfo: { supplyRate: '0.05024973', trxPrice: '0.3346', exchangeRate: '1.3176', totalUnderlying: '1' }, rentInfo: { priceFor10KEnergByRent: '0.58894116', priceFor10KEnergByBurn: '1' } }, at),
    buildUsddOpportunity({ apy: 0.04, items: [] }, at),
  ],
  fees: { energyFeeSun: 100, bandwidthFeeSun: 1000, rentTrxPer10kEnergy: 0.58894116, burnTrxPer10kEnergy: 1, trxUsd: 0.3346, approveEnergyMeasured: 99_764, approveEnergyMeasuredAt: at, psmFeeIn: 0, sources: [], fetchedAt: at },
};

describe('buildPlans', () => {
  it('builds two plans with base yield and incentive rewards kept separate', () => {
    const set = buildPlans({ holdings: [{ asset: 'USDT', amount: 5000 }], horizonDays: 180, liquidity: 'month', risk: 'balanced' }, snapshot);
    expect(set.plans.map(plan => plan.id)).toEqual(['core', 'reward']);
    const [core, reward] = set.plans;
    expect(core.totals.incentiveUsd).toBe(0);
    expect(core.allocations.find(item => item.opportunityId === 'reserve')?.amount).toBe(500);
    expect(reward.totals.incentiveUsd).toBeGreaterThan(0);
    expect(reward.actions.map(item => item.kind)).toEqual(['approve', 'psm-swap', 'approve', 'supply', 'approve', 'supply']);
    // Approvals are scoped to the exact amount, never unlimited.
    expect(reward.actions[0].approvalScope).toContain('2,250 USDT');
    expect(set.excluded[0].name).toContain('USDD 프로토콜');
  });

  it('keeps conservative users away from reward-dependent plans', () => {
    const set = buildPlans({ holdings: [{ asset: 'USDD', amount: 5000 }], horizonDays: 180, liquidity: 'long', risk: 'conservative' }, snapshot);
    expect(set.plans[1].incentiveShare).toBeGreaterThan(0.5);
    expect(set.recommendedId).toBe('core');
  });

  it('never puts money that may be needed soon into sTRX', () => {
    const instant = buildPlans({ holdings: [{ asset: 'TRX', amount: 20000 }], horizonDays: 90, liquidity: 'instant', risk: 'aggressive' }, snapshot);
    expect(instant.plans[1].allocations.some(item => item.opportunityId === 'strx')).toBe(false);
    const long = buildPlans({ holdings: [{ asset: 'TRX', amount: 20000 }], horizonDays: 365, liquidity: 'long', risk: 'aggressive' }, snapshot);
    expect(long.plans[1].allocations.find(item => item.opportunityId === 'strx')?.amount).toBe(20000);
  });

  it('warns when costs exceed yield on tiny amounts', () => {
    const set = buildPlans({ holdings: [{ asset: 'USDT', amount: 20 }], horizonDays: 7, liquidity: 'long', risk: 'balanced' }, snapshot);
    expect(set.plans[0].warnings.join(' ')).toContain('비용보다 작습니다');
  });
});
