/**
 * AgentGuardVault 단위·E2E 테스트 (오프라인, 인메모리 EVM)
 *
 * TVM 과 opcode 의미가 같은 범위(evmVersion=paris)의 bytecode 를 로컬 VM 에서 실행해
 * 컨트랙트 로직을 검증한다. 실제 TRON 동작은 `npm run deploy` / `npm run demo` 로 Nile 에서 확인한다.
 *
 * 데모 시나리오를 그대로 재현한다. 금액은 1원 = 1 sun 으로 환산한다.
 *   정책: 예산 100,000원(수수료 포함, 누적), 기한 오늘 안, 사용자 승인 필요
 *   1) 허용 판매자 87,000원  → Pending → 사용자 approveSpend 서명 → 송금 & "Approved" 기록
 *   2) 98,000 + 5,000 = 103,000원 → "Exceeded Budget" 차단 (revert 없이 AuditRecorded) [Push #1]
 *   3) 미등록 판매자 65,000원 → "Unregistered Merchant" 차단 (revert 없이 AuditRecorded) [Push #2]
 *   +) 긴급 중지(Pausable, 오너·가디언) → "Emergency Paused" 차단 기록, 승인 불가, 해제 후 복구
 *
 * 실행: npm run compile && npm test
 */
const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const { ethers } = require("ethers");
const { VM } = require("@ethereumjs/vm");
const { Common, Chain, Hardfork } = require("@ethereumjs/common");
const { Block } = require("@ethereumjs/block");
const { Account, Address, hexToBytes, bytesToHex } = require("@ethereumjs/util");

const ARTIFACT_PATH = path.join(__dirname, "..", "build", "AgentGuardVault.json");
if (!fs.existsSync(ARTIFACT_PATH)) {
  console.error("build/AgentGuardVault.json 이 없습니다. 먼저 'npm run compile' 을 실행하세요.");
  process.exit(1);
}
const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));
const iface = new ethers.Interface(artifact.abi);
const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Paris });

const KRW = 1n; // 1원 = 1 sun
const won = (n) => BigInt(n) * KRW;

const newWallet = () => ethers.Wallet.createRandom().address.toLowerCase();
const user = newWallet(); // 오너 = 사람(최종 승인·긴급 중지 해제)
const aiAgent = newWallet();
const guardian = newWallet(); // 긴급 중지만 가능
const keyboardLab = newWallet(); // 허용 판매자
const techStore = newWallet(); // 허용 판매자
const unknownShop = newWallet(); // 미등록 판매자
const stranger = newWallet();

let vm;
let vault;
let now = 1_790_000_000n; // 2026-09-21 경
let nextRequestId = 1n;

const toAddr = (hex) => Address.fromString(hex);

async function rawCall(from, to, data, value = 0n) {
  return vm.evm.runCall({
    caller: toAddr(from),
    to: to ? toAddr(to) : undefined,
    data: hexToBytes(data),
    value,
    gasLimit: 10_000_000n,
    block: Block.fromBlockData({ header: { timestamp: now, gasLimit: 30_000_000n } }, { common }),
  });
}

/** 트랜잭션 호출. revert 시 { ok:false, error:'<CustomErrorName>' } */
async function send(from, fn, args = [], value = 0n) {
  const res = await rawCall(from, vault, iface.encodeFunctionData(fn, args), value);
  if (res.execResult.exceptionError) {
    const data = bytesToHex(res.execResult.returnValue);
    let error = data;
    try {
      error = iface.parseError(data)?.name ?? data;
    } catch {}
    return { ok: false, error };
  }
  const logs = res.execResult.logs.map(([, topics, data]) =>
    iface.parseLog({ topics: topics.map(bytesToHex), data: bytesToHex(data) })
  );
  return { ok: true, result: iface.decodeFunctionResult(fn, res.execResult.returnValue), logs };
}

async function read(fn, args = []) {
  const res = await send(user, fn, args);
  assert.ok(res.ok, `${fn}() 조회 실패: ${res.error}`);
  return res.result.length === 1 ? res.result[0] : res.result;
}

async function balanceOf(addr) {
  const acc = await vm.stateManager.getAccount(toAddr(addr));
  return acc ? acc.balance : 0n;
}

async function lastAudit() {
  const logs = await read("getAuditLogs");
  return logs[logs.length - 1];
}

/** AI 에이전트의 결제 요청 → { res, requestId } */
async function agentRequests(merchant, amount) {
  const requestId = nextRequestId++;
  const res = await send(aiAgent, "requestSpend", [merchant, amount, requestId]);
  assert.ok(res.ok, `requestSpend 가 revert 됨 (${res.error}) — 차단은 revert 가 아니라 기록이어야 함`);
  return { res, requestId };
}

function assertAudit(record, { requestId, merchant, amount, isApproved, reason }) {
  assert.equal(record.requestId, requestId);
  assert.equal(record.merchant.toLowerCase(), merchant);
  assert.equal(record.amount, amount);
  assert.equal(record.isApproved, isApproved);
  assert.equal(record.reason, reason);
  assert.equal(record.timestamp, now);
}

before(async () => {
  vm = await VM.create({ common });
  for (const acc of [user, aiAgent, guardian, stranger]) {
    await vm.stateManager.putAccount(toAddr(acc), new Account(0n, ethers.parseEther("100")));
  }
  const encode = (agent, guard) => ethers.AbiCoder.defaultAbiCoder().encode(["address", "address"], [agent, guard]).slice(2);

  // 오너가 자기 자신을 AI 에이전트로 지정하면 배포 자체가 실패해야 한다 (AI 자기 승인 방지).
  const selfAgent = await rawCall(user, null, "0x" + artifact.bytecode + encode(user, guardian));
  assert.ok(selfAgent.execResult.exceptionError, "오너 = AI 에이전트 배포는 revert 되어야 함");

  const res = await rawCall(user, null, "0x" + artifact.bytecode + encode(aiAgent, guardian));
  assert.ok(!res.execResult.exceptionError, `배포 실패: ${res.execResult.exceptionError?.error}`);
  vault = res.createdAddress.toString();

  // 사용자 지시: "승인된 전자제품 판매자에서 10만원 이하의 키보드를 오늘 안에 구매해. 결제 전에는 반드시 나에게 승인을 받아."
  const deadline = now + 12n * 60n * 60n;
  assert.ok((await send(user, "setPolicy", [won(100_000), deadline, true])).ok);
  assert.ok((await send(user, "setMerchant", [keyboardLab, true])).ok);
  assert.ok((await send(user, "setMerchant", [techStore, true])).ok);
  assert.ok((await send(user, "deposit", [], won(1_000_000))).ok);
});

test("정책·권한 설정이 온체인에 반영된다", async () => {
  const policy = await read("currentPolicy");
  assert.equal(policy.budget, won(100_000));
  assert.equal(policy.requireHumanApproval, true);
  assert.equal(await read("approvedMerchants", [keyboardLab]), true);
  assert.equal(await read("approvedMerchants", [unknownShop]), false);
  assert.equal((await read("owner")).toLowerCase(), user);
  assert.equal((await read("aiAgent")).toLowerCase(), aiAgent);
  assert.equal((await read("guardian")).toLowerCase(), guardian);
  assert.equal(await balanceOf(vault), won(1_000_000));

  // 오너 권한을 AI 에이전트에게 넘기거나, 오너를 에이전트로 지정할 수 없다.
  assert.equal((await send(user, "transferOwnership", [aiAgent])).error, "AgentMustNotBeOwner");
  assert.equal((await send(user, "setAiAgent", [user])).error, "AgentMustNotBeOwner");

  // AI 는 정책을 바꿀 수 없다.
  assert.equal((await send(aiAgent, "setPolicy", [won(10_000_000), now + 999n, false])).error, "OwnableUnauthorizedAccount");
  assert.equal((await send(aiAgent, "setMerchant", [unknownShop, true])).error, "OwnableUnauthorizedAccount");
  // 에이전트가 아닌 주소는 결제 요청 자체가 불가 (기록도 남지 않음)
  assert.equal((await send(stranger, "requestSpend", [keyboardLab, won(1_000), 999n])).error, "NotAiAgent");
});

test("시나리오 1: 허용 판매자 87,000원 → 사용자 승인 후 결제 성공 & Approved 기록", async () => {
  const amount = won(87_000);
  const merchantBefore = await balanceOf(keyboardLab);

  // 1) AI 요청 → 정책 통과 → 사용자 승인 대기 (아직 송금 안 됨)
  const { res, requestId } = await agentRequests(keyboardLab, amount);
  assert.equal(res.result[0], false, "승인 전에는 송금되지 않아야 함");
  assert.equal(await balanceOf(keyboardLab), merchantBefore);
  assertAudit(await lastAudit(), { requestId, merchant: keyboardLab, amount, isApproved: false, reason: "Pending Human Approval" });

  // AI 에이전트나 제3자는 스스로 승인할 수 없다.
  assert.equal((await send(aiAgent, "approveSpend", [requestId])).error, "OwnableUnauthorizedAccount");
  assert.equal((await send(stranger, "approveSpend", [requestId])).error, "OwnableUnauthorizedAccount");

  // 2) 사용자 최종 승인 → 판매자에게 송금 (이 트랜잭션의 해시가 테스트넷 결제 영수증)
  now += 60n;
  const approval = await send(user, "approveSpend", [requestId]);
  assert.ok(approval.ok, `승인 실패: ${approval.error}`);
  assert.equal(approval.result[0], true);
  assert.equal(await balanceOf(keyboardLab), merchantBefore + amount);
  assert.equal(await read("policySpent"), amount);
  assert.equal(await read("remainingBudget"), won(13_000));
  assertAudit(await lastAudit(), { requestId, merchant: keyboardLab, amount, isApproved: true, reason: "Approved" });

  const executed = approval.logs.find((l) => l.name === "SpendExecuted");
  assert.ok(executed, "SpendExecuted 이벤트(영수증)가 있어야 함");
  assert.equal(executed.args.requestId, requestId);
  assert.equal(executed.args.amount, amount);

  // 같은 요청을 두 번 승인하거나, 같은 requestId 로 다시 요청할 수 없다.
  assert.equal((await send(user, "approveSpend", [requestId])).error, "RequestNotPending");
  assert.equal((await send(aiAgent, "requestSpend", [keyboardLab, amount, requestId])).error, "DuplicateRequestId");
});

/** 차단이 revert 없이 AuditRecorded 이벤트로 남았는지 검증 (심사 요건: Not silent, logged) */
function assertAuditEvent(res, { requestId, reason }) {
  const ev = res.logs.find((l) => l.name === "AuditRecorded");
  assert.ok(ev, "차단도 AuditRecorded 이벤트가 발생해야 함");
  assert.equal(ev.args.requestId, requestId);
  assert.equal(ev.args.isApproved, false);
  assert.equal(ev.args.reason, reason);
  assert.equal(res.logs.some((l) => l.name === "SpendExecuted"), false, "차단 건은 송금 이벤트가 없어야 함");
}

test("시나리오 2 [Push #1]: 98,000 + 수수료 5,000 = 103,000원 → 예산 초과 차단 & 온체인 감사 로그", async () => {
  await send(user, "setPolicy", [won(100_000), now + 12n * 60n * 60n, true]); // 새 구매 건: 누적 지출 초기화
  const amount = won(98_000) + won(5_000);
  const vaultBefore = await balanceOf(vault);
  const logCountBefore = await read("auditLogCount");

  const { res, requestId } = await agentRequests(keyboardLab, amount);
  assert.equal(res.result[0], false);
  assert.equal(await balanceOf(vault), vaultBefore, "차단된 결제는 송금되지 않아야 함");
  assert.equal(await read("auditLogCount"), logCountBefore + 1n, "차단도 감사 기록으로 남아야 함");
  assertAudit(await lastAudit(), { requestId, merchant: keyboardLab, amount, isApproved: false, reason: "Exceeded Budget" });
  assertAuditEvent(res, { requestId, reason: "Exceeded Budget" });

  // 차단된 요청은 승인 대기 목록에 들어가지 않으므로 사용자가 실수로 승인할 수도 없다.
  assert.equal((await send(user, "approveSpend", [requestId])).error, "RequestNotPending");
});

test("시나리오 3 [Push #2]: 미등록 판매자 65,000원 → 판매자 조건 위반 차단 & 온체인 감사 로그", async () => {
  const amount = won(65_000);
  const vaultBefore = await balanceOf(vault);

  const { res, requestId } = await agentRequests(unknownShop, amount);
  assert.equal(res.result[0], false);
  assert.equal(await balanceOf(vault), vaultBefore);
  assert.equal(await balanceOf(unknownShop), 0n);
  assertAudit(await lastAudit(), { requestId, merchant: unknownShop, amount, isApproved: false, reason: "Unregistered Merchant" });
  assertAuditEvent(res, { requestId, reason: "Unregistered Merchant" });
});

test("예산은 누적으로 적용되고, 사용자 거절·기한 만료도 사유와 함께 기록된다", async () => {
  await send(user, "setPolicy", [won(100_000), now + 60n * 60n, false]); // 승인 불필요 정책

  // 승인 불필요 → 즉시 송금
  const first = await agentRequests(techStore, won(87_000));
  assert.equal(first.res.result[0], true);
  assertAudit(await lastAudit(), { requestId: first.requestId, merchant: techStore, amount: won(87_000), isApproved: true, reason: "Approved" });

  // 단건은 예산 이내지만 누적 107,000원 → 차단 (AI 가 여러 번 나눠 결제하는 우회 방지)
  const split = await agentRequests(techStore, won(20_000));
  assertAudit(await lastAudit(), { requestId: split.requestId, merchant: techStore, amount: won(20_000), isApproved: false, reason: "Exceeded Budget" });

  // 사용자 거절
  await send(user, "setPolicy", [won(100_000), now + 60n * 60n, true]);
  const rejected = await agentRequests(keyboardLab, won(50_000));
  assert.ok((await send(user, "rejectSpend", [rejected.requestId])).ok);
  assertAudit(await lastAudit(), { requestId: rejected.requestId, merchant: keyboardLab, amount: won(50_000), isApproved: false, reason: "Rejected by User" });

  // 승인 대기 중 기한이 지나면, 승인 시점 재검사에서 차단된다.
  const late = await agentRequests(keyboardLab, won(30_000));
  now += 2n * 60n * 60n;
  const approval = await send(user, "approveSpend", [late.requestId]);
  assert.ok(approval.ok);
  assert.equal(approval.result[0], false);
  assertAudit(await lastAudit(), { requestId: late.requestId, merchant: keyboardLab, amount: won(30_000), isApproved: false, reason: "Policy Expired" });

  // 기한 이후 새 요청도 차단
  const expired = await agentRequests(keyboardLab, won(10_000));
  assertAudit(await lastAudit(), { requestId: expired.requestId, merchant: keyboardLab, amount: won(10_000), isApproved: false, reason: "Policy Expired" });
});

test("긴급 중지: 중지 중 AI 요청은 차단 기록되고 승인도 불가, 해제 후 정상 복구된다", async () => {
  await send(user, "setPolicy", [won(100_000), now + 12n * 60n * 60n, true]);
  const pending = await agentRequests(keyboardLab, won(40_000)); // 중지 전 들어온 승인 대기 건

  assert.equal((await send(aiAgent, "emergencyPause")).error, "NotOwnerOrGuardian", "AI 는 중지/해제 권한이 없음");
  assert.equal((await send(stranger, "emergencyPause")).error, "NotOwnerOrGuardian");
  assert.ok((await send(guardian, "emergencyPause")).ok, "가디언은 긴급 중지할 수 있음");
  assert.equal((await send(guardian, "unpauseVault")).error, "OwnableUnauthorizedAccount", "가디언은 해제할 수 없음");
  assert.ok((await send(user, "unpauseVault")).ok);
  assert.ok((await send(user, "emergencyPause")).ok, "오너도 긴급 중지할 수 있음");
  assert.equal(await read("paused"), true);

  const vaultBefore = await balanceOf(vault);
  const blocked = await agentRequests(keyboardLab, won(10_000));
  assert.equal(blocked.res.result[0], false);
  assertAudit(await lastAudit(), { requestId: blocked.requestId, merchant: keyboardLab, amount: won(10_000), isApproved: false, reason: "Emergency Paused" });
  assert.equal((await send(user, "approveSpend", [pending.requestId])).error, "EnforcedPause", "중지 중에는 승인 송금도 불가");
  assert.equal(await balanceOf(vault), vaultBefore, "중지 중에는 어떤 송금도 일어나지 않아야 함");

  assert.equal((await send(aiAgent, "unpauseVault")).error, "OwnableUnauthorizedAccount");
  assert.ok((await send(user, "unpauseVault")).ok);
  assert.equal(await read("paused"), false);

  // 해제 후: 중지 전 대기 건 승인 가능, 새 요청도 정상 처리
  const approval = await send(user, "approveSpend", [pending.requestId]);
  assert.equal(approval.result[0], true);
  assertAudit(await lastAudit(), { requestId: pending.requestId, merchant: keyboardLab, amount: won(40_000), isApproved: true, reason: "Approved" });
});

test("감사 타임라인: 제3자가 기록만으로 전체 판정 흐름을 재구성할 수 있다", async () => {
  const logs = await read("getAuditLogs");
  const count = await read("auditLogCount");
  assert.equal(BigInt(logs.length), count);

  const reasons = logs.map((l) => l.reason);
  for (const reason of [
    "Pending Human Approval",
    "Approved",
    "Exceeded Budget",
    "Unregistered Merchant",
    "Rejected by User",
    "Policy Expired",
    "Emergency Paused",
  ]) {
    assert.ok(reasons.includes(reason), `타임라인에 "${reason}" 기록이 있어야 함`);
  }

  // 시간순(append-only) 보장
  for (let i = 1; i < logs.length; i++) assert.ok(logs[i].timestamp >= logs[i - 1].timestamp);

  // 실제 송금 합계 = Approved 기록 합계 (기록과 자금 흐름이 일치)
  const approvedTotal = logs.filter((l) => l.isApproved).reduce((sum, l) => sum + l.amount, 0n);
  const paidOut = (await balanceOf(keyboardLab)) + (await balanceOf(techStore)) + (await balanceOf(unknownShop));
  assert.equal(approvedTotal, paidOut);
  assert.equal(await balanceOf(vault), won(1_000_000) - paidOut);

  // 구간 조회
  const page = await read("getAuditLogsRange", [1n, 2n]);
  assert.equal(page.length, 2);
  assert.equal(page[0].requestId, logs[1].requestId);
  assert.equal((await read("getAuditLogsRange", [count, 10n])).length, 0);
});

test("오너는 테스트 자금을 회수할 수 있고, 오너 권한은 포기할 수 없다", async () => {
  const before = await balanceOf(stranger);
  assert.equal((await send(aiAgent, "withdraw", [aiAgent, won(1)])).error, "OwnableUnauthorizedAccount");
  assert.ok((await send(user, "withdraw", [stranger, won(1_000)])).ok);
  assert.equal(await balanceOf(stranger), before + won(1_000));
  assert.equal((await send(user, "renounceOwnership")).error, "OwnershipRenounceDisabled");
});
