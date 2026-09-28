/**
 * AgentGuardVault 를 TRON Nile 테스트넷에 배포한다.
 *
 * 사전 준비: `npm run compile`, `npm run setup:agent` (오너와 다른 AI 에이전트 지갑)
 * 필수 env : NILE_RPC_URL, PRIVATE_KEY(오너=사용자), AI_AGENT_ADDRESS
 * 선택 env : GUARDIAN_ADDRESS (긴급 중지 권한만 가진 주소, 없으면 비활성)
 *            FEE_LIMIT_TRX (기본 1000, 배포 트랜잭션 최대 수수료 상한)
 *
 * 결과:
 *  - deployments/nile.json : 네트워크·주소·배포 Tx (커밋하는 온체인 증빙)
 *  - ../frontend/src/contracts/AgentGuardVault.json : 프론트엔드용 ABI+주소
 *    (프론트엔드 폴더가 없으면 build/AgentGuardVault_frontend_export.json)
 */
const fs = require("fs");
const path = require("path");
const {
  ROOT,
  NETWORK,
  SUN_PER_TRX,
  requireEnv,
  connect,
  loadArtifact,
  saveDeployment,
  toAbiAddress,
  waitForTx,
  hexToText,
  txUrl,
  contractUrl,
  trx,
} = require("./lib/tron");

const CONTRACT_NAME = "AgentGuardVault";
const FRONTEND_DIR = path.resolve(ROOT, "..", "frontend", "src", "contracts");
const FRONTEND_FILE = path.join(FRONTEND_DIR, `${CONTRACT_NAME}.json`);
const LOCAL_EXPORT_FILE = path.join(ROOT, "build", `${CONTRACT_NAME}_frontend_export.json`);
const ZERO_ADDRESS_HEX20 = "0x0000000000000000000000000000000000000000";

function exportForFrontend(data) {
  const json = JSON.stringify(data, null, 2) + "\n";
  if (fs.existsSync(FRONTEND_DIR)) {
    try {
      fs.writeFileSync(FRONTEND_FILE, json);
      console.log(`Frontend ABI synced: ${path.relative(ROOT, FRONTEND_FILE)}`);
      return;
    } catch (err) {
      console.warn(`Frontend 저장 실패 (${err.message}). 로컬에 저장합니다.`);
    }
  } else {
    console.log("Frontend directory not found. Saved locally in build/.");
  }
  fs.mkdirSync(path.dirname(LOCAL_EXPORT_FILE), { recursive: true });
  fs.writeFileSync(LOCAL_EXPORT_FILE, json);
  console.log(`  -> ${path.relative(ROOT, LOCAL_EXPORT_FILE)}`);
}

async function main() {
  const { tronWeb, address: deployer } = connect("PRIVATE_KEY");

  const aiAgent = requireEnv("AI_AGENT_ADDRESS");
  const aiAgentHex = toAbiAddress(tronWeb, aiAgent, "AI_AGENT_ADDRESS");
  if (tronWeb.address.fromHex(aiAgentHex) === deployer) {
    throw new Error("AI_AGENT_ADDRESS 가 오너(PRIVATE_KEY) 계정과 같습니다. 'npm run setup:agent' 로 에이전트 지갑을 분리하세요.");
  }
  const guardian = (process.env.GUARDIAN_ADDRESS || "").trim();
  const guardianHex = guardian ? toAbiAddress(tronWeb, guardian, "GUARDIAN_ADDRESS") : ZERO_ADDRESS_HEX20;
  if (guardianHex === aiAgentHex) throw new Error("GUARDIAN_ADDRESS 는 AI 에이전트와 달라야 합니다.");

  const feeLimitSun = Number(process.env.FEE_LIMIT_TRX || 1000) * SUN_PER_TRX;
  const artifact = loadArtifact();
  const balance = await tronWeb.trx.getBalance(deployer);

  console.log(`=== ${CONTRACT_NAME} → TRON Nile ===`);
  console.log(`Owner (deployer) : ${deployer} (${trx(balance)} TRX)`);
  console.log(`AI Agent         : ${tronWeb.address.fromHex(aiAgentHex)}`);
  console.log(`Guardian         : ${guardian ? tronWeb.address.fromHex(guardianHex) : "(none)"}`);
  console.log(`Fee limit        : ${trx(feeLimitSun)} TRX`);
  if (balance === 0) throw new Error("배포 계정의 TRX 잔고가 0 입니다. Nile faucet 에서 충전하세요.");

  const unsignedTx = await tronWeb.transactionBuilder.createSmartContract(
    {
      name: CONTRACT_NAME,
      abi: artifact.abi,
      bytecode: artifact.bytecode,
      parameters: [aiAgentHex, guardianHex],
      feeLimit: feeLimitSun,
      callValue: 0,
      // 호출자(에이전트·오너)가 자기 호출의 에너지를 부담한다.
      userFeePercentage: 100,
      originEnergyLimit: 10_000_000,
    },
    deployer
  );
  const signedTx = await tronWeb.trx.sign(unsignedTx);
  const broadcast = await tronWeb.trx.sendRawTransaction(signedTx);
  if (!broadcast.result) {
    throw new Error(`브로드캐스트 실패: ${broadcast.code || ""} ${hexToText(broadcast.message) || JSON.stringify(broadcast)}`);
  }

  const txId = signedTx.txID;
  console.log(`\nDeploy tx        : ${txId}\nWaiting for confirmation...`);
  const info = await waitForTx(tronWeb, txId);

  const addressHex = info.contract_address || unsignedTx.contract_address;
  const address = tronWeb.address.fromHex(addressHex);
  const energyUsed = (info.receipt && info.receipt.energy_usage_total) || 0;
  const feeSun = info.fee || 0;

  // 배포된 상태가 의도대로인지 온체인에서 다시 읽어 확인
  const vault = tronWeb.contract(artifact.abi, address);
  const [owner, onchainAgent] = await Promise.all([vault.owner().call(), vault.aiAgent().call()]);
  if (tronWeb.address.fromHex(owner) !== deployer || tronWeb.address.fromHex(onchainAgent) !== tronWeb.address.fromHex(aiAgentHex)) {
    throw new Error(`배포 후 상태 불일치: owner=${tronWeb.address.fromHex(owner)}, aiAgent=${tronWeb.address.fromHex(onchainAgent)}`);
  }

  const deployment = {
    contractName: CONTRACT_NAME,
    network: NETWORK,
    address,
    addressHex,
    deployTxId: txId,
    deployBlock: info.blockNumber,
    tronscan: contractUrl(address),
    deployTxUrl: txUrl(txId),
    owner: deployer,
    aiAgent: tronWeb.address.fromHex(aiAgentHex),
    guardian: guardian ? tronWeb.address.fromHex(guardianHex) : null,
    energyUsed,
    feeTrx: feeSun / SUN_PER_TRX,
    deployedAt: new Date().toISOString(),
    compiler: artifact.compiler,
  };
  saveDeployment(deployment);
  console.log(`\nSaved: deployments/nile.json`);

  exportForFrontend({ ...deployment, abi: artifact.abi });

  console.log(`
=== Deployed (energy ${energyUsed}, fee ${trx(feeSun)} TRX) ===

## On-Chain Verification Proof

| Item | Value |
| --- | --- |
| Network | TRON Nile Testnet |
| Contract | \`${address}\` |
| Deploy Tx Hash | \`${txId}\` |
| Tronscan (contract) | ${contractUrl(address)} |
| Tronscan (deploy tx) | ${txUrl(txId)} |
`);
}

main().catch((err) => {
  console.error(`\n[deploy_nile] ${err.message}`);
  process.exit(1);
});
