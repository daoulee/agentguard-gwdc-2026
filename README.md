# GWDC 2026 출전 프로젝트

이 저장소에는 서로 독립된 두 챌린지 제출물이 있습니다. 각 폴더의 README에 선언문, 실행 방법, 공식 기준 대응, 온체인 증빙, 코드 출처(대회 전/중) 구분이 있습니다.

| 폴더 | 챌린지 | 한 문장 | 온체인 증빙 |
| --- | --- | --- | --- |
| [`agentguard/`](agentguard/) | FuriosaAI × Bricksum **Challenge B** | AI 에이전트의 지출 요청을 사용자 정책으로 코드가 검사·차단하고, 지시→승인→거래를 검증 가능한 감사 기록으로 잇는 AI 지출 방화벽 (Kiln `qwen3-32b`) | Ethereum Sepolia — [README 증빙](agentguard/README.md#on-chain-verification-proof) |
| [`TRON/`](TRON/) | TRON **Challenge B** | 대화로 투자 조건을 파악하고 JustLend·USDD 실데이터로 두 계획을 비교한 뒤, 확인한 행동만 실행하고 결과를 기록·리뷰하는 AI 자산 배분 도우미 — 공개 주소 https://tron-yield-studio-gwdc.pages.dev/ | TRON Nile — [README 증빙](TRON/README.md#on-chain-verification-proof-tron-nile) |

명령은 각 폴더로 이동한 뒤 실행합니다 (`cd agentguard` 또는 `cd TRON/frontend`). `TRON/contracts/`의 AgentGuardVault는 팀원이 만든 별도 프로토타입이며 두 제출물의 핵심 기능과 연결돼 있지 않습니다.
