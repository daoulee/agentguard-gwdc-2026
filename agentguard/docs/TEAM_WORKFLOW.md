# Team workflow

## 역할

현재 원격 브랜치 (2026-09-28): `main`, `Taehoon`, `dongkyo`, `codex/agentguard-policy-audit-design`.
브랜치별 담당 역할은 팀에서 확정한 뒤 여기에 적는다. 역할 후보:

- Kiln `Qwen3-32B` 연동과 정책 JSON 생성
- 사용자 화면과 감사 타임라인
- 정책 엔진, 지갑, 테스트넷 기록

처음 셋업과 오늘 겪은 문제는 [`TEAM_SETUP.md`](TEAM_SETUP.md)를 본다.

## 작업 규칙

1. 작업 시작 전에 `git fetch && git merge origin/main`으로 `main` 변경을 받는다. 명령은 `agentguard/` 폴더에서 실행한다.
2. 기능 하나를 작게 구현하고 타입 검사까지 통과시킨다.
3. API 키와 지갑 개인키를 커밋하지 않는다.
4. 3~4시간마다 `main`에 통합하고 전체 실행을 확인한다.
5. API 응답 계약 변경 시 `packages/shared` 타입을 먼저 수정한다.

## 완료 조건

- `npm run typecheck`
- `npm run build`
- 자동 승인·승인 대기·차단 시나리오를 각각 1건씩 확인
- README 또는 관련 문서 업데이트
