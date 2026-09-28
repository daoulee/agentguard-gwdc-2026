# GWDC 2026 Challenge B — 필수 준수사항과 심사 기준

> 출처: 2026-09-28 현장 공지 슬라이드(타임스탬프는 슬라이드 영상 기준). 공식 브리프와 다르면 **공식 브리프가 우선**이다.
> 제출 전 이 문서의 체크리스트를 **전부** 확인한다. 하나라도 빠지면 실격이다.

## 1. 마감과 심사 방식

- **최종 마감: 2026-09-30(수) 12:00 정오.** 칼마감, 유예 시간 없음.
- **현장 대면 심사 없음** (01:20). 심사위원은 아래 4가지만 보고 채점한다.
  1. GitHub 레포
  2. README
  3. **3분 이내** 데모 영상
  4. 온체인 증빙 (Tx 해시 + 익스플로러 링크)
- 결론: **README와 영상에 안 보이면 없는 기능이다.**

## 2. 필수 제출 요건 — 미준수 시 실격 (01:04)

| # | 요건 | 증빙 방법 |
|---|---|---|
| R1 | **README 선언문 1문장**: 무엇을 만들었는지 정확히 한 문장 | README 상단 "선언한 기능" |
| R2 | **Kiln API 사용**: 에이전트가 실제로 Kiln 위에서 동작 | 실제 호출 화면, 모델명(`qwen3-32b`), 토큰 기록 |
| R3 | **온체인 트랜잭션 1건 이상**: 공개 테스트넷 또는 데브넷, 증빙 필수 | Tx 해시 + 익스플로러 링크를 README에 기재 |

네트워크는 Sepolia와 TRON Nile 중 무엇이든 괜찮다. "at least one on-chain transaction you can prove (testnet or devnet with proof)"라는 조건이라, **해시와 익스플로러 링크로 확인만 되면 통과**다.

## 3. Challenge B 데모 필수 요건 (00:58)

- **조건 변경 후 재실행(Re-run) 2회 이상**: 정책이나 조건을 바꿨을 때 동작이 어떻게 달라지는지 최소 2번 보여준다.
- **In scope 1건**: 정상 승인 1건
- **Out of scope 2건 이상 (Push #1, Push #2)**: 범위 밖 요청이 차단되는 장면
- **"each step recorded, not silent"**: 차단이 조용히 실패하면 안 된다. **각 단계와 차단 사유가 로그나 온체인에 기록**돼야 한다.

AgentGuard 매핑:

| 데모 요건 | AgentGuard 시나리오 | 기록 위치 |
|---|---|---|
| In scope | `keyboard-safe` → allow | 감사 로그 (해시 체인) |
| Push #1 | `keyboard-over-budget` + 수수료 5,000 → `budget_exceeded` | 감사 로그 + 차단 사유 |
| Push #2 | `keyboard-unknown-merchant` → `merchant_not_allowed` | 감사 로그 + 차단 사유 |
| Re-run ×2 | 정책 수정(예: 예산·판매자 변경) 후 같은 요청 재실행 → 판정 변화 | 새 정책 버전 + 감사 로그 |

## 4. 공식 배점 (100점, 01:36)

| 항목 | 배점 | 보는 것 | 우리가 보여줄 것 |
|---|---|---|---|
| Technical | **30** | Kiln과 온체인 연동, 조건 검증 | 실제 Kiln 호출, Tx 해시, 결정론적 정책 엔진 |
| Task fit | **25** | README 선언문과 챌린지 요구사항 일치도 | 선언문 1문장 ↔ 데모 장면 1:1 대응 |
| Innovation | **20** | AI 에이전트 관점의 참신성 | "AI는 제안, 코드가 판정, 사람이 승인" 경계 |
| Usability | **15** | 실제 사용자와 문제 해결 적합성 | 구체적 사용 장면, 승인 흐름 |
| Presentation | **10** | README와 데모 영상의 명확성 | 3분 영상, 증빙 링크 |

## 5. 현재 상태 (2026-09-28 기준, 정직하게)

| 요건 | 상태 | 남은 일 |
|---|---|---|
| R1 선언문 | ✅ README에 있음 | 최종 데모와 문장이 맞는지 재확인 |
| R2 Kiln | ⚠️ 코드만 있음. `.env` 미설정이라 **Safe fallback parser로 동작 중** | 행사 키 수령 → `scripts/check-kiln.mjs` → 화면 배지가 `Kiln · qwen3-32b`로 바뀌는지 확인 |
| R3 온체인 Tx | ❌ **아직 0건**. Sepolia 기록 경로만 구현됨 | 테스트넷 거래 1건 이상 실행 → 해시를 README에 기재 |
| In scope / Push ×2 | ✅ 정책 엔진과 감사 로그 구현 | 영상 촬영 |
| Re-run ×2 | ⚠️ 정책 버전은 있으나 "조건 변경 → 재실행" 장면을 따로 짜지 않음 | 리허설 시나리오에 추가 |

**주의 — 사실과 다른 설명 금지 (헌법 4조):**
- 현재 레포(모든 브랜치)에는 **스마트 컨트랙트가 없다**. `contracts/` 폴더나 `npm run deploy`도 없다.
- 온체인 기록 방식은 **감사 체인의 마지막 SHA-256 해시를 자기 주소로 보내는 0 ETH 거래 데이터에 넣는 것**이다 (Sepolia, MetaMask). 컨트랙트가 revert 없이 차단 사유를 저장하는 구조가 아니다.
- 차단 사유는 **앱 감사 로그(해시 체인)**에 기록되고, 그 해시가 온체인에 앵커링된다. 발표와 README에서 이 구조 그대로 설명한다.
- 차단 사유 자체를 온체인에 남기려면 컨트랙트나 이벤트 로그를 새로 구현해야 한다. 이 경우 대회 중 작성 코드로 구분 기재한다 (헌법 9조).

## 6. README 온체인 증빙 블록 양식

README 맨 아래에 붙인다. **실제 해시가 생기기 전에는 채우지 않는다.**

```markdown
### On-Chain Verification Proof
- **Network:** Ethereum Sepolia Testnet (chainId 11155111)  <!-- 또는 TRON Nile -->
- **Audit anchor Tx Hash:** `0x...`
- **Explorer:** https://sepolia.etherscan.io/tx/0x...
- **Anchored audit hash:** `sha256:...` (앱 감사 로그의 해당 이벤트와 일치)
- **What it proves:** 해당 시점까지의 승인·차단 기록(In scope 1건, Out of scope 2건)이 이후 변조되지 않았음
```

TRON Nile을 쓰면 익스플로러는 `https://nile.tronscan.org/#/transaction/<해시>` 형식이다.

## 7. 제출 직전 체크리스트

- [ ] README 선언문 1문장 확정 (R1)
- [ ] 실제 Kiln 호출 성공 + 증빙 캡처 (R2)
- [ ] 온체인 Tx 1건 이상 + README 증빙 블록 작성 (R3)
- [ ] 데모 영상 **3분 이내**: In scope 1건, Push 2건, Re-run 2회, 각 차단 사유가 기록되는 장면
- [ ] 대회 전 코드와 대회 중 코드 구분 기재 (헌법 9조)
- [ ] `.env`, API 키, 개인키, 시드가 레포와 영상에 없는지 확인
- [ ] `npm test`, `npm run typecheck`, `npm run build` 통과
- [ ] **9/30 12:00 이전** 제출 완료 (여유 있게 11:00 목표)
