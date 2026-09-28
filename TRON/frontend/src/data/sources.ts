// Live TRON ecosystem data. Every value carries its source URL and fetch time so the UI can
// show provenance, and every fetch can fail independently without inventing numbers.

export type Asset = 'USDT' | 'USDD' | 'TRX';

export type SourceRef = { label: string; url: string };

export type Opportunity = {
  id: 'jl-usdt' | 'jl-usdd' | 'jl-trx' | 'strx' | 'usdd-protocol';
  project: 'JustLend' | 'USDD';
  name: string;
  asset: Asset;
  contract: string;
  baseApy: number; // decimal, e.g. 0.0223
  incentiveApy: number; // decimal, separate from base
  incentiveToken?: string;
  incentiveTerms?: string;
  exit: string;
  liquidity?: { available: number; unit: string };
  risks: string[];
  terms: string[];
  sources: SourceRef[];
  fetchedAt: string;
  // Only verified opportunities are used in plans; others are shown with the reason.
  usable: boolean;
  unusableReason?: string;
};

export type FeeContext = {
  energyFeeSun: number; // sun burned per energy unit
  bandwidthFeeSun: number; // sun per byte
  rentTrxPer10kEnergy: number | null; // JustLend energy rental price
  burnTrxPer10kEnergy: number;
  trxUsd: number | null;
  approveEnergyMeasured: number | null; // live triggerconstantcontract estimate for USDT approve
  approveEnergyMeasuredAt: string | null;
  psmFeeIn: number | null; // USDT -> USDD PSM fee (decimal)
  sources: SourceRef[];
  fetchedAt: string;
};

export type MarketSnapshot = {
  opportunities: Opportunity[];
  fees: FeeContext;
  errors: string[];
  fetchedAt: string;
};

export const ENDPOINTS = {
  jtoken: 'https://openapi.just.network/lend/jtoken',
  mining: 'https://openapi.just.network/mining/apy',
  strx: 'https://openapi.just.network/lend/strx',
  usddTron: 'https://app-api.usdd.io/data-platform/latest-collateral?chain=tron',
  chainParams: 'https://api.trongrid.io/wallet/getchainparameters',
  constantCall: 'https://api.trongrid.io/wallet/triggerconstantcontract',
} as const;

// Mainnet addresses (JustLend OpenAPI / USDD chain config).
export const MAINNET = {
  jUSDT: 'TXJgMdjVX5dKiQaUi9QobwNxtSQaFqccvd',
  jUSDD: 'TKFRELGGoRgiayhwJTNNLqCNjFoLBh3Mnf',
  jTRX: 'TE2RzoSV3wFK99w6J9UnnZ4vLfXYoxvRwP',
  sTRX: 'TU3kjFuhtEo42tsCBtfYUAZxoqQ4yuSLQ5',
  USDT: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  USDD: 'TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz',
  usddPsm: 'TBXW4hS5KYjjbJXDpnrPf4zhkLwrpUjbyz',
} as const;

export const STALE_AFTER_MS = 10 * 60 * 1000;

type Envelope<T> = { code: number; message?: string; data: T };
type JToken = {
  address: string; symbol: string; underlyingSymbol: string; supplyRate: string;
  cash: string; totalBorrows: string; underlyingPriceInTrx: string;
};

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
};

async function getJson<T>(url: string, init?: RequestInit, timeoutMs = 12_000): Promise<T> {
  // Keyless TronGrid rate-limits bursts with 429; retry once after a short pause.
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (response.status === 429 && attempt === 0) { await new Promise(resolve => setTimeout(resolve, 1_200)); continue; }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json() as Promise<T>;
  }
}

async function getEnvelope<T>(url: string): Promise<T> {
  const body = await getJson<Envelope<T>>(url);
  if (body.code !== 0) throw new Error(body.message ?? 'API error');
  return body.data;
}

const justLendSource: SourceRef = { label: 'JustLend OpenAPI /lend/jtoken', url: ENDPOINTS.jtoken };
const miningSource: SourceRef = { label: 'JustLend OpenAPI /mining/apy', url: ENDPOINTS.mining };
const strxSource: SourceRef = { label: 'JustLend OpenAPI /lend/strx', url: ENDPOINTS.strx };
const usddSource: SourceRef = { label: 'USDD data-platform (chain=tron)', url: ENDPOINTS.usddTron };

export function buildJustLendOpportunities(tokens: JToken[], mining: Record<string, { USDD?: string }>, fetchedAt: string): Opportunity[] {
  const bySymbol = new Map(tokens.map(token => [token.symbol, token]));
  const common = [
    '스마트 컨트랙트 위험: 공급 자산은 JustLend 계약에 예치됩니다.',
    '변동 금리: 기본 수익률은 시장 이용률에 따라 수시로 바뀝니다.',
  ];
  const specs = [
    { id: 'jl-usdt' as const, symbol: 'jUSDT', asset: 'USDT' as const, name: 'JustLend USDT 공급', contract: MAINNET.jUSDT },
    { id: 'jl-usdd' as const, symbol: 'jUSDD', asset: 'USDD' as const, name: 'JustLend USDD 공급', contract: MAINNET.jUSDD },
    { id: 'jl-trx' as const, symbol: 'jTRX', asset: 'TRX' as const, name: 'JustLend TRX 공급', contract: MAINNET.jTRX },
  ];
  return specs.flatMap(spec => {
    const token = bySymbol.get(spec.symbol);
    if (!token) return [];
    const baseApy = num(token.supplyRate);
    const incentiveApy = num(mining[token.address]?.USDD ?? 0);
    const cash = num(token.cash);
    const risks = [...common];
    if (spec.asset === 'USDD') risks.push('USDD 가격이 1달러에서 벗어날(디페그) 위험이 있습니다.');
    if (spec.asset === 'TRX') risks.push('TRX 가격 변동에 그대로 노출됩니다.');
    if (incentiveApy > 0) risks.push('USDD 채굴 보상은 기간 한정이며 예고 후 줄거나 종료될 수 있습니다.');
    return [{
      id: spec.id,
      project: 'JustLend' as const,
      name: spec.name,
      asset: spec.asset,
      contract: token.address,
      baseApy: Number.isFinite(baseApy) ? baseApy : 0,
      incentiveApy: Number.isFinite(incentiveApy) ? incentiveApy : 0,
      incentiveToken: incentiveApy > 0 ? 'USDD' : undefined,
      incentiveTerms: incentiveApy > 0 ? 'JustLend USDD 공급 채굴 보상. 단계(phase)별로 지급되며 보상률과 종료 시점은 JustLend 공지로 확인해야 합니다.' : undefined,
      exit: `언제든 회수(redeem) 가능. 단 시장에 남은 현금 한도 안에서만 즉시 회수됩니다 (현재 ${Math.round(cash).toLocaleString('en-US')} ${spec.asset}).`,
      liquidity: Number.isFinite(cash) ? { available: cash, unit: spec.asset } : undefined,
      risks,
      terms: [
        `${spec.symbol} 계약에 ${spec.asset}를 공급하고 이자가 붙는 ${spec.symbol}을 받습니다.`,
        spec.asset === 'TRX' ? 'TRX는 승인(approve) 없이 바로 공급합니다.' : `공급 전 ${spec.symbol} 계약에 ${spec.asset} 사용 승인(approve)이 1회 필요합니다.`,
      ],
      sources: incentiveApy > 0 ? [justLendSource, miningSource] : [justLendSource],
      fetchedAt,
      usable: Number.isFinite(baseApy),
      unusableReason: Number.isFinite(baseApy) ? undefined : '수익률 값을 해석할 수 없습니다.',
    }];
  });
}

type StrxData = {
  stakeInfo: { supplyRate: string; trxPrice: string; exchangeRate: string; totalUnderlying: string };
  rentInfo: { priceFor10KEnergByRent: string; priceFor10KEnergByBurn: string };
};

export function buildStrxOpportunity(data: StrxData, fetchedAt: string): Opportunity {
  const apy = num(data.stakeInfo.supplyRate);
  return {
    id: 'strx',
    project: 'JustLend',
    name: 'JustLend sTRX 스테이킹',
    asset: 'TRX',
    contract: MAINNET.sTRX,
    baseApy: Number.isFinite(apy) ? apy : 0,
    incentiveApy: 0,
    exit: '언스테이크 후 대기 기간이 지나야 TRX로 돌아옵니다. 대기 기간은 JustLend sTRX 화면에서 확인해야 합니다 (즉시 회수 아님).',
    risks: [
      'TRX 가격 변동에 그대로 노출됩니다.',
      '회수에 대기 기간이 있어 급하게 필요한 자금에는 맞지 않습니다.',
      '스테이킹 보상률은 네트워크 보상과 에너지 대여 수요에 따라 변합니다.',
    ],
    terms: ['TRX를 스테이킹하고 sTRX를 받습니다. sTRX 1개의 TRX 가치가 시간이 지나며 늘어납니다.'],
    sources: [strxSource],
    fetchedAt,
    usable: Number.isFinite(apy),
  };
}

type UsddTron = { apy: number | null; items: Array<{ vaultType: string; psmFee: string | null; contractAddress: string }> };

export function buildUsddOpportunity(data: UsddTron, fetchedAt: string): Opportunity {
  const apy = num(data.apy);
  return {
    id: 'usdd-protocol',
    project: 'USDD',
    name: 'USDD 프로토콜 공시 수익률 (TRON)',
    asset: 'USDD',
    contract: MAINNET.USDD,
    baseApy: Number.isFinite(apy) ? apy : 0,
    incentiveApy: 0,
    exit: '참여 경로와 회수 조건이 API에 없어 확인되지 않았습니다.',
    risks: ['USDD 디페그 위험', '참여 경로 미확인'],
    terms: ['USDD 공식 데이터 플랫폼의 TRON 체인 apy 값입니다. 어떤 상품에 참여해야 이 수익을 받는지는 API가 알려주지 않습니다.'],
    sources: [usddSource],
    fetchedAt,
    // Shown for transparency, but not allocated to until the participation route is verified.
    usable: false,
    unusableReason: '참여 경로·회수 조건을 API로 확인할 수 없어 계획에 넣지 않습니다.',
  };
}

const APPROVE_CACHE_KEY = 'tron-yield-approve-energy';

// Keyless TronGrid often rate-limits constant calls; fall back to the last measurement we saw.
async function measureApproveEnergyCached(): Promise<{ value: number; at: string } | null> {
  try {
    const value = await measureApproveEnergy();
    if (value == null) return null;
    const entry = { value, at: new Date().toISOString() };
    try { localStorage.setItem(APPROVE_CACHE_KEY, JSON.stringify(entry)); } catch { /* storage unavailable */ }
    return entry;
  } catch (error) {
    try {
      const cached = JSON.parse(localStorage.getItem(APPROVE_CACHE_KEY) ?? 'null') as { value: number; at: string } | null;
      if (cached && Number.isFinite(cached.value)) return cached;
    } catch { /* ignore */ }
    throw error;
  }
}

async function measureApproveEnergy(): Promise<number | null> {
  // approve(jUSDT, amount) needs no balance, so a constant call returns a live energy estimate.
  const spender = '000000000000000000000000ea09611b57e89d67fbb33a516eb90508ca95a3e5'; // jUSDT hex
  const amount = '00000000000000000000000000000000000000000000000000000000004c4b40'; // 5 USDT
  const body = await getJson<{ energy_used?: number; result?: { result?: boolean } }>(ENDPOINTS.constantCall, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      owner_address: 'TZ7ZwYbcmrip3szkkb2TSJtGZ54TWxMKtB',
      contract_address: MAINNET.USDT,
      function_selector: 'approve(address,uint256)',
      parameter: spender + amount,
      visible: true,
    }),
  });
  return body.result?.result && typeof body.energy_used === 'number' ? body.energy_used : null;
}

export async function fetchMarketSnapshot(): Promise<MarketSnapshot> {
  const fetchedAt = new Date().toISOString();
  const errors: string[] = [];
  const settle = async <T,>(label: string, task: () => Promise<T>): Promise<T | null> => {
    try { return await task(); } catch (error) {
      errors.push(`${label}: ${error instanceof Error ? error.message : '조회 실패'}`);
      return null;
    }
  };

  const [jtoken, mining, strx, usdd, params, approveEnergy] = await Promise.all([
    settle('JustLend 시장', () => getEnvelope<{ tokenList: JToken[] }>(ENDPOINTS.jtoken)),
    settle('JustLend 채굴 보상', () => getEnvelope<Record<string, { USDD?: string }>>(ENDPOINTS.mining)),
    settle('JustLend sTRX', () => getEnvelope<StrxData>(ENDPOINTS.strx)),
    settle('USDD TRON', () => getEnvelope<UsddTron>(ENDPOINTS.usddTron)),
    settle('TRON 체인 파라미터', () => getJson<{ chainParameter: Array<{ key: string; value?: number }> }>(ENDPOINTS.chainParams, { method: 'POST' })),
    settle('approve 에너지 측정', measureApproveEnergyCached),
  ]);

  const opportunities: Opportunity[] = [];
  if (jtoken) {
    if (!mining) errors.push('채굴 보상을 불러오지 못해 인센티브를 0으로 표시합니다.');
    opportunities.push(...buildJustLendOpportunities(jtoken.tokenList, mining ?? {}, fetchedAt));
  }
  if (strx) opportunities.push(buildStrxOpportunity(strx, fetchedAt));
  if (usdd) opportunities.push(buildUsddOpportunity(usdd, fetchedAt));

  const param = (key: string) => params?.chainParameter.find(item => item.key === key)?.value;
  const usdtPriceInTrx = num(jtoken?.tokenList.find(token => token.symbol === 'jUSDT')?.underlyingPriceInTrx);
  const strxTrxUsd = num(strx?.stakeInfo.trxPrice);
  const psm = usdd?.items.find(item => item.vaultType === 'PSM-USDT-A');
  const energyFeeSun = param('getEnergyFee') ?? 100;
  if (!params) errors.push('체인 파라미터를 불러오지 못해 에너지 가격 100 sun(가정)을 씁니다.');

  const fees: FeeContext = {
    energyFeeSun,
    bandwidthFeeSun: param('getTransactionFee') ?? 1000,
    rentTrxPer10kEnergy: strx ? num(strx.rentInfo.priceFor10KEnergByRent) : null,
    burnTrxPer10kEnergy: energyFeeSun * 10_000 / 1_000_000,
    trxUsd: Number.isFinite(strxTrxUsd) ? strxTrxUsd : Number.isFinite(usdtPriceInTrx) && usdtPriceInTrx > 0 ? 1 / usdtPriceInTrx : null,
    approveEnergyMeasured: approveEnergy?.value ?? null,
    approveEnergyMeasuredAt: approveEnergy?.at ?? null,
    psmFeeIn: psm?.psmFee != null && Number.isFinite(num(psm.psmFee)) ? num(psm.psmFee) : null,
    sources: [
      { label: 'TronGrid getchainparameters', url: ENDPOINTS.chainParams },
      { label: 'TronGrid triggerconstantcontract (approve 에너지 실측)', url: ENDPOINTS.constantCall },
      strxSource,
      usddSource,
    ],
    fetchedAt,
  };

  return { opportunities, fees, errors, fetchedAt };
}

export const isStale = (fetchedAt: string, now = Date.now()) => now - new Date(fetchedAt).getTime() > STALE_AFTER_MS;
