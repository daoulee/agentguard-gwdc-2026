// 현장 Kiln 연결 점검: node --env-file=.env scripts/check-kiln.mjs
// 키는 출력하지 않는다. 결과는 실제 호출 결과만 보고한다.
const base = (process.env.KILN_API_URL ?? '').trim().replace(/\/chat\/completions$/, '').replace(/\/$/, '');
const key = (process.env.KILN_API_KEY ?? '').trim();
const model = (process.env.KILN_MODEL ?? '').trim() || 'qwen3-32b';
if (!base || !key) { console.error('✖ KILN_API_URL / KILN_API_KEY 가 .env에 없습니다.'); process.exit(1); }
const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const mask = (text) => String(text).replaceAll(key, '***');

console.log(`base=${base} model=${model} key=${key.slice(0, 6)}…(${key.length}자)`);

let started = performance.now();
const list = await fetch(`${base}/models`, { headers }).catch((error) => ({ ok: false, status: 0, text: async () => error.message }));
if (!list.ok) { console.error(`✖ /models HTTP ${list.status}: ${mask(await list.text()).slice(0, 300)}`); process.exit(1); }
const ids = ((await list.json()).data ?? []).map((item) => item.id);
console.log(`✔ /models ${Math.round(performance.now() - started)}ms · ${ids.length}개: ${ids.join(', ')}`);
if (!ids.includes(model)) {
  const similar = ids.filter((id) => id.toLowerCase().includes('qwen'));
  console.error(`✖ KILN_MODEL=${model} 이 목록에 없습니다. 후보: ${similar.join(', ') || '(qwen 없음)'} → .env의 KILN_MODEL을 고치세요.`);
  process.exit(1);
}

started = performance.now();
const chat = await fetch(`${base}/chat/completions`, {
  method: 'POST', headers, signal: AbortSignal.timeout(60_000),
  body: JSON.stringify({ model, temperature: 0, messages: [
    { role: 'system', content: 'Return only JSON: {"budget": number, "category": string}' },
    { role: 'user', content: '게이밍 모니터를 30만원 이내로 구매해.\n/no_think' }
  ] })
});
const elapsed = Math.round(performance.now() - started);
if (!chat.ok) { console.error(`✖ chat HTTP ${chat.status}: ${mask(await chat.text()).slice(0, 300)}`); process.exit(1); }
const body = await chat.json();
const content = body.choices?.[0]?.message?.content ?? '';
console.log(`✔ chat ${elapsed}ms · usage=${JSON.stringify(body.usage ?? '미제공')}`);
console.log(`  think 블록 포함: ${/<think>/i.test(content) ? '예 (서버가 제거함)' : '아니오'} · reasoning_content: ${body.choices?.[0]?.message?.reasoning_content ? '있음' : '없음'}`);
console.log(`  content: ${content.slice(0, 300)}`);
if (elapsed > Number(process.env.KILN_TIMEOUT_MS || 20000)) console.warn(`⚠ 응답이 KILN_TIMEOUT_MS보다 느립니다. .env에서 늘리세요.`);
