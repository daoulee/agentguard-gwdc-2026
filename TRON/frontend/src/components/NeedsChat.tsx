import { useEffect, useRef, useState, type FormEvent } from 'react';
import { callAi } from '../data/ai';
import { fillGaps, followUpQuestion, formatNeedsSummary, mergeNeeds, missingFields, sanitizeModelNeeds, type NeedField, type Needs } from '../domain/needs';

type Message = { role: 'assistant' | 'user'; text: string; note?: string };

const fieldLabel: Record<NeedField, string> = { holdings: '보유 자산', horizonDays: '운용 기간', liquidity: '유동성', risk: '위험 성향' };

const examples = [
  'USDT 5,000개를 6개월 정도 굴리고 싶어. 한 달 안에 일부 쓸 수도 있어.',
  'TRX 2만 개 있는데 1년은 안 쓸 거야. 변동 있어도 괜찮아.',
  'USDD 3000개, 원금이 제일 중요해',
];

type Props = {
  needs: Needs;
  onNeedsChange: (needs: Needs) => void;
  confirmed: boolean;
  onConfirm: () => void;
  onReset: () => void;
  aiModel: string | null;
  onAiUsage: (tokens: number | null) => void;
};

export function NeedsChat({ needs, onNeedsChange, confirmed, onConfirm, onReset, aiModel, onAiUsage }: Props) {
  const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', text: '안녕하세요. TRON에서 자금을 어떻게 운용할지 같이 정리해볼게요. 가지고 계신 자산과 금액, 운용 기간, 중간에 돈을 쓸 일이 있는지, 위험을 얼마나 감수할 수 있는지 편하게 말씀해주세요.' }]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const missing = missingFields(needs);

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [messages]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || thinking) return;
    setInput('');
    setMessages(current => [...current, { role: 'user', text: trimmed }]);
    const merged = mergeNeeds(needs, trimmed);
    let next = merged.needs;
    let note = merged.captured.length ? `규칙 파서가 인식: ${merged.captured.map(field => fieldLabel[field]).join(', ')}` : undefined;
    // Ask the model only for gaps; it can never overwrite what the parser read from the user's words.
    if (aiModel && missingFields(next).length) {
      setThinking(true);
      const conversation = [...messages.filter(message => message.role === 'user').map(message => message.text), trimmed].join('\n');
      const response = await callAi<unknown>({ mode: 'extract', text: conversation, known: next });
      setThinking(false);
      if (response.ok) {
        onAiUsage(response.usage.totalTokens);
        const filled = fillGaps(next, sanitizeModelNeeds(response.result));
        next = filled.needs;
        if (filled.filled.length) note = `${note ? `${note} · ` : ''}${response.model}가 보완: ${filled.filled.map(field => fieldLabel[field]).join(', ')}`;
      }
    }
    onNeedsChange(next);
    const remaining = missingFields(next);
    const reply = remaining.length
      ? `${merged.captured.length || note ? '확인했어요. ' : ''}${followUpQuestion[remaining[0]]}`
      : '필요한 정보가 모두 모였어요. 요약 카드가 맞는지 확인하고 "이 조건으로 확정"을 눌러주세요. 틀린 부분은 다시 말씀해주시면 고칠게요.';
    setMessages(current => [...current, { role: 'assistant', text: reply, note }]);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  return (
    <section className="needs-grid" id="needs">
      <div className="chat-card">
        <div className="section-head"><span className="section-index">01</span><div><p className="eyebrow">NEEDS ANALYSIS</p><h2>대화로 조건 정리</h2></div></div>
        <div className="chat-log" ref={logRef} aria-live="polite">
          {messages.map((message, index) => (
            <div key={index} className={`bubble ${message.role}`}>
              <p>{message.text}</p>
              {message.note && <small>{message.note}</small>}
            </div>
          ))}
          {thinking && <div className="bubble assistant"><p>{aiModel} 확인 중…</p></div>}
        </div>
        <form className="chat-input" onSubmit={submit}>
          <input value={input} onChange={event => setInput(event.target.value)} placeholder="예: USDT 5000개를 3개월 운용하고 싶어" disabled={confirmed} aria-label="메시지" />
          <button className="button primary" type="submit" disabled={confirmed || !input.trim() || thinking}>보내기 <span>↗</span></button>
        </form>
        {!confirmed && <div className="chips">{examples.map(example => <button key={example} type="button" onClick={() => void send(example)}>{example}</button>)}</div>}
      </div>

      <aside className="profile-card">
        <p className="eyebrow">NEEDS SUMMARY</p>
        <h3 className="summary-title">요구 요약</h3>
        {formatNeedsSummary(needs).length ? <ul className="summary-list">{formatNeedsSummary(needs).map(line => <li key={line}>{line}</li>)}</ul> : <p className="section-description">아직 파악된 조건이 없습니다.</p>}
        {missing.length > 0 && <div className="missing"><strong>아직 필요한 정보</strong><span>{missing.map(field => fieldLabel[field]).join(' · ')}</span></div>}
        <button className="button primary full" disabled={missing.length > 0 || confirmed} onClick={onConfirm}>{confirmed ? '조건 확정됨 ✓' : '이 조건으로 확정'} <span>↗</span></button>
        {confirmed && <button className="text-button" type="button" onClick={onReset}>조건 다시 입력</button>}
        <p className="fine">AI는 대화에서 조건을 뽑아내는 일만 합니다. 수익 계산과 추천은 아래 코드가 실제 데이터로 합니다.</p>
      </aside>
    </section>
  );
}
