// TronLink bridge for the one path we execute for real: JustLend jTRX supply/redeem on the
// Nile testnet. Everything here requires an explicit user click and a TronLink signature.

export const NILE = {
  jTRX: 'TKM7w4qFmkXQLEF2MgrQroBYpd5TY7i1pq',
  api: 'https://nile.trongrid.io',
  explorerTx: (txid: string) => `https://nile.tronscan.org/#/transaction/${txid}`,
  faucet: 'https://nileex.io/join/getJoinPage',
} as const;

const FEE_LIMIT_SUN = 100_000_000; // 100 TRX cap per transaction

type TronWeb = {
  defaultAddress?: { base58?: string | false };
  fullNode?: { host?: string };
  transactionBuilder: {
    triggerSmartContract(contract: string, selector: string, options: { callValue?: number; feeLimit: number }, params: Array<{ type: string; value: string | number }>, owner: string): Promise<{ result?: { result?: boolean }; transaction?: unknown }>;
  };
  trx: {
    sign(transaction: unknown): Promise<unknown>;
    sendRawTransaction(signed: unknown): Promise<{ result?: boolean; txid?: string; code?: string; message?: string }>;
    getTransactionInfo(txid: string): Promise<{ id?: string; receipt?: { result?: string }; result?: string; resMessage?: string }>;
    getBalance(address: string): Promise<number>;
  };
};

type TronWindow = Window & { tronWeb?: TronWeb; tronLink?: { request(args: { method: string }): Promise<{ code?: number; message?: string } | undefined> } };

export type WalletState = { address: string; network: 'nile' | 'mainnet' | 'other'; trxBalance: number };

const tronWindow = () => window as TronWindow;

export const hasTronLink = () => Boolean(tronWindow().tronLink || tronWindow().tronWeb);

function networkOf(host = ''): WalletState['network'] {
  if (host.includes('nile')) return 'nile';
  if (host.includes('api.trongrid.io') || host.includes('api.tronstack.io')) return 'mainnet';
  return 'other';
}

export async function connectWallet(): Promise<WalletState> {
  const w = tronWindow();
  if (!w.tronLink && !w.tronWeb) throw new Error('TronLink 확장 프로그램이 필요합니다.');
  if (w.tronLink) {
    const response = await w.tronLink.request({ method: 'tron_requestAccounts' });
    if (response && response.code !== undefined && response.code !== 200) throw new Error(response.message ?? 'TronLink 연결이 거부됐습니다.');
  }
  const tronWeb = w.tronWeb;
  const address = tronWeb?.defaultAddress?.base58;
  if (!tronWeb || !address) throw new Error('TronLink 잠금을 해제하고 계정을 선택해주세요.');
  const trxBalance = (await tronWeb.trx.getBalance(address)) / 1_000_000;
  return { address, network: networkOf(tronWeb.fullNode?.host), trxBalance };
}

function requireNile(): { tronWeb: TronWeb; address: string } {
  const tronWeb = tronWindow().tronWeb;
  const address = tronWeb?.defaultAddress?.base58;
  if (!tronWeb || !address) throw new Error('TronLink를 먼저 연결해주세요.');
  if (networkOf(tronWeb.fullNode?.host) !== 'nile') throw new Error('TronLink 네트워크를 Nile 테스트넷으로 바꿔주세요. 메인넷 자산은 사용하지 않습니다.');
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

export type Receipt = { status: 'success' | 'failed' | 'pending'; message?: string };

export async function waitForReceipt(txid: string, timeoutMs = 60_000): Promise<Receipt> {
  const { tronWeb } = requireNile();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await tronWeb.trx.getTransactionInfo(txid).catch(() => ({} as Awaited<ReturnType<TronWeb['trx']['getTransactionInfo']>>));
    if (info?.id) {
      const ok = info.receipt?.result === 'SUCCESS' || (!info.receipt?.result && info.result !== 'FAILED');
      return ok ? { status: 'success' } : { status: 'failed', message: info.resMessage ? decodeMessage(info.resMessage) : info.receipt?.result };
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
