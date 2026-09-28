# TRON Yield Studio

GWDC 2026 TRON Challenge B를 위한 **웹 화면 초안**입니다. 보유 금액, 기간, 유동성, 위험 성향을 확인하고 배분안 두 개를 비교합니다.

팀 공유 주소: https://tron-yield-studio-gwdc.pages.dev/

```bash
cd TRON/frontend
npm install
npm run dev
```

Cloudflare Pages 수동 배포는 `npm run build` 후 `wrangler pages deploy dist --project-name tron-yield-studio-gwdc --branch main`으로 진행합니다.

수익률과 비용은 **시연용 가정값**입니다. 현재 JustLend/USDD 실시간 데이터, 지갑 서명, 예치·회수 거래, 실제 포지션 추적은 연결되지 않았습니다. 화면은 이를 명확히 표시하며 실제 금융 거래를 실행하지 않습니다. `TRON/contracts`의 AgentGuardVault는 별도의 지출 통제 프로토타입입니다.
