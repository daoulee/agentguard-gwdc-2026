# TRON Yield Studio

**선언문:** TRON Yield Studio는 대화로 보유 자산·기간·유동성·위험 성향을 파악하고, JustLend·USDD 메인넷 실데이터로 기본 수익과 기간 한정 보상을 나눈 두 가지 배분 계획을 비교한 뒤, 사용자가 금액·수수료·위험·승인 범위를 확인한 행동만 실행(Nile 테스트넷 실거래 또는 명시된 시뮬레이션)하고 계획 대비 결과를 기록·리뷰하는 AI 자산 배분 도우미입니다.

공개 주소: https://tron-yield-studio-gwdc.pages.dev/

## 실행

```bash
cd TRON/frontend
npm install
cp .env.example .env     # Kiln 키를 넣으면 AI 대화 보완·설명이 켜짐 (없으면 규칙 기반)
npm run dev              # http://127.0.0.1:5180
npm test                 # 도메인 로직 테스트 (vitest)
npm run typecheck && npm run build
```

`.env`의 `KILN_*`는 서버 쪽(`/api/chat`)에서만 읽습니다. `VITE_` 접두사가 아니므로 브라우저 번들에 들어가지 않습니다(빌드 결과물에서 키·URL 미포함 확인).

## 흐름과 공식 기준 대응

| 공식 기준 | 구현 | 위치 |
|---|---|---|
| Needs Analysis | 대화에서 보유 자산·기간·유동성·위험을 추출. 빠진 항목은 재질문, 요약을 사용자가 확정. 규칙 파서가 먼저 읽고, Kiln `qwen3-32b`는 **빈칸만** 채움(사용자 말과 충돌하면 무시) | `src/domain/needs.ts`, `src/components/NeedsChat.tsx`, `server/llm.ts` |
| TRON Ecosystem Integration | JustLend OpenAPI(`/lend/jtoken`, `/mining/apy`, `/lend/strx`), USDD data-platform(`latest-collateral?chain=tron`, PSM 수수료), TronGrid(에너지 가격, approve 에너지 실측). 값마다 출처·조회 시각·조건 표시, 10분 지나면 오래된 값 경고, 실패 시 추천 중지 | `src/data/sources.ts`, `src/components/Opportunities.tsx` |
| Plans & Yield Estimates | 두 계획(기본 수익 중심 / 보상 포함 수익형). 배분액, **기본 수익과 기간 한정 보상 분리**, 진입·회수 비용(에너지×체인 가격), 회수 조건, 위험, 보상 의존도, 추천 이유 | `src/domain/plans.ts`, `src/components/PlanCompare.tsx` |
| AI Execution & Management | 계획을 approve·PSM 교환·공급·스테이킹 행동으로 변환. 행동마다 금액·수수료·위험·**정확한 승인 범위(무제한 승인 아님)** 표시, 체크 후에만 실행. Nile jTRX 공급·회수는 TronLink 서명으로 실제 실행, 메인넷 행동은 시뮬레이션으로 기록. 조건 변화(보상 감소, 유동성 변경) 시 재배분 제안 → 확인 → 새 버전 기록 | `src/domain/plans.ts`, `src/chain/tronlink.ts`, `src/components/Execution.tsx`, `src/domain/journal.ts` |
| Tracking & Review | 원래 계획·가정 금리·조회 시각을 버전별로 저장. 같은 포지션을 최신 금리로 다시 계산한 **시뮬레이션 리플레이**와 예상 대비 차이. Nile jTRX는 체인에서 잔고를 직접 읽어 실제 변화 표시 | `src/domain/journal.ts`, `src/components/Activity.tsx` |

## 정직하게 밝히는 한계

- **메인넷 실행은 하지 않습니다.** 메인넷 행동은 서명·전송 없는 시뮬레이션이며 화면과 기록에 "시뮬레이션"으로 표시합니다.
- **실제 거래는 Nile 테스트넷 jTRX(TRX 공급·회수)만** 지원합니다. Faucet USDT(`TXYZop…`)가 JustLend Nile USDT(`TPYwAC…`)와 다른 토큰이라 스테이블코인 경로는 테스트넷에서도 실행할 수 없습니다.
- 에너지 사용량은 **USDT approve만 TronGrid 실측**입니다. 공급·교환·스테이킹·회수 에너지는 가정값이며 화면에 "가정값"으로 표시합니다.
- USDD 공식 API의 TRON `apy`(4%)는 참여 경로·회수 조건을 API로 확인할 수 없어 **계획에서 제외**하고 이유를 표시합니다.
- sTRX 언스테이크 대기 기간은 API로 확인하지 못해 "대기 기간 있음, JustLend 화면에서 확인"으로만 안내합니다.
- TRON Carnival 등 공동 캠페인은 기간·자격·보상 규칙을 검증할 수 없어 넣지 않았습니다.
- 기록은 브라우저 `localStorage`에 저장됩니다(서버 DB 없음).

## 배포 (Cloudflare Pages)

```bash
npm run build
wrangler pages deploy dist --project-name tron-yield-studio-gwdc --branch main
```

`functions/api/chat.ts`가 Pages Function으로 함께 배포됩니다. AI를 켜려면 Pages 프로젝트 설정에 `KILN_API_URL`, `KILN_API_KEY`(암호화), `KILN_MODEL`을 넣습니다. 넣지 않으면 공개 사이트는 규칙 기반으로 동작합니다.
