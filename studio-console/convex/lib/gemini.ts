import { z } from "zod";

const apiKey = process.env.GOOGLE_API_KEY;

if (!apiKey) {
  console.warn("GOOGLE_API_KEY is not set in environment variables");
}

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    groundingMetadata?: unknown;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
};

async function generateText(params: { prompt: string; model: string; useGoogleSearch: boolean }): Promise<string> {
  if (!apiKey) throw new Error("GOOGLE_API_KEY is not set");

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(params.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: params.prompt }] }],
      tools: params.useGoogleSearch ? [{ google_search: {} }] : undefined,
    }),
  });

  const payload = (await response
    .json()
    .catch(() => ({}))) as GeminiGenerateContentResponse;

  if (!response.ok) {
    const message = payload?.error?.message ?? `Gemini request failed (${response.status})`;
    throw new Error(message);
  }

  if (payload.promptFeedback?.blockReason) {
    throw new Error(`Gemini request blocked: ${payload.promptFeedback.blockReason}`);
  }

  const text = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) throw new Error("Gemini response was empty");
  return text;
}

const ResearchSchema = z.object({
  summary: z.string(),
  options: z.array(
    z.object({
      vendorName: z.string(),
      vendorUrl: z.string().url().optional(),
      price: z
        .object({
          min: z.number().nonnegative().optional(),
          max: z.number().nonnegative().optional(),
          currency: z.string().default("ILS"),
          unit: z.string(),
        })
        .optional(),
      leadTimeDays: z.number().int().nonnegative().optional(),
      location: z.string().optional(),
      notes: z.string().optional(),
      confidence: z.enum(["low", "medium", "high"]).default("low"),
    })
  ),
  citations: z.array(
    z.object({
      title: z.string(),
      url: z.string().url(),
      snippet: z.string(),
    })
  ),
});

export type ResearchResult = z.infer<typeof ResearchSchema> & {
  reportMarkdown: string;
};

function extractJson(text: string): unknown {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("Gemini response did not contain JSON");
  }
  const candidate = text.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    // Try stripping common markdown fences
    const stripped = candidate
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "");
    return JSON.parse(stripped);
  }
}

export async function performResearch(params: {
  queryText: string;
  currency: string;
  unit?: string;
  location?: string;
  procurement?: "in_stock" | "local" | "abroad" | "either";
  maxOptions: number;
}): Promise<ResearchResult> {
  if (!apiKey) throw new Error("GOOGLE_API_KEY is not set");

  const procurementRules =
    params.procurement === "in_stock"
      ? [
          "Procurement mode: IN STOCK.",
          "Do not search for buying links. Only estimate an ILS unit price from common market knowledge; mark confidence as low unless strongly supported by citations.",
          "If you cannot estimate, return an empty options array and explain in summary.",
        ]
      : params.procurement === "local"
        ? [
            "Procurement mode: BUY LOCALLY (ISRAEL ONLY).",
            "Only include Israeli vendors / Israeli sites. Avoid AliExpress/Amazon/Shein or other international marketplaces.",
            "Prefer prices already in ILS; if converting, state conversion assumptions in notes.",
          ]
        : params.procurement === "abroad"
          ? [
              "Procurement mode: ORDER ABROAD.",
              "Focus on AliExpress, Amazon, Shein, or similar international marketplaces.",
              "All options MUST ship to Israel. Price ranges must reflect total delivered price to Israel (item + shipping). If shipping is unknown, estimate and say so in notes.",
            ]
          : [
              "Procurement mode: LOCAL OR ABROAD.",
              "Include both: at least 1 Israel-local option and at least 1 international option (shipping to Israel) when possible.",
              "Price ranges must reflect total delivered price to Israel (item + shipping) for international options; say what is included.",
            ];

  const prompt = [
    "You are a buying assistant.",
    "Return STRICT JSON only (no markdown, no prose).",
    "Language: Hebrew. All user-facing strings must be in Hebrew (summary, vendorName, unit, location, notes, citation title/snippet). Keep URLs as-is.",
    "Task: Provide a concise buying comparison for the item below.",
    `Item: ${params.queryText}`,
    `Preferred currency: ${params.currency}`,
    params.location ? `Location/region: ${params.location}` : "",
    params.unit ? `Preferred unit: ${params.unit}` : "",
    ...procurementRules,
    `Max options: ${params.maxOptions}`,
    "Output JSON schema:",
    JSON.stringify(
      {
        summary: "string",
        options: [
          {
            vendorName: "string",
            vendorUrl: "https://...",
            price: { min: 0, max: 0, currency: params.currency, unit: params.unit ?? "unit" },
            leadTimeDays: 0,
            location: "string",
            notes: "string",
            confidence: "low|medium|high",
          },
        ],
        citations: [{ title: "string", url: "https://...", snippet: "string" }],
      },
      null,
      2
    ),
  ]
    .filter(Boolean)
    .join("\n");

  const text = await generateText({ prompt, model: "gemini-1.5-flash", useGoogleSearch: true });
  const parsed = ResearchSchema.safeParse(extractJson(text));
  if (!parsed.success) {
    throw new Error(`Failed to validate research JSON: ${parsed.error.message}`);
  }

  const cappedOptions = parsed.data.options.slice(0, params.maxOptions);
  const reportMarkdown = [
    `## סיכום\n${parsed.data.summary}`,
    "\n## אפשרויות",
    ...cappedOptions.map((o) => {
      const price = o.price
        ? `${o.price.min ?? "?"}-${o.price.max ?? "?"} ${o.price.currency}/${o.price.unit}`
        : "(מחיר לא ידוע)";
      const lead = o.leadTimeDays != null ? `${o.leadTimeDays} ימים` : "לא ידוע";
      const url = o.vendorUrl ? ` (${o.vendorUrl})` : "";
      return `- **${o.vendorName}**${url}: ${price}, זמן אספקה: ${lead}. ${o.notes ?? ""}`.trim();
    }),
    "\n## מקורות",
    ...parsed.data.citations.slice(0, 10).map((c) => `- [${c.title}](${c.url}) — ${c.snippet}`),
  ].join("\n");

  return {
    ...parsed.data,
    options: cappedOptions,
    reportMarkdown,
  };
}

export async function generateJsonWithGemini<TSchema extends z.ZodTypeAny>(params: {
  schema: TSchema;
  prompt: string;
  model?: string;
  useGoogleSearch?: boolean;
}): Promise<z.infer<TSchema>> {
  const text = await generateText({
    prompt: params.prompt,
    model: params.model ?? "gemini-1.5-flash",
    useGoogleSearch: params.useGoogleSearch ?? false,
  });

  const parsed = params.schema.safeParse(extractJson(text));
  if (!parsed.success) {
    throw new Error(`Failed to validate Gemini JSON: ${parsed.error.message}`);
  }
  return parsed.data;
}
