/**
 * Nile 스크립트 공용 헬퍼: .env 로딩, TronWeb 연결, 트랜잭션 확정 대기, 이벤트 디코딩.
 */
const dns = require("dns");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ quiet: true, path: path.resolve(__dirname, "..", "..", ".env") });
const { TronWeb } = require("tronweb");
const { ethers } = require("ethers");

// 일부 네트워크(NAT64)에서 nile.trongrid.io 의 IPv6 주소로 연결이 멈추는 문제가 있어 IPv4 를 우선한다.
dns.setDefaultResultOrder("ipv4first");

const ROOT = path.resolve(__dirname, "..", "..");
const ENV_PATH = path.join(ROOT, ".env");
const ARTIFACT_PATH = path.join(ROOT, "build", "AgentGuardVault.json");
const DEPLOYMENT_PATH = path.join(ROOT, "deployments", "nile.json");

const NETWORK = "nile";
const TRONSCAN = "https://nile.tronscan.org/#";
const SUN_PER_TRX = 1_000_000;

const POLL_INTERVAL_MS = 3000;
const POLL_ATTEMPTS = 40; // 최대 약 2분

function requireEnv(name) {
  const value = (process.env[name] || "").trim();
  if (!value || value.startsWith("your_")) throw new Error(`.env 의 ${name} 값이 설정되지 않았습니다.`);
  return value;
}

function normalizePrivateKey(value, name) {
  const key = value.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(key)) throw new Error(`${name} 는 64자리 hex 여야 합니다.`);
  return key;
}

function rpcUrl() {
  const url = requireEnv("NILE_RPC_URL");
  if (!/nile/i.test(url)) throw new Error(`NILE_RPC_URL 이 Nile 엔드포인트가 아닙니다: ${url} (메인넷 오배포 방지)`);
  return url;
}

/** 개인키로 연결된 TronWeb 과 그 주소(Base58) */
function connect(privateKeyEnvName) {
  const privateKey = normalizePrivateKey(requireEnv(privateKeyEnvName), privateKeyEnvName);
  const tronWeb = new TronWeb({ fullHost: rpcUrl(), privateKey });
  return { tronWeb, address: tronWeb.address.fromPrivateKey(privateKey) };
}

function loadArtifact() {
  if (!fs.existsSync(ARTIFACT_PATH)) {
    throw new Error("build/AgentGuardVault.json 이 없습니다. 먼저 'npm run compile' 을 실행하세요.");
  }
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));
  if (!Array.isArray(artifact.abi) || !/^[0-9a-f]+$/i.test(artifact.bytecode || "")) {
    throw new Error("아티팩트에 abi 또는 bytecode 가 올바르지 않습니다. 다시 컴파일하세요.");
  }
  return artifact;
}

function loadDeployment() {
  if (!fs.existsSync(DEPLOYMENT_PATH)) throw new Error("deployments/nile.json 이 없습니다. 먼저 'npm run deploy' 를 실행하세요.");
  return JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, "utf8"));
}

function saveDeployment(data) {
  fs.mkdirSync(path.dirname(DEPLOYMENT_PATH), { recursive: true });
  fs.writeFileSync(DEPLOYMENT_PATH, JSON.stringify(data, null, 2) + "\n");
}

/** Base58/41-hex TRON 주소 → ABI 인코딩용 20바이트 hex ('0x...') */
function toAbiAddress(tronWeb, value, name) {
  if (!tronWeb.isAddress(value)) throw new Error(`${name} 가 올바른 TRON 주소가 아닙니다: ${value}`);
  const hex21 = tronWeb.address.toHex(value).toLowerCase();
  if (!/^41[0-9a-f]{40}$/.test(hex21)) throw new Error(`${name} Hex 변환 결과가 올바르지 않습니다: ${hex21}`);
  return "0x" + hex21.slice(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hexToText = (hex) => (hex ? Buffer.from(hex, "hex").toString() : "");

/** 트랜잭션이 블록에 포함될 때까지 기다리고, 실패면 사유와 함께 throw */
async function waitForTx(tronWeb, txId) {
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    const info = await tronWeb.trx.getTransactionInfo(txId);
    if (info && info.id) {
      const result = info.receipt && info.receipt.result;
      // 일반 TRX 전송은 receipt.result 가 없고, 실패 시 info.result === 'FAILED'
      if (info.result === "FAILED" || (result && result !== "SUCCESS")) {
        throw new Error(`트랜잭션 실패 (${result || info.result}) ${hexToText(info.resMessage)} — ${txUrl(txId)}`);
      }
      return info;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`트랜잭션 확인 시간 초과: ${txUrl(txId)}`);
}

/** 트랜잭션 로그를 ABI 로 디코딩 */
function decodeLogs(abi, info) {
  const iface = new ethers.Interface(abi);
  return (info.log || []).flatMap((log) => {
    try {
      const parsed = iface.parseLog({ topics: log.topics.map((t) => "0x" + t), data: "0x" + (log.data || "") });
      return parsed ? [parsed] : [];
    } catch {
      return [];
    }
  });
}

const txUrl = (txId) => `${TRONSCAN}/transaction/${txId}`;
const contractUrl = (address) => `${TRONSCAN}/contract/${address}`;
const trx = (sun) => (Number(sun) / SUN_PER_TRX).toLocaleString("en-US", { maximumFractionDigits: 6 });

module.exports = {
  ROOT,
  ENV_PATH,
  DEPLOYMENT_PATH,
  NETWORK,
  SUN_PER_TRX,
  requireEnv,
  normalizePrivateKey,
  rpcUrl,
  connect,
  loadArtifact,
  loadDeployment,
  saveDeployment,
  toAbiAddress,
  waitForTx,
  decodeLogs,
  hexToText,
  txUrl,
  contractUrl,
  trx,
};
