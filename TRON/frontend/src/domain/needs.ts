import type { Asset } from '../data/sources';

export type Liquidity = 'instant' | 'month' | 'long';
export type Risk = 'conservative' | 'balanced' | 'aggressive';
export type Holding = { asset: Asset; amount: number };

export type Needs = {
  holdings: Holding[];
  horizonDays?: number;
  liquidity?: Liquidity;
  reserveAmount?: number; // amount the user said must stay withdrawable
  risk?: Risk;
};

export type NeedField = 'holdings' | 'horizonDays' | 'liquidity' | 'risk';

export const liquidityLabel: Record<Liquidity, string> = {
  instant: '언제든 인출 필요',
  month: '30일 안에 일부 사용',
  long: '장기 보유 (당분간 안 씀)',
};

export const riskLabel: Record<Risk, string> = {
  conservative: '안정형 (원금 보전 우선)',
  balanced: '균형형',
  aggressive: '적극형 (변동 감수)',
};

const assetAliases: Array<[RegExp, Asset]> = [
  [/usdt|테더/i, 'USDT'],
  [/usdd/i, 'USDD'],
  [/trx|트론/i, 'TRX'],
];

const toAsset = (word: string): Asset | undefined => assetAliases.find(([pattern]) => pattern.test(word))?.[1];

// "5,000", "1.5만", "3천" -> number
export function parseKoreanNumber(raw: string, unit?: string): number {
  const base = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(base)) return NaN;
  if (unit === '만') return base * 10_000;
  if (unit === '천') return base * 1_000;
  if (unit === '백') return base * 100;
  return base;
}

const ASSET = '(usdt|usdd|trx|테더|트론)';
const NUMBER = '(\\d[\\d,]*(?:\\.\\d+)?)\\s*(만|천|백)?';

export function extractHoldings(text: string): Holding[] {
  const found = new Map<Asset, number>();
  const patterns = [
    new RegExp(`${NUMBER}\\s*(?:개|달러|불)?\\s*(?:어치)?\\s*(?:의|짜리)?\\s*${ASSET}`, 'gi'),
    new RegExp(`${ASSET}\\s*(?:를|을|가|이|는|은)?\\s*${NUMBER}`, 'gi'),
  ];
  for (const [index, pattern] of patterns.entries()) {
    for (const match of text.matchAll(pattern)) {
      const [raw, unit, word] = index === 0 ? [match[1], match[2], match[3]] : [match[2], match[3], match[1]];
      const asset = toAsset(word);
      const amount = parseKoreanNumber(raw, unit);
      if (asset && amount > 0 && !found.has(asset)) found.set(asset, amount);
    }
  }
  return [...found].map(([asset, amount]) => ({ asset, amount }));
}

export function extractHorizonDays(text: string): number | undefined {
  if (/반\s*년/.test(text)) return 182;
  const match = text.match(/(\d+(?:\.\d+)?)\s*(일|주|개월|달|년)/);
  if (!match) {
    if (/한\s*달/.test(text) && /(기간|동안|운용|굴|맡)/.test(text)) return 30;
    return undefined;
  }
  const value = Number(match[1]);
  const factor = { 일: 1, 주: 7, 개월: 30, 달: 30, 년: 365 }[match[2] as '일'];
  return Math.round(value * factor);
}

export function extractLiquidity(text: string): Liquidity | undefined {
  if (/(언제든|수시로|바로\s*(빼|꺼|써|인출)|급하게|비상금)/.test(text)) return 'instant';
  if (/(한\s*달|30\s*일|다음\s*달|이번\s*달).{0,12}(쓸|필요|빼|인출|사용)/.test(text)) return 'month';
  if (/(장기|안\s*쓸|쓸\s*일\s*없|묵혀|필요\s*없|건드리지)/.test(text)) return 'long';
  return undefined;
}

export function extractReserve(text: string): number | undefined {
  const match = text.match(new RegExp(`${NUMBER}\\s*(?:개|달러|불)?\\s*(?:${ASSET})?\\s*(?:정도|쯤)?\\s*(?:은|는)\\s*(?:언제든|바로|항상|비상)`, 'i'));
  return match ? parseKoreanNumber(match[1], match[2]) : undefined;
}

export function extractRisk(text: string): Risk | undefined {
  if (/(공격|적극|높은\s*수익|위험\s*감수|변동.{0,8}괜찮)/.test(text)) return 'aggressive';
  if (/(안정|안전|원금|잃으면\s*안|보수|손실.{0,4}싫)/.test(text)) return 'conservative';
  if (/(균형|적당|중간|무난)/.test(text)) return 'balanced';
  return undefined;
}

// Merge newly extracted facts into what we already know; explicit new answers win.
export function mergeNeeds(current: Needs, text: string): { needs: Needs; captured: NeedField[] } {
  const next: Needs = { ...current, holdings: [...current.holdings] };
  const captured: NeedField[] = [];
  const holdings = extractHoldings(text);
  if (holdings.length) {
    for (const holding of holdings) {
      const index = next.holdings.findIndex(item => item.asset === holding.asset);
      if (index >= 0) next.holdings[index] = holding; else next.holdings.push(holding);
    }
    captured.push('holdings');
  }
  const horizon = extractHorizonDays(text);
  if (horizon) { next.horizonDays = horizon; captured.push('horizonDays'); }
  const liquidity = extractLiquidity(text);
  if (liquidity) { next.liquidity = liquidity; captured.push('liquidity'); }
  const reserve = extractReserve(text);
  if (reserve) next.reserveAmount = reserve;
  const risk = extractRisk(text);
  if (risk) { next.risk = risk; captured.push('risk'); }
  return { needs: next, captured };
}

export function missingFields(needs: Needs): NeedField[] {
  const missing: NeedField[] = [];
  if (!needs.holdings.length) missing.push('holdings');
  if (!needs.horizonDays) missing.push('horizonDays');
  if (!needs.liquidity) missing.push('liquidity');
  if (!needs.risk) missing.push('risk');
  return missing;
}

export const followUpQuestion: Record<NeedField, string> = {
  holdings: '어떤 자산을 얼마나 운용하실 건가요? 예: "USDT 5,000개", "TRX 2만 개"',
  horizonDays: '얼마 동안 운용할 계획인가요? 예: "3개월", "1년"',
  liquidity: '운용 기간 중에 돈을 꺼내 쓸 일이 있나요? 예: "언제든 뺄 수 있어야 해", "한 달 안에 일부 쓸 거야", "당분간 안 써"',
  risk: '수익과 안정성 중 무엇이 더 중요한가요? 예: "원금이 중요해", "적당히", "변동 있어도 괜찮아"',
};

export function formatNeedsSummary(needs: Needs): string[] {
  const lines: string[] = [];
  if (needs.holdings.length) lines.push(`보유 자산: ${needs.holdings.map(item => `${item.amount.toLocaleString('en-US')} ${item.asset}`).join(', ')}`);
  if (needs.horizonDays) lines.push(`운용 기간: ${needs.horizonDays}일`);
  if (needs.liquidity) lines.push(`유동성: ${liquidityLabel[needs.liquidity]}${needs.reserveAmount ? ` · 항상 ${needs.reserveAmount.toLocaleString('en-US')} 확보` : ''}`);
  if (needs.risk) lines.push(`위험 성향: ${riskLabel[needs.risk]}`);
  return lines;
}

// Validates a model-proposed Needs object; anything unexpected is dropped rather than trusted.
export function sanitizeModelNeeds(value: unknown): Partial<Needs> {
  if (!value || typeof value !== 'object') return {};
  const record = value as Record<string, unknown>;
  const result: Partial<Needs> = {};
  if (Array.isArray(record.holdings)) {
    const holdings = record.holdings.flatMap(item => {
      if (!item || typeof item !== 'object') return [];
      const { asset, amount } = item as Record<string, unknown>;
      const parsedAsset = typeof asset === 'string' ? toAsset(asset) : undefined;
      const parsedAmount = Number(amount);
      return parsedAsset && Number.isFinite(parsedAmount) && parsedAmount > 0 ? [{ asset: parsedAsset, amount: parsedAmount }] : [];
    });
    if (holdings.length) result.holdings = holdings;
  }
  const days = Number(record.horizonDays);
  if (Number.isInteger(days) && days > 0 && days <= 3650) result.horizonDays = days;
  if (record.liquidity === 'instant' || record.liquidity === 'month' || record.liquidity === 'long') result.liquidity = record.liquidity;
  if (record.risk === 'conservative' || record.risk === 'balanced' || record.risk === 'aggressive') result.risk = record.risk;
  const reserve = Number(record.reserveAmount);
  if (Number.isFinite(reserve) && reserve > 0) result.reserveAmount = reserve;
  return result;
}

// Fill only the gaps the rule parser left; rule-parsed facts from the user's words take precedence.
export function fillGaps(needs: Needs, model: Partial<Needs>): { needs: Needs; filled: NeedField[] } {
  const next: Needs = { ...needs, holdings: [...needs.holdings] };
  const filled: NeedField[] = [];
  if (!next.holdings.length && model.holdings?.length) { next.holdings = model.holdings; filled.push('holdings'); }
  if (!next.horizonDays && model.horizonDays) { next.horizonDays = model.horizonDays; filled.push('horizonDays'); }
  if (!next.liquidity && model.liquidity) { next.liquidity = model.liquidity; filled.push('liquidity'); }
  if (!next.risk && model.risk) { next.risk = model.risk; filled.push('risk'); }
  if (!next.reserveAmount && model.reserveAmount) next.reserveAmount = model.reserveAmount;
  return { needs: next, filled };
}
