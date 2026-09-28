import type { AiUsageRecord, AuditEvent } from "@agentguard/shared";

/**
 * 에너지 효율 요약.
 *
 * AgentGuard의 핵심 설계는 "정책은 AI가 한 번 구조화하고, 이후 모든 지출 판정은
 * 결정론적 코드가 한다"는 것이다. 그래서 구매 판정이 늘어도 AI 추론은 늘지 않는다.
 * 이 모듈은 그 절감을 감사 기록에서 실측 카운트로 계산하고, 공개된 추정 계수로
 * 에너지 추정치를 만든다. 계수는 가정이며 응답에 함께 표기한다.
 */

// 정책 판정 1건을 AI에게 물었다면 소비했을 추정 토큰 (가정).
// 정책 해석 프롬프트가 대략 이 규모의 추론을 유발한다고 보수적으로 잡는다.
const ASSUMED_TOKENS_PER_AI_DECISION = 700;

// LLM 추론 1,000토큰당 에너지 추정치(Wh). NPU 추론의 공개 벤치마크가 없어
// 문헌에서 흔히 인용되는 보수적 값을 가정으로 사용한다. 실측이 아니다.
const ASSUMED_WH_PER_1K_TOKENS = 0.3;

export type EnergySummary = {
  // 실측 카운트
  aiInferenceCalls: number;      // 실제 AI(Kiln) 호출 수
  deterministicDecisions: number; // 코드로만 처리한 지출 판정 수
  measuredTotalTokens: number | null; // 공급자가 보고한 실제 토큰 합(없으면 null)
  // 절감 계산 (가정 기반)
  aiCallsAvoided: number;        // "판정마다 AI 호출" 대비 줄인 호출 수
  tokensAvoidedEstimate: number; // 줄인 것으로 추정되는 토큰
  energySavedWhEstimate: number; // 줄인 것으로 추정되는 에너지(Wh)
  reductionRatio: number;        // 판정 대비 AI 호출 비율로 본 절감률(0~1)
  assumptions: {
    tokensPerAiDecision: number;
    whPer1kTokens: number;
    note: string;
  };
};

/** 코드가 결정론적으로 처리한 지출 판정 이벤트 종류. AI를 부르지 않는다. */
const DECISION_TYPES = new Set<AuditEvent["type"]>([
  "allowed",
  "blocked",
  "approval_requested",
  "approved",
  "rejected"
]);

export function summarizeEnergy(
  auditEvents: AuditEvent[],
  aiUsage: AiUsageRecord[]
): EnergySummary {
  const aiInferenceCalls = aiUsage.filter((u) => u.status === "success").length;
  const deterministicDecisions = auditEvents.filter((e) => DECISION_TYPES.has(e.type)).length;

  const measuredTotalTokens = aiUsage.reduce<number | null>((sum, u) => {
    if (u.totalTokens == null) return sum;
    return (sum ?? 0) + u.totalTokens;
  }, null);

  // 만약 모든 판정을 AI에게 물었다면 필요했을 호출 수 = 판정 수.
  // 실제로는 aiInferenceCalls 번만 불렀으므로 그 차이가 절감분이다.
  const aiCallsAvoided = Math.max(0, deterministicDecisions - aiInferenceCalls);
  const tokensAvoidedEstimate = aiCallsAvoided * ASSUMED_TOKENS_PER_AI_DECISION;
  const energySavedWhEstimate =
    (tokensAvoidedEstimate / 1000) * ASSUMED_WH_PER_1K_TOKENS;

  const reductionRatio =
    deterministicDecisions === 0 ? 0 : aiCallsAvoided / deterministicDecisions;

  return {
    aiInferenceCalls,
    deterministicDecisions,
    measuredTotalTokens,
    aiCallsAvoided,
    tokensAvoidedEstimate,
    energySavedWhEstimate: Number(energySavedWhEstimate.toFixed(4)),
    reductionRatio: Number(reductionRatio.toFixed(3)),
    assumptions: {
      tokensPerAiDecision: ASSUMED_TOKENS_PER_AI_DECISION,
      whPer1kTokens: ASSUMED_WH_PER_1K_TOKENS,
      note:
        "에너지·토큰 절감은 '판정마다 AI 호출' 가정 대비 추정치다. whPer1kTokens와 tokensPerAiDecision은 공개 문헌 기반 가정이며 NPU 실측이 아니다. aiInferenceCalls와 deterministicDecisions는 감사 기록의 실측 카운트다."
    }
  };
}
