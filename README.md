# AgentGuard

AI 에이전트의 지출 요청을 사용자 정책으로 검증하고, 허용 범위를 벗어난 결제를 차단하며, 승인부터 온체인 결과까지 감사 가능한 기록으로 남기는 GWDC 2026 해커톤 프로젝트입니다.

## 현재 단계

자연어 정책 작성부터 거래 판정, 사용자 승인·거절, 해시 체인 감사 기록까지 이어지는 작동형 MVP입니다. Kiln API가 설정되면 Qwen 모델로 정책 초안을 만들고, 연결되지 않았거나 응답이 실패하면 안전 규칙 변환기가 같은 흐름을 유지합니다. 실제 결제와 블록체인 제출은 아직 시뮬레이션입니다.

### 구현된 핵심 흐름

1. 자연어 지출 조건을 구조화된 정책 초안으로 변환
2. 사용자가 금액·판매자·기한을 검토하고 최종 적용
3. 코드 기반 정책 엔진이 자동 승인·승인 대기·차단 판정
4. 사람이 대기 요청을 승인하거나 거절
5. 모든 이벤트를 SHA-256 해시 체인으로 연결해 변조 여부 검사
6. 정책과 감사 상태를 로컬 JSON에 저장해 서버 재시작 후에도 유지

## 구성

```text
apps/web          React + Vite 사용자 화면
apps/server       Node.js + Express API
packages/shared   공통 타입과 목업 데이터
packages/policy   정책 엔진, 안전 자연어 변환기, 자동 테스트
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

Kiln 연동 없이도 전체 데모가 작동합니다. 제공받은 OpenAI 호환 Kiln API가 있다면 `.env`의 `KILN_API_URL`, `KILN_API_KEY`, `KILN_MODEL`을 설정합니다. 비밀키는 절대 커밋하지 않습니다.

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
