import assert from "node:assert/strict";
import test from "node:test";
import { ChainVerificationError, createAnchorData, verifyAnchorTransaction } from "./chain.js";

const auditHash = "b".repeat(64);
const transactionHash = `0x${"a".repeat(64)}`;
const address = `0x${"1".repeat(40)}`;

test("Sepolia 거래 데이터와 영수증이 감사 해시와 일치해야 앵커를 인정한다", async () => {
  const previousRpc = process.env.RPC_URL;
  const previousChain = process.env.CHAIN_ID;
  const previousFetch = globalThis.fetch;
  process.env.RPC_URL = "https://sepolia.example/rpc";
  process.env.CHAIN_ID = "11155111";
  let input = createAnchorData(auditHash);
  let reportedChainId = "0xaa36a7";
  let receiptStatus = "0x1";
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { method: string };
    const result = body.method === "eth_chainId" ? reportedChainId
      : body.method === "eth_getTransactionByHash" ? {
        hash: transactionHash, from: address, to: address, value: "0x0", input
      }
      : { transactionHash, status: receiptStatus, blockNumber: "0x10" };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
  };
  try {
    assert.deepEqual(await verifyAnchorTransaction(transactionHash, auditHash), {
      chainId: 11155111,
      blockNumber: 16
    });
    input = "0x4147" + "c".repeat(64);
    await assert.rejects(
      verifyAnchorTransaction(transactionHash, auditHash),
      (error: unknown) => error instanceof ChainVerificationError && error.statusCode === 400
    );
    input = createAnchorData(auditHash);
    receiptStatus = "0x0";
    await assert.rejects(
      verifyAnchorTransaction(transactionHash, auditHash),
      (error: unknown) => error instanceof ChainVerificationError && error.statusCode === 400
    );
    receiptStatus = "0x1";
    reportedChainId = "0x1";
    await assert.rejects(
      verifyAnchorTransaction(transactionHash, auditHash),
      (error: unknown) => error instanceof ChainVerificationError && error.statusCode === 409
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousRpc === undefined) delete process.env.RPC_URL;
    else process.env.RPC_URL = previousRpc;
    if (previousChain === undefined) delete process.env.CHAIN_ID;
    else process.env.CHAIN_ID = previousChain;
  }
});
