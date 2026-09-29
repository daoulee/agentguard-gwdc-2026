import { describe, expect, it } from 'vitest';
import { base58ToHex20 } from '../chain/tronlink';
import { createRecord, proposeAdjustments, reviewRecord } from './journal';
import { buildPlans } from './plans';
import { snapshot } from './plans.test';

const needs = { holdings: [{ asset: 'USDT' as const, amount: 5000 }], horizonDays: 180, liquidity: 'month' as const, risk: 'balanced' as const };

describe('journal review and monitoring', () => {
  it('records the rate assumptions and compares expected vs replay', () => {
    const plan = buildPlans(needs, snapshot).plans[1];
    const record = createRecord(needs, plan, snapshot);
    expect(record.assumptions.map(item => item.opportunityId).sort()).toEqual(['jl-usdd', 'jl-usdt']);
    const same = reviewRecord(record, snapshot, 30);
    expect(same.driftUsd).toBeCloseTo(0, 8);

    const rewardCut = { ...snapshot, opportunities: snapshot.opportunities.map(item => item.id === 'jl-usdd' ? { ...item, incentiveApy: 0.01 } : item) };
    const review = reviewRecord(record, rewardCut, 30);
    expect(review.driftUsd).toBeLessThan(0);
    const proposals = proposeAdjustments(record, rewardCut, needs, 150);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].reason).toContain('4.03%에서 1.00%로');
  });

  it('proposes moving USDD back to USDT supply when money must become withdrawable any time', () => {
    const plan = buildPlans(needs, snapshot).plans[1];
    const record = createRecord(needs, plan, snapshot);
    expect(proposeAdjustments(record, snapshot, needs, 150)).toHaveLength(0);
    const proposals = proposeAdjustments(record, snapshot, { ...needs, liquidity: 'instant' }, 150);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].to).toContain('JustLend USDT');
    expect(proposals[0].reason).toContain('언제든 인출');
  });

  it('proposes leaving sTRX when liquidity needs change', () => {
    const trxNeeds = { holdings: [{ asset: 'TRX' as const, amount: 20000 }], horizonDays: 365, liquidity: 'long' as const, risk: 'aggressive' as const };
    const record = createRecord(trxNeeds, buildPlans(trxNeeds, snapshot).plans[1], snapshot);
    expect(proposeAdjustments(record, snapshot, trxNeeds, 300)).toHaveLength(0);
    expect(proposeAdjustments(record, snapshot, { ...trxNeeds, liquidity: 'instant' }, 300)[0].to).toContain('JustLend TRX');
  });

  it('decodes TRON base58 addresses', () => {
    expect(base58ToHex20('TXJgMdjVX5dKiQaUi9QobwNxtSQaFqccvd')).toBe('ea09611b57e89d67fbb33a516eb90508ca95a3e5');
  });
});
