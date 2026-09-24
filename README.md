# AgentGuard

AI 에이전트의 지출 요청을 사용자 정책으로 검증하고, 허용 범위를 벗어난 결제를 차단하며, 승인부터 온체인 결과까지 감사 가능한 기록으로 남기는 GWDC 2026 해커톤 프로젝트입니다.

## 현재 단계

이 저장소는 해커톤 사전 준비용 스캐폴딩입니다. 실행 환경, 워크스페이스, 공통 타입, 목업 상품과 기본 화면만 포함합니다. Kiln/Qwen 연동, 정책 엔진, 지갑 서명, 테스트넷 거래와 감사 타임라인은 핵심 구현 단계에서 추가합니다.

## 구성

```text
apps/web          React + Vite 사용자 화면
apps/server       Node.js + Express API
packages/shared   공통 타입과 목업 데이터
packages/policy   정책 엔진 인터페이스
docs              기획 및 운영 문서
```

## 코드 이해하기

비전공자도 프로젝트 구조와 각 코드 문단의 역할을 이해할 수 있도록 쇼핑몰·경비실 비유로 정리한 문서입니다.

- [비전공자용 코드 안내서](docs/CODE_GUIDE_FOR_BEGINNERS.md)
- [팀 작업 규칙](docs/TEAM_WORKFLOW.md)

## 시작하기

```bash
cp .env.example .env
npm install
npm run dev
```

- 웹: <http://localhost:5173>
- 서버 상태 확인: <http://localhost:8787/api/health>

## 팀 브랜치

```text
feature/ai-kiln
feature/frontend
feature/policy-blockchain
```

## 보안

- 개인키, 시드 구문, API 키를 저장소에 커밋하지 않습니다.
- 실제 자산 대신 공개 테스트넷만 사용합니다.
- `.env.example`에는 변수 이름만 기록합니다.
