import { createFallbackPolicyDraft, validatePolicyDraft } from "@agentguard/policy";
import type {
  AiStatusResponse,
  PolicyDraft,
  PolicyFieldKey,
  PolicyFieldSource,
  PolicyMissingField,
  Product
} from "@agentguard/shared";

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

const missingFieldNames: PolicyMissingField[] = [
  "budget",
  "autoApprovalLimit",
  "allowedMerchants",
  "allowedCategories",
  "deadline"
];

const fieldSourceNames: PolicyFieldSource[] = [
  "user",
  "catalog",
  "ai",
  "safe_default",
  "needs_confirmation"
];

const toDraft = (value: unknown, prompt: string, products: Product[]): PolicyDraft => {
  if (!value || typeof value !== "object") throw new Error("invalid_policy_json");
  const record = value as Record<string, unknown>;
  const baseline = createFallbackPolicyDraft(prompt, { availableProducts: products });
  const merchants = [...new Set(products.map((product) => product.merchant))];
  const categories = [...new Set(products.map((product) => product.category))];
  const parsedMissingFields = Array.isArray(record.missingFields)
    ? record.missingFields.map(String).filter((field): field is PolicyMissingField => (
      missingFieldNames.includes(field as PolicyMissingField)
    ))
    : baseline.missingFields;
  const parsedSources = record.fieldSources && typeof record.fieldSources === "object"
    ? Object.fromEntries(
      Object.entries(record.fieldSources as Record<string, unknown>)
        .filter(([key, source]) => (
          ["name", ...missingFieldNames].includes(key)
          && fieldSourceNames.includes(String(source) as PolicyFieldSource)
        ))
        .map(([key, source]) => [key, String(source)])
    ) as Partial<Record<PolicyFieldKey, PolicyFieldSource>>
    : baseline.fieldSources;
  const draft: PolicyDraft = {
    name: String(record.name ?? baseline.name),
    sourceText: prompt,
    budget: Number.isFinite(Number(record.budget)) ? Number(record.budget) : baseline.budget,
    autoApprovalLimit: Number.isFinite(Number(record.autoApprovalLimit))
      ? Number(record.autoApprovalLimit)
      : baseline.autoApprovalLimit,
    currency: "KRW",
    allowedMerchants: Array.isArray(record.allowedMerchants)
      ? record.allowedMerchants.map(String).filter((merchant) => merchants.includes(merchant))
      : baseline.allowedMerchants,
    allowedCategories: Array.isArray(record.allowedCategories)
      ? record.allowedCategories.map(String).filter((category) => categories.includes(category))
      : baseline.allowedCategories,
    deadline: String(record.deadline ?? baseline.deadline),
    requireHumanApproval: typeof record.requireHumanApproval === "boolean"
      ? record.requireHumanApproval
      : baseline.requireHumanApproval,
    provider: "kiln",
    warnings: Array.isArray(record.warnings) ? record.warnings.map(String) : baseline.warnings,
    missingFields: parsedMissingFields,
    clarifyingQuestions: Array.isArray(record.clarifyingQuestions)
      ? record.clarifyingQuestions.map(String)
      : baseline.clarifyingQuestions,
    fieldSources: parsedSources
  };
  const errors = validatePolicyDraft(draft, { allowIncomplete: true });
  if (errors.length > 0) throw new Error(errors.join(" "));
  return draft;
};

async function interpretWithKiln(prompt: string, products: Product[]) {
  const configuration = getConfiguration();
  const catalog = products.map((product) => ({
    merchant: product.merchant,
    category: product.category,
    product: product.name
  }));
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
          content: `You convert Korean spending instructions into grounded spending-policy JSON. Today is ${today}. Catalog: ${JSON.stringify(catalog)}. Return only JSON with name, budget, autoApprovalLimit, allowedMerchants, allowedCategories, deadline (ISO 8601), requireHumanApproval, warnings, missingFields, clarifyingQuestions, fieldSources. missingFields may contain only budget, autoApprovalLimit, allowedMerchants, allowedCategories, deadline. fieldSources may use user, catalog, ai, safe_default, needs_confirmation. Never invent a merchant or category outside the catalog. Never infer an auto-approval amount or deadline that the user did not specify: use a conservative temporary value, add the field to missingFields, and ask one concise Korean clarifying question. Distinguish gaming monitors from keyboards and ground category and merchants in the catalog.`
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
  return toDraft(JSON.parse(stripCodeFence(content)), prompt, products);
}

export async function interpretPolicy(prompt: string, products: Product[]) {
  const status = getAiStatus();
  if (status.configured) {
    try {
      return await interpretWithKiln(prompt, products);
    } catch {
      const fallback = createFallbackPolicyDraft(prompt, { availableProducts: products });
      fallback.warnings.unshift("Kiln 응답을 사용할 수 없어 안전 규칙 변환기로 처리했습니다.");
      return fallback;
    }
  }
  return createFallbackPolicyDraft(prompt, { availableProducts: products });
}
