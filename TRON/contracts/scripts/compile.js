/**
 * contracts/*.sol 을 solc(npm)로 컴파일하고 산출물을 build/ 에 저장한다.
 *
 * - @openzeppelin/* 등 import 는 node_modules 에서 해석
 * - 컨트랙트마다 build/<ContractName>.json { contractName, abi, bytecode, ... } 생성
 *   (AgentGuardVault → build/AgentGuardVault.json)
 * - bytecode 는 0x 접두어 없는 hex (TronWeb 은 그대로, ethers/로컬 VM 은 '0x' 를 붙여 사용)
 *
 * TVM 호환: TVM 은 최신 EVM 하드포크 opcode(PUSH0/MCOPY/TSTORE) 지원이 늦을 수 있으므로
 * 기본 evmVersion 을 "paris" 로 고정한다. 로컬 테스트 VM(Paris)도 같은 bytecode 를 실행한다.
 * 필요 시 SOLC_EVM_VERSION 환경변수로 변경.
 */
require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const ROOT = path.resolve(__dirname, "..");
const CONTRACTS_DIR = path.join(ROOT, "contracts");
const BUILD_DIR = path.join(ROOT, "build");
const NODE_MODULES = path.join(ROOT, "node_modules");

const EVM_VERSION = process.env.SOLC_EVM_VERSION || "paris";
const OPTIMIZER_RUNS = Number(process.env.SOLC_OPTIMIZER_RUNS || 200);

// 배포 스크립트가 의존하는 산출물. 없으면 경고한다.
const EXPECTED_ARTIFACTS = ["AgentGuardVault"];

function collectSources() {
  if (!fs.existsSync(CONTRACTS_DIR)) return {};
  const sources = {};
  for (const file of fs.readdirSync(CONTRACTS_DIR)) {
    if (!file.endsWith(".sol")) continue;
    // 소스 키를 "contracts/<file>" 로 두어 상대 import 가 자연스럽게 해석되게 한다.
    sources[`contracts/${file}`] = {
      content: fs.readFileSync(path.join(CONTRACTS_DIR, file), "utf8"),
    };
  }
  return sources;
}

function findImports(importPath) {
  // 프로젝트 루트 밖의 파일(예: "../../.env")은 읽지 않는다.
  const candidates = [path.resolve(ROOT, importPath), path.resolve(NODE_MODULES, importPath)];
  for (const p of candidates) {
    if (!p.startsWith(ROOT + path.sep)) continue;
    if (fs.existsSync(p)) return { contents: fs.readFileSync(p, "utf8") };
  }
  return { error: `File not found: ${importPath}` };
}

function main() {
  const sources = collectSources();
  if (Object.keys(sources).length === 0) {
    console.error(`No .sol files found in ${CONTRACTS_DIR}`);
    process.exit(1);
  }

  const input = {
    language: "Solidity",
    sources,
    settings: {
      evmVersion: EVM_VERSION,
      optimizer: { enabled: true, runs: OPTIMIZER_RUNS },
      outputSelection: {
        "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] },
      },
    },
  };

  console.log(`solc ${solc.version()} | evmVersion=${EVM_VERSION} | runs=${OPTIMIZER_RUNS}`);
  console.log(`Compiling: ${Object.keys(sources).join(", ")}`);

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

  const errors = (output.errors || []).filter((e) => e.severity === "error");
  for (const e of output.errors || []) {
    (e.severity === "error" ? console.error : console.warn)(e.formattedMessage);
  }
  if (errors.length > 0) {
    console.error(`Compilation failed with ${errors.length} error(s).`);
    process.exit(1);
  }

  // 이름이 바뀌거나 삭제된 컨트랙트의 오래된 산출물이 남지 않도록 정리한다.
  // (배포 스크립트가 남긴 export 파일 등 컴파일 산출물이 아닌 JSON 은 보존)
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  for (const f of fs.readdirSync(BUILD_DIR)) {
    if (!f.endsWith(".json")) continue;
    const file = path.join(BUILD_DIR, f);
    try {
      const json = JSON.parse(fs.readFileSync(file, "utf8"));
      if (json.contractName && json.bytecode !== undefined && json.compiler) fs.unlinkSync(file);
    } catch {
      // 파싱 불가한 파일은 건드리지 않는다.
    }
  }

  const written = [];
  for (const sourceName of Object.keys(sources)) {
    const contracts = output.contracts[sourceName] || {};
    for (const [contractName, c] of Object.entries(contracts)) {
      // interface / abstract contract 는 bytecode 가 비어 있으므로 건너뛴다.
      if (!c.evm.bytecode.object) continue;
      // 외부 라이브러리 링크가 필요한 bytecode 는 그대로 배포하면 실패한다.
      if (c.evm.bytecode.object.includes("__$")) {
        console.error(`${contractName}: bytecode has unlinked library placeholders; linking is not supported.`);
        process.exit(1);
      }
      const artifact = {
        contractName,
        sourceName,
        abi: c.abi,
        bytecode: c.evm.bytecode.object,
        deployedBytecode: c.evm.deployedBytecode.object,
        compiler: { version: solc.version(), evmVersion: EVM_VERSION, optimizerRuns: OPTIMIZER_RUNS },
      };
      const outFile = path.join(BUILD_DIR, `${contractName}.json`);
      fs.writeFileSync(outFile, JSON.stringify(artifact, null, 2));
      written.push(path.relative(ROOT, outFile));
    }
  }

  written.forEach((f) => console.log(`  -> ${f}`));
  for (const name of EXPECTED_ARTIFACTS) {
    if (!written.some((f) => path.basename(f) === `${name}.json`)) {
      console.warn(`Warning: ${name} contract not found; build/${name}.json was not generated.`);
    }
  }
  console.log("Compilation succeeded.");
}

main();
