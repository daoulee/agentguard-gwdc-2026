# TRON Challenge B — AI 자산 배분·수익 계획 도우미

**선언문:** TRON Yield Studio는 대화로 투자 조건을 파악하고, JustLend·USDD 메인넷 실데이터로 기본 수익과 기간 한정 보상을 나눈 두 계획을 비교한 뒤, 사용자가 확인한 행동만 실행(Nile 테스트넷 실거래 또는 명시된 시뮬레이션)하고 계획 대비 결과를 기록·리뷰하는 AI 자산 배분 도우미입니다.

## 폴더

- [`frontend/`](frontend/) — **TRON Yield Studio** (제출 대상). 기능·기준 대응·한계는 [`frontend/README.md`](frontend/README.md)
- [`contracts/`](contracts/) — AgentGuardVault 스마트 컨트랙트 (AI 지출 통제 금고, Nile 배포). **TRON B 제출물과 별개**이며 Yield Studio에 연결돼 있지 않습니다. 자세한 내용은 [`contracts/README.md`](contracts/README.md)
- [`CHALLENGE_B_GAP_REPORT.md`](CHALLENGE_B_GAP_REPORT.md) — 공식 수용 기준 대비 현황

## 현재 상태 (2026-09-29 16:50 KST)

| 공식 기준 | 상태 |
|---|---|
| Needs Analysis | ✅ 대화형 요구 파악·재질문·요약 확정 (규칙 파서 + Kiln `qwen3-32b` 빈칸 보완) |
| TRON Ecosystem Integration | ✅ JustLend·USDD 메인넷 API 실시간 조회, 출처·시각·조건 표시. USDD 담보율·PSM 양방향 수수료를 회수 경로·위험에 반영 |
| Plans & Yield Estimates | ✅ 두 계획, 기본/보상 분리, 비용·회수 조건·위험 |
| AI Execution & Management | ✅/⚠️ 행동 미리보기·확인·기록·재배분 제안. Nile jTRX 공급·회수 실거래 완료, 스테이블코인·메인넷 행동은 시뮬레이션 |
| Tracking & Review | ✅ 버전별 계획·가정 기록, 시뮬레이션 리플레이(명시), Nile 실제 잔고 조회 |
| 온체인 증빙 | ✅ Nile jTRX 공급·회수 실거래 2건 (아래 증빙) |

공개 주소 https://tron-yield-studio-gwdc.pages.dev/ 는 2026-09-29 최신 버전으로 재배포됨 (AI는 Cloudflare에 Kiln 키 설정 전까지 규칙 기반).

## On-Chain Verification Proof (TRON Nile)

JustLend Nile jTRX 계약(`TKM7w4qFmkXQLEF2MgrQroBYpd5TY7i1pq`)에 TronLink 서명으로 실제 실행한 공급·회수입니다. 앱의 실행 기록(방식: Nile 실거래)과 같은 해시입니다.

| 행동 | Tx Hash | 결과 |
|---|---|---|
| 공급 `mint()` 10 TRX | [`c5c4c29d1a03a9ede7778a651617f9dfc711e3b2c93406ae529300738dcd94c7`](https://nile.tronscan.org/#/transaction/c5c4c29d1a03a9ede7778a651617f9dfc711e3b2c93406ae529300738dcd94c7) | SUCCESS · 블록 71380724 · 80,894 에너지 (8.09 TRX 소각) · 894.64 jTRX 수령 |
| 회수 `redeemUnderlying(uint256)` 10 TRX | [`016a07ad4715150d5a416903a1312c65094fcb73885df13933128ffa025607d0`](https://nile.tronscan.org/#/transaction/016a07ad4715150d5a416903a1312c65094fcb73885df13933128ffa025607d0) | SUCCESS |

- 지갑: `TZ7ZwYbcmrip3szkkb2TSJtGZ54TWxMKtB` (Nile 테스트넷)
- 실행일: 2026-09-29 17:05~17:09 KST (대회 기간 중)
