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

// USDD protocol state on TRON, used for the USDD legs of a plan (conversion path and risk).
export type UsddHealth = {
  supplyUsd: number;
  collateralUsd: number;
  collateralRatio: number;
  psmTin: number | null; // USDT -> USDD fee
  psmTout: number | null; // USDD -> USDT fee (on-chain)
  sources: SourceRef[];
  fetchedAt: string;
};

export type MarketSnapshot = {
  opportunities: Opportunity[];
  fees: FeeContext;
  usdd: UsddHealth | null;
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
const usddSavingsDoc: SourceRef = { label: 'USDD Docs: USDD Savings', url: 'https://docs.usdd.io/user-guide/usdd-savings' };
const psmSource: SourceRef = { label: 'USDD PSM tout() (TronGrid)', url: 'https://tronscan.org/#/contract/TBXW4hS5KYjjbJXDpnrPf4zhkLwrpUjbyz' };

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

type UsddTron = {
  apy: number | null;
  totalSupplyValue?: number;
  totalCollateralValue?: number;
  items: Array<{ vaultType: string; psmFee: string | null; contractAddress: string }>;
};

export function buildUsddOpportunity(data: UsddTron, fetchedAt: string): Opportunity {
  const apy = num(data.apy);
  return {
    id: 'usdd-protocol',
    project: 'USDD',
    name: 'USDD Savings (sUSDD)',
    asset: 'USDD',
    contract: MAINNET.USDD,
    baseApy: Number.isFinite(apy) ? apy : 0,
    incentiveApy: 0,
    exit: '문서상 잠금 없이 언제든 회수(출금) 가능. 단 Ethereum/BNB Chain의 sUSDD 기준이며 TRON에서는 참여 불가.',
    risks: ['USDD 디페그 위험', 'TRON에서 쓰려면 다른 체인으로 브릿지해야 함'],
    terms: ['USDD 공식 API가 TRON 체인에 공시한 저축 수익률입니다. 공식 문서상 USDD Savings(sUSDD) 예치는 Ethereum/BNB Chain 네트워크에서만 제공되고, TRON 체인의 예치 규모(earnTvl)는 0입니다.'],
    sources: [usddSource, usddSavingsDoc],
    fetchedAt,
    // Shown for transparency, but TRON users cannot deposit into it without bridging.
    usable: false,
    unusableReason: '공식 문서상 sUSDD 저축은 Ethereum/BNB Chain 전용입니다. TRON에서는 브릿지 비용·위험이 추가돼 계획에 넣지 않습니다.',
  };
}

export function buildUsddHealth(data: UsddTron, psmTout: number | null, fetchedAt: string): UsddHealth | null {
  const supplyUsd = num(data.totalSupplyValue);
  const collateralUsd = num(data.totalCollateralValue);
  if (!Number.isFinite(supplyUsd) || !Number.isFinite(collateralUsd) || supplyUsd <= 0) return null;
  const psm = data.items.find(item => item.vaultType === 'PSM-USDT-A');
  const tin = psm?.psmFee != null ? num(psm.psmFee) : NaN;
  return {
    supplyUsd,
    collateralUsd,
    collateralRatio: collateralUsd / supplyUsd,
    psmTin: Number.isFinite(tin) ? tin : null,
    psmTout,
    sources: psmTout != null ? [usddSource, psmSource] : [usddSource],
    fetchedAt,
  };
}

// USDD legs of a plan carry the protocol's live state: how to get back to USDT, and how well
// the stablecoin is collateralized right now.
export function applyUsddHealth(opportunities: Opportunity[], health: UsddHealth | null): Opportunity[] {
  if (!health) return opportunities;
  const ratio = `${(health.collateralRatio * 100).toFixed(0)}%`;
  return opportunities.map(item => (item.id !== 'jl-usdd' ? item : {
    ...item,
    exit: `${item.exit} USDD→USDT는 USDD PSM으로 1:1 교환${health.psmTout != null ? ` (수수료 ${(health.psmTout * 100).toFixed(2)}%, 체인 조회)` : ' (역교환 수수료 미확인)'}.`,
    risks: [...item.risks, `USDD 담보율 ${ratio} (TRON 체인: 담보 $${Math.round(health.collateralUsd / 1e6).toLocaleString('en-US')}M / 발행 $${Math.round(health.supplyUsd / 1e6).toLocaleString('en-US')}M). 담보율이 낮아지면 디페그 위험이 커집니다.`],
    sources: [...item.sources, ...health.sources],
  }));
}

// Keyless TronGrid rate-limits constant calls; reuse the last good on-chain read if needed.
async function withCache(key: string, read: () => Promise<number | null>): Promise<number | null> {
  try {
    const value = await read();
    if (value != null) try { localStorage.setItem(key, JSON.stringify({ value, at: new Date().toISOString() })); } catch { /* storage unavailable */ }
    return value;
  } catch (error) {
    try {
      const cached = JSON.parse(localStorage.getItem(key) ?? 'null') as { value: number } | null;
      if (cached && Number.isFinite(cached.value)) return cached.value;
    } catch { /* ignore */ }
    throw error;
  }
}

async function readPsmTout(): Promise<number | null> {
  const body = await getJson<{ constant_result?: string[] }>(ENDPOINTS.constantCall, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner_address: MAINNET.USDT, contract_address: MAINNET.usddPsm, function_selector: 'tout()', parameter: '', visible: true }),
  });
  const raw = body.constant_result?.[0];
  return raw ? Number(BigInt(`0x${raw.slice(0, 64)}`)) / 1e18 : null;
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

  // Run after the burst above; keyless TronGrid rate-limits parallel constant calls.
  const psmTout = usdd ? await settle('USDD PSM 역교환 수수료', () => withCache('tron-yield-psm-tout', readPsmTout)) : null;
  const usddHealth = usdd ? buildUsddHealth(usdd, psmTout, fetchedAt) : null;

  let opportunities: Opportunity[] = [];
  if (jtoken) {
    if (!mining) errors.push('채굴 보상을 불러오지 못해 인센티브를 0으로 표시합니다.');
    opportunities.push(...buildJustLendOpportunities(jtoken.tokenList, mining ?? {}, fetchedAt));
  }
  if (strx) opportunities.push(buildStrxOpportunity(strx, fetchedAt));
  if (usdd) opportunities.push(buildUsddOpportunity(usdd, fetchedAt));
  opportunities = applyUsddHealth(opportunities, usddHealth);

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

  return { opportunities, fees, usdd: usddHealth, errors, fetchedAt };
}

export const isStale = (fetchedAt: string, now = Date.now()) => now - new Date(fetchedAt).getTime() > STALE_AFTER_MS;
