import assert from "node:assert/strict";
import { test } from "node:test";
import type { AiUsageRecord, AuditEvent } from "@agentguard/shared";
import { summarizeEnergy } from "./energy.js";

function decision(type: AuditEvent["type"]): AuditEvent {
  return {
    id: `e-${Math.random()}`,
    requestId: "r1",
    type,
    occurredAt: new Date().toISOString(),
    details: {},
    previousHash: "P",
    hash: "H"
  };
}

function aiCall(status: AiUsageRecord["status"], totalTokens: number | null): AiUsageRecord {
  return {
    id: `u-${Math.random()}`,
    flow: "policy_interpretation",
    provider: "kiln",
    model: "Qwen3-32B",
    status,
    promptTokens: null,
    completionTokens: null,
    totalTokens,
    occurredAt: new Date().toISOString()
  };
}

test("코드 판정은 세고 AI 호출은 성공만 센다", () => {
  const events = [decision("allowed"), decision("blocked"), decision("approved"), decision("policy_created")];
  const usage = [aiCall("success", 500), aiCall("failed", null)];
  const s = summarizeEnergy(events, usage);
  assert.equal(s.deterministicDecisions, 3); // policy_created는 판정 아님
  assert.equal(s.aiInferenceCalls, 1);       // 실패 호출은 제외
});

test("판정마다 AI를 불렀다면 대비한 절감을 추정한다", () => {
  const events = [decision("allowed"), decision("blocked"), decision("rejected"), decision("approval_requested")];
  const usage = [aiCall("success", null)];
  const s = summarizeEnergy(events, usage);
  assert.equal(s.aiCallsAvoided, 3);          // 판정 4 - AI호출 1
  assert.equal(s.tokensAvoidedEstimate, 3 * 700);
  assert.ok(s.energySavedWhEstimate > 0);
  assert.ok(s.reductionRatio > 0 && s.reductionRatio <= 1);
});

test("실제 토큰이 없으면 measuredTotalTokens는 null이다", () => {
  const s = summarizeEnergy([decision("allowed")], [aiCall("success", null)]);
  assert.equal(s.measuredTotalTokens, null);
});

test("실제 토큰이 보고되면 합산한다", () => {
  const s = summarizeEnergy([decision("allowed")], [aiCall("success", 480), aiCall("success", 520)]);
  assert.equal(s.measuredTotalTokens, 1000);
});

test("판정이 없으면 절감률은 0이고 오류가 없다", () => {
  const s = summarizeEnergy([], []);
  assert.equal(s.reductionRatio, 0);
  assert.equal(s.aiCallsAvoided, 0);
});

test("가정 계수를 응답에 명시한다", () => {
  const s = summarizeEnergy([decision("allowed")], []);
  assert.equal(s.assumptions.tokensPerAiDecision, 700);
  assert.ok(s.assumptions.note.includes("실측"));
});
