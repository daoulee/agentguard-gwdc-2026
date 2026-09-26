import { createFallbackPolicyDraft, validatePolicyDraft } from "@agentguard/policy";
import type {
  AiStatusResponse,
  AiUsageRecord,
  PolicyDraft,
  PolicyFieldKey,
  PolicyFieldSource,
  PolicyMissingField,
  Product
} from "@agentguard/shared";

type KilnResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

type UsageResult = Omit<AiUsageRecord, "id" | "occurredAt">;

const getConfiguration = () => ({
  apiUrl: process.env.KILN_API_URL?.trim() ?? "",
  apiKey: process.env.KILN_API_KEY?.trim() ?? "",
  model: process.env.KILN_MODEL?.trim() || "Qwen3-32B"
});

export function getAiStatus(): AiStatusResponse {
  const configuration = getConfiguration();
  const configured = Boolean(configuration.apiUrl && configuration.apiKey);
  return {
    provider: configured ? `Kiln · ${configuration.model}` : "Safe fallback parser",
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
  const modelCategories = Array.isArray(record.allowedCategories)
    ? record.allowedCategories.map(String).filter((category) => categories.includes(category))
    : [];
  const allowedCategories = baseline.missingFields.includes("allowedCategories") && modelCategories.length > 0
    ? modelCategories
    : baseline.allowedCategories;
  const matchingMerchants = new Set(products
    .filter((product) => allowedCategories.includes(product.category))
    .map((product) => product.merchant));
  const modelMerchants = Array.isArray(record.allowedMerchants)
    ? record.allowedMerchants.map(String).filter((merchant) => merchants.includes(merchant) && matchingMerchants.has(merchant))
    : [];
  const allowedMerchants = baseline.missingFields.includes("allowedMerchants") && modelMerchants.length > 0
    ? modelMerchants
    : baseline.allowedMerchants.filter((merchant) => matchingMerchants.has(merchant));
  const parsedMissingFields = Array.isArray(record.missingFields)
    ? record.missingFields.map(String).filter((field): field is PolicyMissingField => (
      missingFieldNames.includes(field as PolicyMissingField)
    ))
    : baseline.missingFields;
  const missingFields = [...new Set([...baseline.missingFields, ...parsedMissingFields])];
  const baselineQuestions = new Map(baseline.missingFields.map((field, index) => [field, baseline.clarifyingQuestions[index]]));
  const aiQuestions = Array.isArray(record.clarifyingQuestions) ? record.clarifyingQuestions.map(String) : [];
  const aiQuestionMap = new Map(parsedMissingFields.map((field, index) => [field, aiQuestions[index]]));
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
  const fieldSources = { ...baseline.fieldSources, ...parsedSources };
  for (const field of ["budget", "autoApprovalLimit", "deadline"] as const) {
    fieldSources[field] = baseline.fieldSources[field] ?? "safe_default";
  }
  if (!baseline.missingFields.includes("allowedCategories")) {
    fieldSources.allowedCategories = baseline.fieldSources.allowedCategories ?? "safe_default";
    fieldSources.name = baseline.fieldSources.name ?? "safe_default";
  }
  if (!baseline.missingFields.includes("allowedMerchants")) {
    fieldSources.allowedMerchants = baseline.fieldSources.allowedMerchants ?? "safe_default";
  }
  for (const field of missingFields) fieldSources[field] = "needs_confirmation";
  const draft: PolicyDraft = {
    name: baseline.missingFields.includes("allowedCategories") ? String(record.name ?? baseline.name) : baseline.name,
    sourceText: prompt,
    budget: baseline.budget,
    autoApprovalLimit: baseline.autoApprovalLimit,
    currency: "KRW",
    allowedMerchants,
    allowedCategories,
    deadline: baseline.missingFields.includes("deadline") ? baseline.deadline : String(record.deadline ?? baseline.deadline),
    requireHumanApproval: baseline.requireHumanApproval || missingFields.includes("autoApprovalLimit"),
    provider: "kiln",
    warnings: [...new Set([...baseline.warnings, ...(Array.isArray(record.warnings) ? record.warnings.map(String) : [])])],
    missingFields,
    clarifyingQuestions: missingFields.map((field) => baselineQuestions.get(field) ?? aiQuestionMap.get(field) ?? `${field} 조건을 확인해주세요.`),
    fieldSources
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
  const tokens = payload.usage;
  const validTokens = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
  return {
    draft: toDraft(JSON.parse(stripCodeFence(content)), prompt, products),
    usage: {
      promptTokens: validTokens(tokens?.prompt_tokens),
      completionTokens: validTokens(tokens?.completion_tokens),
      totalTokens: validTokens(tokens?.total_tokens)
    }
  };
}

export async function interpretPolicy(prompt: string, products: Product[]) {
  const status = getAiStatus();
  if (status.configured) {
    try {
      const result = await interpretWithKiln(prompt, products);
      return {
        draft: result.draft,
        usage: { flow: "policy_interpretation", provider: "kiln", model: status.model, status: "success", ...result.usage } as UsageResult
      };
    } catch {
      const fallback = createFallbackPolicyDraft(prompt, { availableProducts: products });
      fallback.warnings.unshift("Kiln 응답을 사용할 수 없어 안전 규칙 변환기로 처리했습니다.");
      return { draft: fallback, usage: emptyUsage(status.model, "failed") };
    }
  }
  return {
    draft: createFallbackPolicyDraft(prompt, { availableProducts: products }),
    usage: emptyUsage(status.model, "not_configured")
  };
}

const emptyUsage = (model: string, status: UsageResult["status"]): UsageResult => ({
  flow: "policy_interpretation",
  provider: "safe_fallback",
  model,
  status,
  promptTokens: null,
  completionTokens: null,
  totalTokens: null
});
