import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";

const apiKey = process.env.GOOGLE_API_KEY;

if (!apiKey) {
  console.warn("GOOGLE_API_KEY is not set in environment variables");
}

const genAI = new GoogleGenerativeAI(apiKey || "dummy");

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
  maxOptions: number;
}): Promise<ResearchResult> {
  if (!apiKey) throw new Error("GOOGLE_API_KEY is not set");

  const model = genAI.getGenerativeModel({ model: "gemini-pro" });

  const prompt = [
    "You are a buying assistant.",
    "Return STRICT JSON only (no markdown, no prose).",
    "Task: Provide a concise buying comparison for the item below.",
    `Item: ${params.queryText}`,
    `Preferred currency: ${params.currency}`,
    params.location ? `Location/region: ${params.location}` : "",
    params.unit ? `Preferred unit: ${params.unit}` : "",
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

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const parsed = ResearchSchema.safeParse(extractJson(text));
  if (!parsed.success) {
    throw new Error(`Failed to validate research JSON: ${parsed.error.message}`);
  }

  const cappedOptions = parsed.data.options.slice(0, params.maxOptions);
  const reportMarkdown = [
    `## Summary\n${parsed.data.summary}`,
    "\n## Options",
    ...cappedOptions.map((o) => {
      const price = o.price
        ? `${o.price.min ?? "?"}-${o.price.max ?? "?"} ${o.price.currency}/${o.price.unit}`
        : "(price unknown)";
      const lead = o.leadTimeDays != null ? `${o.leadTimeDays} days` : "unknown";
      const url = o.vendorUrl ? ` (${o.vendorUrl})` : "";
      return `- **${o.vendorName}**${url}: ${price}, lead: ${lead}. ${o.notes ?? ""}`.trim();
    }),
    "\n## Citations",
    ...parsed.data.citations.slice(0, 10).map((c) => `- [${c.title}](${c.url}) — ${c.snippet}`),
  ].join("\n");

  return {
    ...parsed.data,
    options: cappedOptions,
    reportMarkdown,
  };
}
