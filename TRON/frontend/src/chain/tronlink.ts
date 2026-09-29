// TronLink bridge for the one path we execute for real: JustLend jTRX supply/redeem on the
// Nile testnet. Everything here requires an explicit user click and a TronLink signature.

export const NILE = {
  jTRX: 'TKM7w4qFmkXQLEF2MgrQroBYpd5TY7i1pq',
  api: 'https://nile.trongrid.io',
  explorerTx: (txid: string) => `https://nile.tronscan.org/#/transaction/${txid}`,
  faucet: 'https://nileex.io/join/getJoinPage',
  // Recorded with this app via TronLink on 2026-09-29 (see TRON/README.md).
  proofs: [
    { label: '공급 mint() 10 TRX', txid: 'c5c4c29d1a03a9ede7778a651617f9dfc711e3b2c93406ae529300738dcd94c7' },
    { label: '회수 redeemUnderlying() 10 TRX', txid: '016a07ad4715150d5a416903a1312c65094fcb73885df13933128ffa025607d0' },
  ],
} as const;

// Dry-run on Nile (2026-09-29): jTRX mint used 80,894 energy ≈ 8.1 TRX burned. 30 TRX leaves room
// for redeem while staying below a small test wallet's balance.
const FEE_LIMIT_SUN = 30_000_000;

type TronWeb = {
  defaultAddress?: { base58?: string | false };
  fullNode?: { host?: string };
  transactionBuilder: {
    triggerSmartContract(contract: string, selector: string, options: { callValue?: number; feeLimit: number }, params: Array<{ type: string; value: string | number }>, owner: string): Promise<{ result?: { result?: boolean }; transaction?: unknown }>;
  };
  trx: {
    sign(transaction: unknown): Promise<unknown>;
    sendRawTransaction(signed: unknown): Promise<{ result?: boolean; txid?: string; code?: string; message?: string }>;
    getTransactionInfo(txid: string): Promise<{ id?: string; fee?: number; receipt?: { result?: string; energy_usage_total?: number }; result?: string; resMessage?: string }>;
    getBalance(address: string): Promise<number>;
    getContract(address: string): Promise<{ name?: string; contract_address?: string } | undefined>;
  };
};

// TronLink's current provider (window.tron, TIP-1193/TIP-1102) with the legacy window.tronLink as fallback.
type Provider = { request(args: { method: string; params?: unknown }): Promise<unknown>; tronWeb?: TronWeb | false; isTronLink?: boolean };
type TronWindow = Window & { tron?: Provider; tronLink?: Provider; tronWeb?: TronWeb };

export type WalletState = { address: string; network: 'nile' | 'mainnet' | 'other'; trxBalance: number };

const tronWindow = () => window as TronWindow;
let announced: Provider | null = null;
let active: { tronWeb: TronWeb; network: WalletState['network'] } | null = null;

// TIP-6963 multi-wallet discovery: TronLink announces itself in response to this event.
if (typeof window !== 'undefined') {
  window.addEventListener('TIP6963:announceProvider', event => {
    const detail = (event as CustomEvent<{ info?: { name?: string }; provider?: Provider }>).detail;
    if (detail?.provider && (!announced || detail.info?.name === 'TronLink')) announced = detail.provider;
  });
  window.dispatchEvent(new Event('TIP6963:requestProvider'));
}

const findProvider = (): Provider | undefined => announced ?? tronWindow().tron ?? tronWindow().tronLink;

export const hasTronLink = () => Boolean(findProvider() || tronWindow().tronWeb);

function networkOf(host = ''): WalletState['network'] {
  if (host.includes('nile')) return 'nile';
  if (host.includes('api.trongrid.io') || host.includes('api.tronstack.io')) return 'mainnet';
  return 'other';
}

// The host string differs across TronLink versions, so confirm Nile by asking the wallet's node
// for the JustLend Nile jTRX contract, which does not exist on mainnet.
async function detectNetwork(tronWeb: TronWeb): Promise<WalletState['network']> {
  const byHost = networkOf(tronWeb.fullNode?.host);
  if (byHost !== 'other') return byHost;
  try {
    const contract = await tronWeb.trx.getContract(NILE.jTRX);
    return contract?.name === 'JustLend-TRX' ? 'nile' : 'other';
  } catch { return 'other'; }
}

async function requestAccounts(provider: Provider) {
  try {
    await provider.request({ method: 'eth_requestAccounts' });
  } catch (error) {
    const code = (error as { code?: number })?.code;
    if (code === 4001) throw new Error('TronLink에서 연결을 거부했습니다.');
    if (code === -32000) throw new Error('TronLink 잠금을 해제한 뒤 20초 후 다시 시도해주세요.');
    if (code !== 4200) throw error;
    // Older TronLink builds only understand the legacy method.
    const legacy = await provider.request({ method: 'tron_requestAccounts' }) as { code?: number; message?: string } | undefined;
    if (legacy && legacy.code !== undefined && legacy.code !== 200) throw new Error(legacy.message ?? 'TronLink 연결이 거부됐습니다.');
  }
}

export async function connectWallet(): Promise<WalletState> {
  const provider = findProvider();
  if (!provider && !tronWindow().tronWeb) throw new Error('TronLink 확장 프로그램이 필요합니다. 설치 후 새로고침하세요.');
  if (provider) await requestAccounts(provider);
  const tronWeb = (provider?.tronWeb || undefined) ?? tronWindow().tronLink?.tronWeb ?? tronWindow().tronWeb;
  const address = tronWeb ? tronWeb.defaultAddress?.base58 : undefined;
  if (!tronWeb || !address) throw new Error('TronLink 잠금을 해제하고 계정을 선택해주세요.');
  const network = await detectNetwork(tronWeb);
  active = { tronWeb, network };
  const trxBalance = (await tronWeb.trx.getBalance(address)) / 1_000_000;
  return { address, network, trxBalance };
}

function requireNile(): { tronWeb: TronWeb; address: string } {
  const tronWeb = active?.tronWeb;
  const address = tronWeb?.defaultAddress?.base58;
  if (!tronWeb || !address) throw new Error('TronLink를 먼저 연결해주세요.');
  if (active?.network !== 'nile') throw new Error('TronLink 네트워크를 Nile 테스트넷으로 바꾸고 다시 연결해주세요. 메인넷 자산은 사용하지 않습니다.');
  return { tronWeb, address };
}

async function send(selector: string, options: { callValue?: number }, params: Array<{ type: string; value: string | number }>): Promise<string> {
  const { tronWeb, address } = requireNile();
  const built = await tronWeb.transactionBuilder.triggerSmartContract(NILE.jTRX, selector, { ...options, feeLimit: FEE_LIMIT_SUN }, params, address);
  if (!built.result?.result || !built.transaction) throw new Error('거래를 만들지 못했습니다.');
  const signed = await tronWeb.trx.sign(built.transaction);
  const sent = await tronWeb.trx.sendRawTransaction(signed);
  if (!sent.result || !sent.txid) throw new Error(sent.message ? decodeMessage(sent.message) : sent.code ?? '거래 전송에 실패했습니다.');
  return sent.txid;
}

function decodeMessage(message: string) {
  if (!/^[0-9a-f]+$/i.test(message)) return message;
  try { return new TextDecoder().decode(Uint8Array.from(message.match(/../g)!.map(byte => parseInt(byte, 16)))); } catch { return message; }
}

export const supplyTrxOnNile = (amountTrx: number) => send('mint()', { callValue: Math.round(amountTrx * 1_000_000) }, []);
export const redeemTrxOnNile = (amountTrx: number) => send('redeemUnderlying(uint256)', {}, [{ type: 'uint256', value: Math.round(amountTrx * 1_000_000) }]);

export type Receipt = { status: 'success' | 'failed' | 'pending'; message?: string; feeTrx?: number; energy?: number };

export async function waitForReceipt(txid: string, timeoutMs = 60_000): Promise<Receipt> {
  const { tronWeb } = requireNile();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await tronWeb.trx.getTransactionInfo(txid).catch(() => ({} as Awaited<ReturnType<TronWeb['trx']['getTransactionInfo']>>));
    if (info?.id) {
      const ok = info.receipt?.result === 'SUCCESS' || (!info.receipt?.result && info.result !== 'FAILED');
      // The receipt carries what the chain actually charged, which replaces our estimate in the log.
      const actual = { feeTrx: (info.fee ?? 0) / 1_000_000, energy: info.receipt?.energy_usage_total };
      return ok ? { status: 'success', ...actual } : { status: 'failed', message: info.resMessage ? decodeMessage(info.resMessage) : info.receipt?.result, ...actual };
    }
    await new Promise(resolve => setTimeout(resolve, 3_000));
  }
  return { status: 'pending', message: '60초 안에 확정되지 않았습니다. 탐색기에서 상태를 확인하세요.' };
}

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58ToHex20(address: string): string {
  let value = 0n;
  for (const char of address) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('주소 형식이 올바르지 않습니다.');
    value = value * 58n + BigInt(index);
  }
  const hex = value.toString(16).padStart(50, '0'); // 25 bytes: 0x41 + 20 bytes + 4 checksum
  return hex.slice(2, 42);
}

async function constantCall(selector: string, parameter = ''): Promise<bigint> {
  const response = await fetch(`${NILE.api}/wallet/triggerconstantcontract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner_address: NILE.jTRX, contract_address: NILE.jTRX, function_selector: selector, parameter, visible: true }),
    signal: AbortSignal.timeout(12_000),
  });
  const body = await response.json() as { constant_result?: string[] };
  const result = body.constant_result?.[0];
  if (!result) throw new Error(`${selector} 조회 실패`);
  return BigInt(`0x${result.slice(0, 64)}`);
}

// Reads the live Nile jTRX position without needing the wallet.
export async function readNilePosition(address: string) {
  const [jBalance, exchangeRate, supplyRatePerBlock] = await Promise.all([
    constantCall('balanceOf(address)', base58ToHex20(address).padStart(64, '0')),
    constantCall('exchangeRateStored()'),
    constantCall('supplyRatePerBlock()'),
  ]);
  const underlyingSun = jBalance * exchangeRate / 10n ** 18n;
  const blocksPerYear = 10_512_000; // 3-second blocks
  return {
    jTokens: Number(jBalance) / 1e8,
    underlyingTrx: Number(underlyingSun) / 1_000_000,
    supplyApy: Number(supplyRatePerBlock) / 1e18 * blocksPerYear,
    readAt: new Date().toISOString(),
  };
}
