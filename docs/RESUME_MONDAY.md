# 월요일 재개 메모 (2026-09-27 저장)

> 다음에 작업 시작할 때 **이 파일 → `AGENTS.md` 순으로** 읽으면 바로 이어갈 수 있다.

## 지금 상태 한 줄

Challenge B 제출 준비의 **핵심 로직·화면·문서는 완성**됐고, 원격(`main`)에 전부 저장됨. 남은 건 **현장에서만 되는 실연결**(Kiln 키, Sepolia 거래)과 발표 산출물.

## 저장 상태

- 워킹트리 깨끗, 로컬 = 원격 `main` (미커밋 변경 0).
- 저장소: `github.com/daoulee/agentguard-gwdc-2026` (private).
- 로컬 경로: `~/Desktop/AgentGuard`.
- **실행 중이던 로컬 서버·터널·공개 URL은 세션 종료 후 사라진다.** 재개 시 `npm run dev`로 다시 띄운다.

## 이번에 끝낸 것 (커밋 기준)

| 커밋 | 내용 |
| --- | --- |
| `deda65a` | 모델 gpt-oss-120b → **Qwen3-32B** (공지 정정 반영) |
| `6764aa5` | **에너지 효율** 지표 (`/api/energy`, 감사 로그 카드) |
| `255f10c` | 데모 상태 초기화 엔드포인트 |
| `06e75c6` | **AGENTS.md** (AI 작업 진입점·헌법 9조) |
| `edde2a3` | 데모 초기화 버튼 + **피치덱**(`docs/PITCH_DECK.md`) |
| `fad1b69` | 히어로 지표에 추론 절감 노출 + **코드 출처 구분**(README) |

검증: `npm test` 22개 통과 · `npm run typecheck` 무결점 · `npm run build` 성공.

## 월요일 이후(현장) 할 일 — 우선순위

1. **참가·팀·모델 확정 (TG에서)**
   - GWDC Telegram(`t.me/GWDC_Global`) 입장 필수. FuriosaAI×Bricksum 토픽(`/740`)에서 모델 최종 확인(공지=Qwen3-32B, 상세문서=옛 gpt-oss라 상충 → 공지가 맞지만 현장 재확인).
   - 실제 Kiln `/models`로 정확한 모델 식별자 확인 후 `.env` 반영.
2. **실제 Kiln(Qwen) 호출 연결** — `.env`에 `KILN_API_URL`, `KILN_API_KEY`. 화면 provider가 "Kiln · Qwen3-32B"로 바뀌고 흐름별 토큰이 실측되는지 확인.
3. **실제 Sepolia 거래 1건** — 지갑 준비 + faucet 테스트 ETH. 감사 해시를 0 ETH 거래에 기록, etherscan 링크를 영수증에 연결.
4. **README 신규 코드 표 채우기** — `git log --since="2026-09-28T20:00:00+09:00"` 로 대회 중 커밋 범위 기입.
5. **데모 영상(3분) + 피치덱 발표 리허설** — `docs/PITCH_DECK.md` 기준. 데모 전 **초기화 버튼** 필수.

## 사람만 할 수 있는 것 (AI가 대신 못 함)

- Telegram 가입·질문, 실제 Kiln 키 수령, 지갑 생성·faucet 자금, 최종 제출 폼 작성.

## 함정 메모

- 데모 전 `/api/demo/reset` 안 하면 누적 지출 때문에 정상 케이스가 예산에 막힌다.
- 공개 URL(trycloudflare)은 매번 랜덤·임시. 재개 시 새로 띄운다.
- 키·개인키는 절대 커밋 금지(AGENTS.md 헌법 3조).
