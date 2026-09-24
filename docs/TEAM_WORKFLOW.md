# Team workflow

## 역할

- `feature/ai-kiln`: Kiln/Qwen 연동과 정책 JSON 생성
- `feature/frontend`: 사용자 화면과 감사 타임라인
- `feature/policy-blockchain`: 정책 엔진, 지갑, 테스트넷 기록

## 작업 규칙

1. 작업 시작 전에 `main`을 최신 상태로 맞춘다.
2. 기능 하나를 작게 구현하고 타입 검사까지 통과시킨다.
3. API 키와 지갑 개인키를 커밋하지 않는다.
4. 3~4시간마다 `main`에 통합하고 전체 실행을 확인한다.
5. API 응답 계약 변경 시 `packages/shared` 타입을 먼저 수정한다.

## 완료 조건

- `npm run typecheck`
- `npm run build`
- 정상 결제 1건과 차단 2건의 수동 시나리오 확인
- README 또는 관련 문서 업데이트

