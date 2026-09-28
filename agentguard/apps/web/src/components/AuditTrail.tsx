import type { AuditEvent, PolicyDraft } from "@agentguard/shared";

const fieldNames: Record<string, string> = { name: "정책 이름", budget: "최대 예산", autoApprovalLimit: "자동 승인 한도", allowedMerchants: "허용 판매자", allowedCategories: "허용 품목", deadline: "유효 기한", requireHumanApproval: "승인 조건", missingFields: "확인 필요 항목", fieldSources: "해석 근거", warnings: "확인 안내", clarifyingQuestions: "확인 질문" };
const reasons: Record<string, string> = { allowed: "모든 정책 조건 충족", human_approval_required: "자동 승인 한도 초과", budget_exceeded: "누적 예산 초과", merchant_not_allowed: "미등록 판매자", category_not_allowed: "허용 품목 아님", deadline_expired: "기한 만료", delegation_stopped: "위임 중지" };
const value = (input: unknown) => typeof input === "number" ? input.toLocaleString("ko-KR") : typeof input === "string" ? input : Array.isArray(input) ? input.join(", ") || "없음" : JSON.stringify(input) ?? "없음";

export function AuditTrail({ events, labels }: { events: AuditEvent[]; labels: Record<AuditEvent["type"], string> }) {
  return <div className="audit-trail" aria-label="판단 근거와 정책 수정 이력">
    {events.map(event => {
      const d = event.details;
      const initial = d.initialDraft as PolicyDraft | undefined;
      const final = d.finalDraft as PolicyDraft | undefined;
      const request = d.request as { source?: string; agentId?: string; clientRequestId?: string } | undefined;
      return <details className={`audit-entry audit-${event.type}`} key={event.id}>
        <summary><span className={`event-dot event-${event.type}`} /><div><strong>{labels[event.type]}</strong><span>{String(d.product ?? d.name ?? (d.draft as PolicyDraft | undefined)?.name ?? event.requestId)}</span></div>
          <span className="audit-duration">{typeof d.processingMs === "number" ? `${d.processingMs.toFixed(2)} ms` : ""}</span>
          <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleTimeString("ko-KR", { hour12: false })}</time><span className="audit-expand" aria-hidden="true">＋</span></summary>
        <div className="audit-evidence">
          <dl><div><dt>기록 주체</dt><dd>{String(d.actor ?? "이전 기록 · 주체 미제공")}</dd></div>
            <div><dt>요청 ID</dt><dd>{event.requestId}</dd></div>
            {request && <div><dt>요청 출처</dt><dd>{request.source === "agent" ? "인증된 외부 에이전트" : "구매 요청 시뮬레이터"} · {request.agentId} · {request.clientRequestId}</dd></div>}
            {typeof d.waitingMs === "number" && <div><dt>승인 대기시간</dt><dd>{(d.waitingMs / 1000).toFixed(1)}초</dd></div>}
            {d.rechecked === true && <div><dt>실행 직전 재검사</dt><dd>통과</dd></div>}
            {Array.isArray(d.reasons) && <div><dt>판정 이유</dt><dd>{d.reasons.map(reason => reasons[String(reason)] ?? String(reason)).join(" · ")}</dd></div>}
          </dl>
          {initial && final && <div className="policy-changes"><strong>초안 → 사용자가 확정한 정책</strong>
            {Array.isArray(d.changedFields) && d.changedFields.length ? d.changedFields.map(key => <div key={String(key)}><span>{fieldNames[String(key)] ?? String(key)}</span><del>{value(initial[String(key) as keyof PolicyDraft])}</del><b>→</b><ins>{value(final[String(key) as keyof PolicyDraft])}</ins></div>) : <p>수정 없이 초안을 확인하고 적용했습니다.</p>}
          </div>}
          <details className="audit-raw"><summary>원문·정책·AI 후보 전체 근거</summary><pre>{JSON.stringify(d, null, 2)}</pre></details>
          <p className="audit-hash">SHA-256 · {event.hash}</p>
        </div>
      </details>;
    })}
  </div>;
}
