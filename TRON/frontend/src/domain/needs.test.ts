import { describe, expect, it } from 'vitest';
import { extractHoldings, extractHorizonDays, extractLiquidity, extractReserve, extractRisk, fillGaps, mergeNeeds, missingFields, sanitizeModelNeeds } from './needs';

describe('needs parsing', () => {
  it('reads holdings in both word orders and Korean units', () => {
    expect(extractHoldings('USDT 5,000개 있어')).toEqual([{ asset: 'USDT', amount: 5000 }]);
    expect(extractHoldings('트론 2만 개랑 1000 USDD')).toEqual([{ asset: 'USDD', amount: 1000 }, { asset: 'TRX', amount: 20000 }]);
  });

  it('reads horizon, liquidity, reserve and risk', () => {
    expect(extractHorizonDays('6개월 정도 굴리고 싶어')).toBe(180);
    expect(extractHorizonDays('반년')).toBe(182);
    expect(extractLiquidity('한 달 안에 일부 쓸 수도 있어')).toBe('month');
    expect(extractLiquidity('언제든 뺄 수 있어야 해')).toBe('instant');
    expect(extractReserve('1000개는 언제든 뺄 수 있어야 해')).toBe(1000);
    expect(extractRisk('원금이 제일 중요해')).toBe('conservative');
    expect(extractRisk('변동 있어도 괜찮아')).toBe('aggressive');
  });

  it('asks only for what is still missing', () => {
    const { needs } = mergeNeeds({ holdings: [] }, 'USDT 5000개를 3개월 운용하고 싶어');
    expect(missingFields(needs)).toEqual(['liquidity', 'risk']);
  });

  it('never lets model output override what the user said, and drops invalid fields', () => {
    const model = sanitizeModelNeeds({ holdings: [{ asset: 'USDT', amount: 999 }], horizonDays: 9999, risk: 'aggressive', liquidity: 'weekly' });
    expect(model).toEqual({ holdings: [{ asset: 'USDT', amount: 999 }], risk: 'aggressive' });
    const { needs, filled } = fillGaps({ holdings: [{ asset: 'USDT', amount: 5000 }] }, model);
    expect(needs.holdings).toEqual([{ asset: 'USDT', amount: 5000 }]);
    expect(filled).toEqual(['risk']);
  });
});
