import { createFallbackPolicyDraft, validatePolicyDraft } from "@agentguard/policy";
import type { AiStatusResponse, PolicyDraft, Product } from "@agentguard/shared";

type KilnResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

const getConfiguration = () => ({
  apiUrl: process.env.KILN_API_URL?.trim() ?? "",
  apiKey: process.env.KILN_API_KEY?.trim() ?? "",
  model: process.env.KILN_MODEL?.trim() || "Qwen3-32B"
});

export function getAiStatus(): AiStatusResponse {
  const configuration = getConfiguration();
  const configured = Boolean(configuration.apiUrl && configuration.apiKey);
  return {
    provider: configured ? "Kiln · Qwen3-32B" : "Safe fallback parser",
    configured,
    model: configuration.model
  };
}

const stripCodeFence = (content: string) => content
  .replace(/^```(?:json)?\s*/i, "")
  .replace(/\s*```$/, "")
  .trim();

const toDraft = (value: unknown, prompt: string, merchants: string[]): PolicyDraft => {
  if (!value || typeof value !== "object") throw new Error("invalid_policy_json");
  const record = value as Record<string, unknown>;
  const draft: PolicyDraft = {
    name: String(record.name ?? "AI 지출 정책"),
    sourceText: prompt,
    budget: Number(record.budget),
    autoApprovalLimit: Number(record.autoApprovalLimit),
    currency: "KRW",
    allowedMerchants: Array.isArray(record.allowedMerchants)
      ? record.allowedMerchants.map(String).filter((merchant) => merchants.includes(merchant))
      : [],
    allowedCategories: Array.isArray(record.allowedCategories)
      ? record.allowedCategories.map(String)
      : [],
    deadline: String(record.deadline ?? ""),
    requireHumanApproval: Boolean(record.requireHumanApproval),
    provider: "kiln",
    warnings: Array.isArray(record.warnings) ? record.warnings.map(String) : []
  };
  const errors = validatePolicyDraft(draft);
  if (errors.length > 0) throw new Error(errors.join(" "));
  return draft;
};

async function interpretWithKiln(prompt: string, products: Product[]) {
  const configuration = getConfiguration();
  const merchants = [...new Set(products.map((product) => product.merchant))];
  const endpoint = configuration.apiUrl.endsWith("/chat/completions")
    ? configuration.apiUrl
    : `${configuration.apiUrl.replace(/\/$/, "")}/chat/completions`;
  const today = new Date().toISOString();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${configuration.apiKey}`
    },
    body: JSON.stringify({
      model: configuration.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You convert Korean spending instructions into strict JSON. Today is ${today}. Available merchants: ${merchants.join(", ")}. Return only JSON with name, budget, autoApprovalLimit, allowedMerchants, allowedCategories, deadline (ISO 8601), requireHumanApproval, warnings. Currency is KRW. Never invent a merchant outside the available list.`
        },
        { role: "user", content: prompt }
      ]
    }),
    signal: AbortSignal.timeout(8_000)
  });

  if (!response.ok) throw new Error(`kiln_http_${response.status}`);
  const payload = await response.json() as KilnResponse;
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("kiln_empty_response");
  return toDraft(JSON.parse(stripCodeFence(content)), prompt, merchants);
}

export async function interpretPolicy(prompt: string, products: Product[]) {
  const merchants = [...new Set(products.map((product) => product.merchant))];
  const status = getAiStatus();
  if (status.configured) {
    try {
      return await interpretWithKiln(prompt, products);
    } catch {
      const fallback = createFallbackPolicyDraft(prompt, { availableMerchants: merchants });
      fallback.warnings.unshift("Kiln 응답을 사용할 수 없어 안전 규칙 변환기로 처리했습니다.");
      return fallback;
    }
  }
  return createFallbackPolicyDraft(prompt, { availableMerchants: merchants });
}
