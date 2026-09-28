/**
 * AI 에이전트 전용 Nile 지갑을 준비한다.
 *
 * - .env 에 AI_AGENT_PRIVATE_KEY 가 없거나 오너(PRIVATE_KEY)와 같은 계정이면 새 지갑을 만들어
 *   AI_AGENT_PRIVATE_KEY / AI_AGENT_ADDRESS 를 .env 에 기록한다. (개인키는 화면에 출력하지 않는다)
 * - 에이전트 잔고가 AGENT_MIN_TRX(기본 50) 미만이면 오너 계정에서 AGENT_FUND_TRX(기본 100) 를 보낸다.
 *   에이전트는 requestSpend 트랜잭션의 에너지 비용을 직접 낸다.
 *
 * 오너와 에이전트가 같으면 AI 가 자기 결제를 스스로 승인할 수 있으므로 컨트랙트도 배포를 거부한다.
 */
const fs = require("fs");
const { TronWeb, utils } = require("tronweb");
const { ENV_PATH, SUN_PER_TRX, connect, rpcUrl, normalizePrivateKey, waitForTx, txUrl, trx } = require("./lib/tron");

/** .env 의 KEY=VALUE 를 교체하거나 추가한다 (다른 줄은 보존) */
function upsertEnv(key, value) {
  const text = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  const next = pattern.test(text) ? text.replace(pattern, line) : `${text.replace(/\s*$/, "")}\n${line}\n`;
  fs.writeFileSync(ENV_PATH, next);
  process.env[key] = value;
}

async function main() {
  const owner = connect("PRIVATE_KEY");

  let agentAddress = null;
  const existingKey = (process.env.AI_AGENT_PRIVATE_KEY || "").trim();
  if (existingKey) {
    agentAddress = TronWeb.address.fromPrivateKey(normalizePrivateKey(existingKey, "AI_AGENT_PRIVATE_KEY"));
  }

  if (!agentAddress || agentAddress === owner.address) {
    const account = utils.accounts.generateAccount();
    upsertEnv("AI_AGENT_PRIVATE_KEY", account.privateKey);
    upsertEnv("AI_AGENT_ADDRESS", account.address.base58);
    agentAddress = account.address.base58;
    console.log(`새 AI 에이전트 지갑 생성: ${agentAddress} (.env 에 저장, 개인키는 출력하지 않음)`);
  } else {
    if (process.env.AI_AGENT_ADDRESS !== agentAddress) upsertEnv("AI_AGENT_ADDRESS", agentAddress);
    console.log(`기존 AI 에이전트 지갑 사용: ${agentAddress}`);
  }

  const minSun = Number(process.env.AGENT_MIN_TRX || 50) * SUN_PER_TRX;
  const fundSun = Number(process.env.AGENT_FUND_TRX || 100) * SUN_PER_TRX;
  const agentTronWeb = new TronWeb({ fullHost: rpcUrl() });
  const balance = await agentTronWeb.trx.getBalance(agentAddress);
  console.log(`에이전트 잔고: ${trx(balance)} TRX`);

  if (balance >= minSun) {
    console.log("충전 불필요.");
    return;
  }
  const ownerBalance = await owner.tronWeb.trx.getBalance(owner.address);
  if (ownerBalance < fundSun + 5 * SUN_PER_TRX) {
    throw new Error(`오너 잔고 부족: ${trx(ownerBalance)} TRX (필요: ${trx(fundSun)} TRX + 수수료)`);
  }

  const tx = await owner.tronWeb.trx.sendTransaction(agentAddress, fundSun);
  if (!tx.result) throw new Error(`충전 트랜잭션 전송 실패: ${JSON.stringify(tx)}`);
  const txId = tx.txid || tx.transaction.txID;
  console.log(`충전 트랜잭션 전송: ${txUrl(txId)}`);
  await waitForTx(owner.tronWeb, txId);
  console.log(`충전 완료: ${owner.address} → ${agentAddress} ${trx(fundSun)} TRX`);
}

main().catch((err) => {
  console.error(`\n[setup_agent] ${err.message}`);
  process.exit(1);
});
