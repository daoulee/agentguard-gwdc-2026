const SEPOLIA_CHAIN_ID = 11155111;
const ANCHOR_PREFIX = "0x4147"; // ASCII "AG"

type RpcTransaction = {
  hash: string;
  from: string;
  to: string | null;
  value: string;
  input: string;
};

type RpcReceipt = {
  transactionHash: string;
  status: string;
  blockNumber: string;
};

export class ChainVerificationError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

export function getChainStatus() {
  const rpcUrl = process.env.RPC_URL?.trim() ?? "";
  const chainId = Number(process.env.CHAIN_ID ?? SEPOLIA_CHAIN_ID);
  return {
    configured: Boolean(rpcUrl) && chainId === SEPOLIA_CHAIN_ID,
    chainId: SEPOLIA_CHAIN_ID,
    network: "Ethereum Sepolia",
    rpcUrl
  };
}

export function createAnchorData(auditHash: string) {
  if (!/^[0-9a-f]{64}$/i.test(auditHash)) {
    throw new ChainVerificationError("감사 해시 형식이 올바르지 않습니다.", 400);
  }
  return `${ANCHOR_PREFIX}${auditHash.toLowerCase()}`;
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const status = getChainStatus();
  if (!status.configured) {
    throw new ChainVerificationError("Sepolia RPC가 설정되지 않았습니다.", 503);
  }
  let response: Response;
  try {
    response = await fetch(status.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(8_000)
    });
  } catch {
    throw new ChainVerificationError("테스트넷 RPC에 연결하지 못했습니다.", 502);
  }
  if (!response.ok) throw new ChainVerificationError("테스트넷 RPC가 오류를 반환했습니다.", 502);
  const payload = await response.json() as { result?: T; error?: { message?: string } };
  if (payload.error || !("result" in payload)) {
    throw new ChainVerificationError("테스트넷 RPC 응답을 확인할 수 없습니다.", 502);
  }
  return payload.result as T;
}

export async function verifyAnchorTransaction(transactionHash: string, auditHash: string) {
  if (!/^0x[0-9a-f]{64}$/i.test(transactionHash)) {
    throw new ChainVerificationError("거래 해시 형식이 올바르지 않습니다.", 400);
  }
  const expectedData = createAnchorData(auditHash);
  const chainId = await rpc<string>("eth_chainId", []);
  if (BigInt(chainId) !== BigInt(SEPOLIA_CHAIN_ID)) {
    throw new ChainVerificationError("RPC가 Sepolia 테스트넷에 연결되지 않았습니다.", 409);
  }
  const [transaction, receipt] = await Promise.all([
    rpc<RpcTransaction | null>("eth_getTransactionByHash", [transactionHash]),
    rpc<RpcReceipt | null>("eth_getTransactionReceipt", [transactionHash])
  ]);
  if (!transaction || !receipt) {
    throw new ChainVerificationError("거래가 아직 테스트넷에서 확정되지 않았습니다.", 409);
  }
  if (transaction.hash.toLowerCase() !== transactionHash.toLowerCase()
    || receipt.transactionHash.toLowerCase() !== transactionHash.toLowerCase()
    || transaction.input.toLowerCase() !== expectedData
    || !transaction.to
    || transaction.from.toLowerCase() !== transaction.to.toLowerCase()
    || BigInt(transaction.value) !== 0n
    || BigInt(receipt.status) !== 1n) {
    throw new ChainVerificationError("거래 내용이 감사 해시 기록과 일치하지 않습니다.", 400);
  }
  return { chainId: SEPOLIA_CHAIN_ID, blockNumber: Number(BigInt(receipt.blockNumber)) };
}
