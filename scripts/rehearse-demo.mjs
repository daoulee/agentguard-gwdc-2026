// 발표 전 8단계 데모 자동 리허설: node --env-file=.env scripts/rehearse-demo.mjs --reset
// ⚠ 데모 상태(누적 지출·감사 로그·승인·AI 사용량)를 초기화한다. 실제 결제·거래는 하지 않는다.
// 끝나면 --reset 을 한 번 더 실행하거나 화면의 초기화 버튼으로 깨끗한 상태에서 발표를 시작한다.
if (!process.argv.includes('--reset')) {
  console.error('이 스크립트는 데모 상태를 초기화합니다. 확인했다면 --reset 을 붙여 실행하세요.');
  process.exit(2);
}
const base = `${(process.env.AGENTGUARD_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '')}/api`;
let cookie = '';
const call = async (path, body) => {
  const response = await fetch(base + path, body === undefined ? { headers: { cookie } } : {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body)
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return [response.status, await response.json().catch(() => ({}))];
};
let failures = 0;
const check = (step, ok, detail) => { if (!ok) failures++; console.log(`${ok ? '✔' : '✖'} ${step} — ${detail}`); };

const [, session] = await call('/session');
if (session.mode === 'authenticated') {
  const [status] = await call('/session', { password: process.env.OPERATOR_PASSWORD ?? '' });
  if (status !== 200) { console.error('✖ 운영자 로그인 실패 (OPERATOR_PASSWORD 확인)'); process.exit(1); }
}
await call('/demo/reset', {});

const [, interpreted] = await call('/policies/interpret', { prompt: '승인된 판매자에서 게이밍 모니터를 30만원 이내로 구매해.' });
const draft = interpreted.draft ?? {};
const usage = interpreted.usage ?? {};
check('1 정책 초안', draft.budget === 300000 && draft.allowedCategories?.includes('gaming_monitor'),
  `provider=${usage.provider}/${usage.status} model=${usage.model} tokens=${usage.totalTokens ?? '미제공'} ${interpreted.processingMs}ms · 예산 ${draft.budget} · ${draft.allowedCategories} · ${draft.allowedMerchants} · 확인필요 ${draft.missingFields}`);
if (usage.provider !== 'kiln') console.log('  ⚠ 실제 Kiln 호출이 아닙니다(안전 규칙 변환기). 발표에서 Kiln 결과라고 말하지 마세요.');

const [applyStatus, applied] = await call('/policies', {
  interpretationId: interpreted.interpretationId,
  draft: { ...draft, autoApprovalLimit: 270000, deadline: new Date(Date.now() + 86_400_000).toISOString(), missingFields: [] }
});
const policy = applied.policy;
check('2 정책 적용', applyStatus === 201, policy ? `${policy.id} v${policy.version} 예산 ${policy.budget} 자동승인 ${policy.autoApprovalLimit}` : applied.message);
if (!policy) process.exit(1);

let seq = 0;
const evaluate = async (productId, fee = 0) => {
  const [, result] = await call('/evaluate', { productId, fee, policyId: policy.id, clientRequestId: `rehearsal-${Date.now()}-${seq++}` });
  return result.evaluation ?? { decision: { reasons: [result.message] } };
};
const ledger = async () => (await call('/policy'))[1].policy;
const reasons = (evaluation) => evaluation.decision.reasons.join(',');

const pending = await evaluate('monitor-approval');
let current = await ledger();
check('3 299,000원 요청', reasons(pending) === 'human_approval_required' && current.reservedKrw === 299000, `${reasons(pending)} · 예약 ${current.reservedKrw}`);
await call(`/approvals/${pending.request.id}`, { action: 'reject' });
current = await ledger();
check('4 사람이 거절', current.reservedKrw === 0 && current.spentKrw === 0, `예약 ${current.reservedKrw} · 지출 ${current.spentKrw}`);
const unknown = await evaluate('monitor-unknown-merchant');
check('5 미등록 판매자', reasons(unknown) === 'merchant_not_allowed', reasons(unknown));
const safe = await evaluate('monitor-safe');
current = await ledger();
check('6 249,000원 자동 승인', reasons(safe) === 'allowed' && current.spentKrw === 249000, `${reasons(safe)} · 지출 ${current.spentKrw}`);
const overBudget = await evaluate('monitor-safe', 60000);
check('7 수수료 포함 총예산 초과', reasons(overBudget) === 'budget_exceeded', reasons(overBudget));
await call('/policy/stop', {});
const stopped = await evaluate('monitor-safe');
check('8 위임 중지 후 요청', reasons(stopped).includes('delegation_stopped'), reasons(stopped));
const [, audit] = await call('/audit');
check('감사 체인', audit.integrityValid === true, `이벤트 ${(audit.events ?? []).length}개 · 무결성 ${audit.integrityValid}`);

console.log(failures ? `\n✖ ${failures}개 단계 실패` : '\n✔ 8단계 모두 기대대로 동작. 발표 전 화면에서 초기화 후 시작하세요.');
process.exit(failures ? 1 : 0);
