/**
 * 배포된 AgentGuardVault 에서 3대 데모 시나리오를 Nile 테스트넷 실거래로 실행한다.
 *
 *   준비   오너: setPolicy(예산 100,000원, 기한 +24h, 사용자 승인 필요) · setMerchant · deposit
 *   1) 에이전트: KeyboardLab 87,000원 요청 → Pending  → 오너 approveSpend 서명 → 송금 (Approved)
 *   2) 에이전트: TechStore 98,000+5,000원 요청 → Exceeded Budget   (revert 없이 AuditRecorded) [Push #1]
 *   3) 에이전트: UnlistedMarket 65,000원 요청 → Unregistered Merchant (revert 없이 AuditRecorded) [Push #2]
 *
 * 금액은 1원 = 1 sun. 각 트랜잭션의 영수증에서 AuditRecorded 이벤트를 디코딩해 판정을 검증하고,
 * 결과(Tx 해시·Tronscan 링크)를 deployments/nile.json 의 demoRuns 에 누적 저장한다.
 *
 * 필수 env : NILE_RPC_URL, PRIVATE_KEY(오너), AI_AGENT_PRIVATE_KEY (npm run setup:agent)
 */
const { utils } = require("tronweb");
const {
  connect,
  loadArtifact,
  loadDeployment,
  saveDeployment,
  waitForTx,
  decodeLogs,
  txUrl,
  contractUrl,
  trx,
} = require("./lib/tron");

const won = (n) => n; // 1원 = 1 sun
const FEE_LIMIT_SUN = Number(process.env.CALL_FEE_LIMIT_TRX || 150) * 1_000_000;
const MERCHANT_NAMES = ["KeyboardLab", "TechStore", "UnlistedMarket"];

async function main() {
  const deployment = loadDeployment();
  const artifact = loadArtifact();
  const owner = connect("PRIVATE_KEY");
  const agent = connect("AI_AGENT_PRIVATE_KEY");
  if (owner.address !== deployment.owner) throw new Error(`PRIVATE_KEY 계정(${owner.address})이 금고 오너(${deployment.owner})가 아닙니다.`);
  if (agent.address !== deployment.aiAgent) throw new Error(`AI_AGENT_PRIVATE_KEY 계정(${agent.address})이 금고의 aiAgent(${deployment.aiAgent})가 아닙니다.`);

  // 데모 판매자 주소는 한 번 만들어 deployments/nile.json 에 고정한다 (수령만 하므로 개인키는 버린다).
  deployment.merchants = deployment.merchants || {};
  for (const name of MERCHANT_NAMES) {
    if (!deployment.merchants[name]) deployment.merchants[name] = utils.accounts.generateAccount().address.base58;
  }
  saveDeployment(deployment);
  const m = deployment.merchants;

  const vaultAsOwner = owner.tronWeb.contract(artifact.abi, deployment.address);
  const vaultAsAgent = agent.tronWeb.contract(artifact.abi, deployment.address);

  console.log(`=== AgentGuard demo on TRON Nile ===`);
  console.log(`Vault : ${deployment.address}`);
  console.log(`Owner : ${owner.address} (${trx(await owner.tronWeb.trx.getBalance(owner.address))} TRX)`);
  console.log(`Agent : ${agent.address} (${trx(await agent.tronWeb.trx.getBalance(agent.address))} TRX)`);
  console.log(`Merchants: ${MERCHANT_NAMES.map((n) => `${n}=${m[n]}`).join(", ")} (UnlistedMarket 은 미등록)\n`);

  const steps = [];
  async function run(label, contract, method, args, callValue = 0) {
    const txId = await contract[method](...args).send({ feeLimit: FEE_LIMIT_SUN, callValue, shouldPollResponse: false });
    const info = await waitForTx(contract.tronWeb, txId);
    const events = decodeLogs(artifact.abi, info);
    const audit = events.find((e) => e.name === "AuditRecorded");
    const step = {
      label,
      method,
      txId,
      url: txUrl(txId),
      energy: (info.receipt && info.receipt.energy_usage_total) || 0,
      feeTrx: (info.fee || 0) / 1_000_000,
      audit: audit
        ? { requestId: audit.args.requestId.toString(), amount: audit.args.amount.toString(), isApproved: audit.args.isApproved, reason: audit.args.reason }
        : null,
      executed: events.some((e) => e.name === "SpendExecuted"),
    };
    steps.push(step);
    console.log(`✔ ${label}${step.audit ? ` → ${step.audit.reason}` : ""}\n    ${step.url}`);
    return step;
  }

  function expectAudit(step, reason, executed) {
    if (!step.audit || step.audit.reason !== reason || step.executed !== executed) {
      throw new Error(`판정 불일치 (${step.label}): 기대 ${reason}/executed=${executed}, 실제 ${JSON.stringify(step.audit)}/executed=${step.executed}`);
    }
  }

  // 요청 ID 는 실행마다 달라야 한다 (재사용 시 DuplicateRequestId revert)
  const base = BigInt(Date.now()) * 10n;
  const nowSec = Math.floor(Date.now() / 1000);

  // --- 준비 (오너) ---
  await run("정책 설정: 예산 100,000원 · 기한 +24h · 사용자 승인 필요", vaultAsOwner, "setPolicy", [won(100_000), nowSec + 24 * 3600, true]);
  for (const name of ["KeyboardLab", "TechStore"]) {
    const allowed = await vaultAsOwner.approvedMerchants(m[name]).call();
    if (!allowed) await run(`판매자 등록: ${name}`, vaultAsOwner, "setMerchant", [m[name], true]);
  }
  const vaultBalance = await owner.tronWeb.trx.getBalance(deployment.address);
  if (vaultBalance < won(200_000)) await run("금고 충전 1 TRX", vaultAsOwner, "deposit", [], 1_000_000);

  // --- 시나리오 1: 정상 결제 (2단계 승인) ---
  const s1 = await run("시나리오 1: AI 요청 KeyboardLab 87,000원", vaultAsAgent, "requestSpend", [m.KeyboardLab, won(87_000), (base + 1n).toString()]);
  expectAudit(s1, "Pending Human Approval", false);
  const s1b = await run("시나리오 1: 사용자 approveSpend 서명 → 송금", vaultAsOwner, "approveSpend", [(base + 1n).toString()]);
  expectAudit(s1b, "Approved", true);

  // --- 시나리오 2: 예산 초과 (Push #1) ---
  const s2 = await run("시나리오 2: AI 요청 TechStore 98,000+5,000원", vaultAsAgent, "requestSpend", [m.TechStore, won(103_000), (base + 2n).toString()]);
  expectAudit(s2, "Exceeded Budget", false);

  // --- 시나리오 3: 미등록 판매자 (Push #2) ---
  const s3 = await run("시나리오 3: AI 요청 UnlistedMarket 65,000원", vaultAsAgent, "requestSpend", [m.UnlistedMarket, won(65_000), (base + 3n).toString()]);
  expectAudit(s3, "Unregistered Merchant", false);

  const logCount = await vaultAsOwner.auditLogCount().call();
  const run_ = { ranAt: new Date().toISOString(), requestIdBase: base.toString(), auditLogCount: logCount.toString(), steps };
  deployment.demoRuns = [...(deployment.demoRuns || []), run_];
  saveDeployment(deployment);

  const row = (s, name) => `| ${name} | ${s.audit ? s.audit.reason : "-"} | \`${s.txId}\` | ${s.url} |`;
  console.log(`
모든 판정이 기대값과 일치합니다. (온체인 감사 기록 ${logCount}건, deployments/nile.json 에 저장)

## On-Chain Demo Proof (TRON Nile)

Contract: [\`${deployment.address}\`](${contractUrl(deployment.address)})

| Scenario | On-chain verdict (AuditRecorded) | Tx Hash | Tronscan |
| --- | --- | --- | --- |
${row(s1, "1. 정상 결제 요청 87,000원")}
${row(s1b, "1. 사용자 승인 → 송금")}
${row(s2, "2. 예산 초과 103,000원 (Push #1)")}
${row(s3, "3. 미등록 판매자 65,000원 (Push #2)")}
`);
}

main().catch((err) => {
  console.error(`\n[demo_nile] ${err.message}`);
  process.exit(1);
});
