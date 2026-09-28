// 현장 Sepolia RPC 점검: node --env-file=.env scripts/check-chain.mjs [지갑주소]
// 읽기 전용이다. 서명·송금을 하지 않는다.
const rpc = (process.env.RPC_URL ?? '').trim();
if (!rpc) { console.error('✖ RPC_URL 이 .env에 없습니다.'); process.exit(1); }
const call = async (method, params = []) => {
  const response = await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
};
const started = performance.now();
const chainId = Number(BigInt(await call('eth_chainId')));
const block = Number(BigInt(await call('eth_blockNumber')));
console.log(`${chainId === 11155111 ? '✔' : '✖'} chainId=${chainId} (Sepolia=11155111) · block=${block} · ${Math.round(performance.now() - started)}ms`);
if (chainId !== 11155111) process.exit(1);
const address = process.argv[2];
if (address) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) { console.error('✖ 주소 형식이 올바르지 않습니다.'); process.exit(1); }
  const wei = BigInt(await call('eth_getBalance', [address, 'latest']));
  const eth = Number(wei) / 1e18;
  console.log(`${wei > 0n ? '✔' : '✖'} ${address} 잔액 ${eth.toFixed(6)} SepoliaETH${wei > 0n ? '' : ' → faucet 필요'}`);
}
