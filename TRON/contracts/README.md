# AgentGuard × TRON — 온체인 지출 방화벽 금고 (Nile 테스트넷)

> 담당: 태훈 (TRON 트랙 · 스마트 컨트랙트)
> 상태: **Nile 테스트넷 배포 완료 + 데모 3종 온체인 실행 완료** (2026-09-28)

AI 에이전트가 돈을 쓰려면 이 금고에 **"요청"** 만 할 수 있고, 허용·차단은 **컨트랙트 코드**가 결정합니다.
차단된 요청도 revert 하지 않고 **온체인 감사 기록(블랙박스)** 으로 남기 때문에, 심사위원·제3자가 Tronscan 만 보고 판정 근거를 검증할 수 있습니다.

---

## 1. 한눈에 보기

```
AI 에이전트 ──requestSpend(판매자, 금액, requestId)──▶ AgentGuardVault (TRON Nile)
                                                      │ 코드로 검사: 긴급중지 → 기한 → 판매자 → 누적예산 → 잔고
                                                      ├─ 위반  → 차단 기록 (revert 없음, AuditRecorded 이벤트)
                                                      └─ 통과  → Pending 기록 → 사용자 approveSpend 서명 → 판매자에게 TRX 송금
```

| 역할 | 할 수 있는 것 | 할 수 없는 것 |
| --- | --- | --- |
| **오너(사용자)** | 정책 설정, 판매자 등록, 최종 승인/거절, 긴급 중지·해제, 자금 회수 | — |
| **AI 에이전트** | 결제 **요청**만 | 승인, 정책 변경, 중지 해제 (오너와 같은 주소로 지정하는 것도 컨트랙트가 거부) |
| **가디언** | 긴급 중지 | 해제, 승인 |

---

## 2. 온체인 증빙 (On-Chain Verification Proof)

| Item | Value |
| --- | --- |
| Network | TRON Nile Testnet |
| Contract | `TMMGEzkAEE6cnG5hWmcmMPwYSZ8MhpgxKZ` |
| Deploy Tx Hash | `4166d83dff42feb499869e003763893d0ecb8ecb6973295a5c2212bcbf267f39` |
| Tronscan (contract) | https://nile.tronscan.org/#/contract/TMMGEzkAEE6cnG5hWmcmMPwYSZ8MhpgxKZ |
| Tronscan (deploy tx) | https://nile.tronscan.org/#/transaction/4166d83dff42feb499869e003763893d0ecb8ecb6973295a5c2212bcbf267f39 |

### 데모 시나리오 실거래 (정책: 예산 100,000원 · 기한 24h · 사용자 승인 필요, 1원 = 1 sun)

| 시나리오 | 온체인 판정 (AuditRecorded) | Tx |
| --- | --- | --- |
| 1. 허용 판매자 KeyboardLab 87,000원 요청 | Pending Human Approval | [497fb804…](https://nile.tronscan.org/#/transaction/497fb804b04ed9987c760439e955df9c2ad0bd2039a2f31e1b78e7e83a95135e) |
| 1. 사용자 approveSpend 서명 → 송금 | **Approved** (판매자 잔고 87,000 sun 확인) | [15189821…](https://nile.tronscan.org/#/transaction/15189821688a7592894e58331d83932d98a4584eaf1579802aefa51f99f2e906) |
| 2. TechStore 98,000 + 수수료 5,000 = 103,000원 | **Exceeded Budget** (송금 없음) | [aa3dc9ab…](https://nile.tronscan.org/#/transaction/aa3dc9ab85ebdd9c1483de27e35d7072f4ff5ac4151367415ebbbec5b78d41ee) |
| 3. 미등록 판매자 UnlistedMarket 65,000원 | **Unregistered Merchant** (송금 없음) | [610018de…](https://nile.tronscan.org/#/transaction/610018de5ec8077eb6ab18fcfdd7903b838c643188ccbc4f3b87a34b731585e8) |

전체 기록(판매자 주소, 에너지, 수수료 포함)은 [`deployments/nile.json`](deployments/nile.json) 에 있습니다.
Tronscan 에서 각 Tx 의 **Event Logs** 탭을 열면 `AuditRecorded(requestId, merchant, amount, isApproved, reason)` 를 직접 확인할 수 있습니다.

---

## 3. 지금까지 한 것

- **컨트랙트 [`contracts/AgentGuardVault.sol`](contracts/AgentGuardVault.sol)** (Solidity 0.8.20, OpenZeppelin 5.0 — Ownable2Step · Pausable · ReentrancyGuard)
  - 정책: `budget`(수수료 포함 **누적** 예산), `deadline`, `requireHumanApproval`
  - 판매자 화이트리스트 `approvedMerchants`
  - **비-revert 감사 로그**: 차단도 `auditLogs` 배열 + `AuditRecorded` 이벤트로 남기고 `false` 반환
    - revert 하면 로그까지 롤백되어 "왜 막혔는지"가 사라지기 때문
  - **2단계 결제**: 승인 필요 정책이면 `Pending` → 오너가 `approveSpend` 트랜잭션에 서명해야 송금. 승인 시점에 정책을 **다시 검사**(기한 만료·정책 변경·긴급중지면 차단)
  - 누적 예산: 99,000원씩 나눠 결제하는 식의 우회 차단. `setPolicy` 하면 누적액 0 으로 초기화
  - 중복 `requestId` 거부, 긴급 중지 중 요청도 `Emergency Paused` 로 기록
  - 오너 = AI 에이전트 금지 (배포·`setAiAgent`·`transferOwnership` 모두), 오너 권한 포기(`renounceOwnership`) 금지
- **테스트 [`test/AgentGuardVault.test.js`](test/AgentGuardVault.test.js)** — 8개 전부 통과
  - 인메모리 EVM 에서 같은 bytecode 실행 (Nile 없이 오프라인으로 빠르게 로직 검증)
  - 데모 3종 + 누적 예산 · 거절 · 기한 만료 · 긴급 중지(오너/가디언) · 감사 타임라인 재구성 · 권한 검사
- **스크립트** (`scripts/`)
  - `compile.js` — solc 0.8.20, `evmVersion=paris` (TVM 호환: PUSH0 등 최신 opcode 미사용)
  - `setup_agent.js` — AI 에이전트 전용 지갑 생성·충전 (오너와 분리)
  - `deploy_nile.js` — Nile 배포, 온체인 상태 재확인, 증빙/ABI 저장, README 용 Proof 블록 출력
  - `demo_nile.js` — 데모 3종을 Nile 실거래로 실행하고 영수증의 이벤트로 판정 자동 검증
  - `lib/tron.js` — 공용 헬퍼 (TronWeb 연결, Tx 확정 대기, 이벤트 디코딩)

---

## 4. 실행 방법

```bash
cd TRON/contracts
npm install
cp .env.example .env        # 값 채우기 (아래 참고)

npm run compile             # build/AgentGuardVault.json 생성
npm test                    # 단위 테스트 (네트워크 불필요)

npm run setup:agent         # AI 에이전트 지갑 생성·충전 (.env 에 자동 기록)
npm run deploy              # Nile 배포 → deployments/nile.json 갱신
npm run demo                # 데모 3종 온체인 실행
```

`.env` 항목 (자세한 설명은 [`.env.example`](.env.example)):

| 키 | 설명 |
| --- | --- |
| `NILE_RPC_URL` | `https://nile.trongrid.io` (메인넷 URL 은 스크립트가 거부) |
| `PRIVATE_KEY` | 오너(사용자) 지갑 개인키 |
| `GUARDIAN_ADDRESS` | 긴급 중지 전용 주소 (선택) |
| `AI_AGENT_ADDRESS` / `AI_AGENT_PRIVATE_KEY` | `npm run setup:agent` 가 채움 |

> ⚠️ `npm run deploy` 는 **새 컨트랙트**를 만듭니다. 위의 증빙 주소를 계속 쓰려면 다시 배포하지 말고 `npm run demo` 만 실행하세요.
> 데모를 다시 돌리기 전에 `npm run setup:agent` 로 에이전트 잔고를 채우세요 (50 TRX 미만이면 자동 충전).

비용 참고 (Nile, 에너지 가격 100 sun): 배포 약 195 TRX · 데모 1회 약 90 TRX (`requestSpend` 1건 ≈ 18 TRX).

---

## 5. 프론트엔드 연동

- `npm run deploy` 가 ABI + 주소를 `TRON/frontend/src/contracts/AgentGuardVault.json` 에 저장합니다.
  폴더가 아직 없으면 `build/AgentGuardVault_frontend_export.json` 에 저장됩니다 (지금은 이 상태).
- 주요 함수

| 용도 | 호출 |
| --- | --- |
| 감사 타임라인 | `getAuditLogs()` → `{requestId, merchant, amount, isApproved, reason, timestamp}[]` |
| 남은 예산 | `remainingBudget()` |
| 현재 정책 | `currentPolicy()` |
| 승인 대기 건 | `pendingRequests(requestId)` |
| 사용자 승인/거절 (TronLink 서명) | `approveSpend(requestId)` / `rejectSpend(requestId)` |
| 긴급 중지/해제 | `emergencyPause()` / `unpauseVault()` |

- `reason` 문자열: `Approved`, `Pending Human Approval`, `Rejected by User`, `Exceeded Budget`, `Unregistered Merchant`, `Policy Expired`, `Policy Changed`, `Insufficient Vault Balance`, `Emergency Paused`
- 금액 단위는 **sun** (1 TRX = 1,000,000 sun). 데모는 **1원 = 1 sun** 으로 환산.

---

## 6. 주의 · 알려진 제한

- **개인키 커밋 금지.** `.env` 는 `.gitignore` 에 있습니다. `deployments/nile.json` 에는 주소·Tx 해시만 있습니다.
- 로컬 테스트는 EVM(Paris) 기준입니다. TRON 고유 동작(에너지, 주소 형식)은 Nile 실거래(`npm run demo`)로 확인했습니다.
- 일부 네트워크(NAT64)에서 Node 가 `nile.trongrid.io` 의 IPv6 로 연결하다 멈추는 문제가 있어 스크립트가 IPv4 를 우선 사용합니다.
- 현재 가디언 주소는 오너와 같은 주소입니다 (필요하면 `setGuardian` 으로 분리).
- 결제 자산은 TRX(네이티브)입니다. USDT(TRC20)·GasFree 연동은 아직 없습니다.

---

## 7. 코드 출처 구분 (대회 규정)

TRON 트랙 규정상 기존 코드와 대회 기간 중 개발한 코드를 구분해 기재합니다.

| 구분 | 내용 |
| --- | --- |
| **대회 전 (~2026-09-28 20:00 KST 이전)** | 이 폴더의 현재 내용 전부 — 컨트랙트, 테스트, 스크립트, Nile 배포(2026-09-28 18:58 KST)와 데모 실행(19:06 KST) |
| **대회 중 (2026-09-28 20:00 KST 이후)** | 이후 커밋에서 이 표에 추가 |
