# 팀원 현장 셋업과 문제 해결 (2026-09-28 기준)

> 조원이 자기 노트북에서 AgentGuard를 띄우고 Sepolia 기록까지 재현하기 위한 문서다.
> 오늘 실제로 막혔던 문제와 해결법을 그대로 적었다. 대회 필수 요건은 [`HACKATHON_RULES.md`](HACKATHON_RULES.md)를 본다.

## 1. 오늘 바뀐 것 (먼저 읽기)

| 시각 (KST) | 커밋 | 내용 |
|---|---|---|
| 18:31 | `ee7c5b5` | **레포 구조 변경**: AgentGuard가 `agentguard/` 폴더로 이동하고 `TRON/` 폴더가 추가됨. 모든 명령은 `cd agentguard` 후 실행 |
| 18:48 | `ca3925d` | 서버 `.env` 로딩 버그 수정, 앵커 수신 주소를 소각 주소로 변경, Sepolia 자동 전환, 검사 후 자동 스크롤 제거, README 온체인 증빙 추가 |
| 이후 | 이 문서 커밋 | 승인·거절 후 자동 스크롤 제거, `.env.example`에 공개 RPC 기본값, 팀 문서 정리 |

## 2. 처음 받는 방법

```bash
git clone https://github.com/daoulee/agentguard-gwdc-2026.git
cd agentguard-gwdc-2026
git switch <내 브랜치>          # Taehoon / dongkyo
git merge origin/main            # 오늘 구조 변경·버그 수정 반영
cd agentguard
npm install
cp .env.example .env             # RPC_URL은 이미 채워져 있음
npm run dev                      # web :5173 + server :8787
```

- 레포는 Private다. 초대를 수락하지 않았다면 clone이 안 된다 (레포 주인이 Settings → Collaborators에서 초대).
- 폴더 이동 전에 받은 브랜치는 `git merge origin/main`으로 이동이 자동 반영된다. 충돌이 나면 혼자 해결하지 말고 공유한다.

## 3. `.env` 항목

`agentguard/.env` 하나만 쓴다. **절대 커밋하지 않는다** (`.gitignore` 적용됨).

| 변수 | 값 | 상태 |
|---|---|---|
| `RPC_URL` | `https://ethereum-sepolia-rpc.publicnode.com` | ✅ 키 없이 동작 확인 |
| `CHAIN_ID` | `11155111` | ✅ |
| `KILN_API_URL`, `KILN_API_KEY` | 팀장 로컬 `.env`에만 있음 (값 공유는 채팅이 아닌 직접 전달) | ✅ 9/28 연결 확인 |
| `KILN_MODEL` | `qwen3-32b` | 수령 후 `node --env-file=.env scripts/check-kiln.mjs`로 확인 |

확인 명령:

```bash
node --env-file=.env scripts/check-chain.mjs <내 0x 지갑주소>   # chainId·잔액
curl -s localhost:8787/api/chain/status                          # "configured":true 여야 함
curl -s localhost:8787/api/ai/status                             # 키 넣으면 "Kiln · qwen3-32b"
```

## 4. MetaMask + Sepolia 준비

1. metamask.io/ko에서 크롬 확장을 설치하고 지갑을 만든다. **복구 문구 12단어는 종이에만** 적는다 (캡처·채팅·파일 금지).
2. 네트워크 선택 → "테스트 네트워크 보기" 켜기 → **Sepolia**를 선택한다.
3. 테스트 ETH는 **Google Cloud Web3 Faucet**에서 받는다: https://cloud.google.com/application/web3/faucet/ethereum/sepolia (구글 로그인, 0.05 ETH/일). 한 번 기록할 때 수수료는 약 0.0001 ETH다.
4. 앱 감사 로그 → **지갑으로 해시 기록** → MetaMask 팝업에서 아래를 확인하고 컨펌한다.
   - 네트워크 Sepolia · 수신 `0x0000…dEaD` · 금액 0 ETH
5. 확정 후 **확정 거래 검증**을 누른다. 영수증에 Etherscan 링크가 연결되면 성공이다.

## 5. 오늘 겪은 문제와 해결

| 증상 | 원인 | 해결 |
|---|---|---|
| 화면에 "요청을 처리하지 못했습니다" | 폴더 이동 **전에** 띄운 옛 서버가 8787 포트를 계속 점유해서, 새 `npm run dev`의 서버가 뜨지 못함 | 옛 프로세스 종료: `lsof -nP -iTCP:8787 -sTCP:LISTEN`으로 PID 확인 → `kill <PID>` → `npm run dev` 재시작 |
| `.env`에 값을 넣어도 "Sepolia RPC 설정 필요", "Safe fallback parser" | 서버가 `apps/server/` 기준으로 `.env`를 찾아 루트 `.env`를 무시함 (**코드 버그**) | `ca3925d`에서 수정. 서버가 `agentguard/.env`를 명시적으로 읽음 |
| "지갑 네트워크를 Ethereum Sepolia로 바꿔주세요" | MetaMask가 메인넷에 있음 | 이제 버튼을 누르면 Sepolia 전환 팝업이 뜬다. 또는 MetaMask에서 직접 Sepolia 선택 |
| "테스트넷 거래를 제출하지 못했습니다" | MetaMask는 **자기 주소로 데이터를 담아 보내는 dApp 거래를 거부**함. 기존 코드가 그 방식이었음 | 수신 주소를 소각 주소 `0x…dEaD`로 변경. 서버 검증도 소각 주소 기준. 이제 실패하면 지갑 오류 원문이 표시됨 |
| 팝업이 TronLink로 뜨거나 계속 실패 | TronLink도 `window.ethereum`을 주입해 MetaMask와 충돌할 수 있음 | `chrome://extensions`에서 TronLink를 잠시 끈다 |
| `gpg --recv-keys` → `No route to host` (TRON 쪽 작업) | 행사장 네트워크가 키서버 포트를 차단 | `curl "https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x<지문>" \| gpg --import` |

## 6. 온체인 증빙 현황

| Tx | 시각 | 용도 |
|---|---|---|
| [`0x9d237b35…7035e9`](https://sepolia.etherscan.io/tx/0x9d237b357c1b300ea37b1e331049b285b6744afef3c03ccc9d952a617c7035e9) | 9/28 18:44 | 연결 검증. 블록 11799693, success, 앱 감사 로그에 `audit-anchor`로 연결 확인 |

**대회 시작(9/28 20:00) 전 거래라서, 최종 데모 후 한 번 더 기록해서 README 증빙 표에 추가한다.**

## 7. TRON (Nile) 관련 메모

AgentGuard 제출에는 필요 없다. 별도 TRON 트랙은 `../TRON/`에서 진행한다.

- 지갑: TronLink, Nile Testnet. 공개 API `https://nile.trongrid.io`는 키 없이 동작한다.
- FullNode는 운영할 필요가 없다 (스냅샷이 수십 GB).
- Faucet에서 토큰(USDT·BTT 등)은 받았지만 **TRX는 0**이다. 수수료는 TRX(또는 Energy)로만 낼 수 있으니 TRX를 따로 받아야 한다.
