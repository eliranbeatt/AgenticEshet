import OpenAI from "openai";
import { z } from "zod";

type ChatMessage = {
    role: "system" | "user" | "assistant";
    content: string;
};

type ChatParams = {
    systemPrompt: string;
    userPrompt: string;
    model?: string;
    additionalMessages?: ChatMessage[];
    temperature?: number;
    thinkingMode?: boolean;
    language?: "he" | "en";
    maxRetries?: number;
    retryDelayMs?: number;
};

type ResponseTextFormat =
    | { type: "text" }
    | { type: "json_object" }
    | { type: "json_schema"; name: string; schema: Record<string, unknown>; strict: true };

const GLOBAL_LANGUAGE_INSTRUCTIONS = [
    "Language requirement:",
    "- All user-facing text must be in Hebrew (עברית).",
    "- If returning JSON, keep keys exactly as required by the schema; do not translate keys.",
    "- Keep code identifiers/tool names in English when necessary, but explain them in Hebrew.",
].join("\n");

const apiKey = process.env.OPENAI_API_KEY;
export const DEFAULT_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-5.2";
// Default to a 1536-d model to match the vector index. Larger models are down-projected.
export const DEFAULT_EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";

if (!apiKey) {
    console.warn("OPENAI_API_KEY is not set in environment variables");
}

const openai = new OpenAI({
    apiKey: apiKey || "dummy",
});

function extractJson(text: string): unknown {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        throw new Error("OpenAI response did not contain JSON");
    }

    const candidate = text.slice(firstBrace, lastBrace + 1);
    try {
        return JSON.parse(candidate);
    } catch {
        const stripped = candidate
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/```\s*$/i, "");
        return JSON.parse(stripped);
    }
}

function formatConversation(messages: ChatMessage[]): string {
    return messages
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join("\n");
}

function buildJsonSchemaFormat(schema: z.ZodSchema<unknown>, name: string) {
    return {
        type: "json_schema" as const,
        name,
        schema: z.toJSONSchema(schema) as Record<string, unknown>,
        strict: true,
    } satisfies ResponseTextFormat;
}

function shouldFallbackFromJsonSchema(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return (
        message.includes("json_schema") ||
        message.includes("response format") ||
        message.includes("invalid schema") ||
        message.includes("unsupported") ||
        message.includes("strict schema")
    );
}

function supportsTemperature(model: string): boolean {
    // gpt-5 reasoning models currently reject the temperature parameter.
    const lower = model.toLowerCase();
    if (lower.startsWith("gpt-5") || lower.startsWith("gpt5")) return false;
    return true;
}

function supportsReasoningEffort(model: string): boolean {
    const lower = model.toLowerCase();
    return lower.startsWith("gpt-5") || lower.startsWith("gpt5");
}

export async function callChatWithSchema<T>(
    schema: z.ZodSchema<T>,
    params: ChatParams
): Promise<T> {
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

    const model = params.model || DEFAULT_CHAT_MODEL;
    const maxRetries = params.maxRetries ?? 3;
    const retryDelayMs = params.retryDelayMs ?? 500;

    const additionalMessages = params.additionalMessages || [];

    const languageOverride =
        params.language === "en"
            ? [
                "Language override:",
                "- All user-facing text must be in English.",
                "- If returning JSON, keep keys exactly as required by the schema; do not translate keys.",
            ].join("\n")
            : null;

    const systemInstructions = [
        params.systemPrompt,
        ...additionalMessages
            .filter((message) => message.role === "system")
            .map((message) => message.content),
        GLOBAL_LANGUAGE_INSTRUCTIONS,
        languageOverride,
    ]
        .filter(Boolean)
        .join("\n\n");

    const transcriptMessages: ChatMessage[] = [
        ...additionalMessages.filter((message) => message.role !== "system"),
        { role: "user", content: params.userPrompt },
    ];

    let lastError: unknown;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const createResponse = async (format: ResponseTextFormat) => {
                const jsonHint =
                    format.type === "json_object" || format.type === "json_schema"
                        ? "\n\nReturn valid JSON only."
                        : "";
                const jsonHintInput =
                    format.type === "json_object" || format.type === "json_schema"
                        ? "\n\nReturn valid JSON only."
                        : "";
                return await openai.responses.create({
                    model,
                    instructions: `${systemInstructions}${jsonHint}`,
                    input: `${formatConversation(transcriptMessages)}${jsonHintInput}`,
                    ...(supportsTemperature(model) ? { temperature: params.temperature ?? 0 } : {}),
                    ...(supportsReasoningEffort(model)
                        ? { reasoning: { effort: params.thinkingMode ? "high" : "low" } }
                        : {}),
                    text: { format, verbosity: params.thinkingMode ? "medium" : "low" },
                    parallel_tool_calls: true,
                });
            };

            let response;
            try {
                response = await createResponse(buildJsonSchemaFormat(schema, "output"));
            } catch (error) {
                if (!shouldFallbackFromJsonSchema(error)) throw error;
                response = await createResponse({ type: "json_object" });
            }

            if (response.error) {
                throw new Error(`OpenAI response error: ${response.error.message ?? "Unknown error"}`);
            }

            const outputText = response.output_text ?? "";
            if (!outputText.trim()) {
                throw new Error("OpenAI returned an empty response");
            }

            const extracted = extractJson(outputText);
            const parsed = schema.safeParse(extracted);
            if (!parsed.success) {
                console.error("OpenAI Validation Error:", parsed.error.format());
                console.error("Raw Output:", outputText);
                throw new Error(`Failed to validate OpenAI JSON: ${parsed.error.message}. Received: ${JSON.stringify(extracted).slice(0, 200)}`);
            }
            return parsed.data;
        } catch (error) {
            lastError = error;
            if (attempt === maxRetries - 1) break;
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
        }
    }

    throw new Error(
        `OpenAI chat completion failed after ${maxRetries} attempts: ${lastError instanceof Error ? lastError.message : "Unknown error"
        }`
    );
}

export async function streamChatText(
    params: ChatParams & { onDelta: (delta: string) => Promise<void> }
): Promise<string> {
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

    const model = params.model || DEFAULT_CHAT_MODEL;
    const additionalMessages = params.additionalMessages || [];

    const languageOverride =
        params.language === "en"
            ? [
                "Language override:",
                "- All user-facing text must be in English.",
                "- Keep user-facing content in English even if other instructions mention Hebrew.",
            ].join("\n")
            : null;

    const systemInstructions = [
        params.systemPrompt,
        ...additionalMessages
            .filter((message) => message.role === "system")
            .map((message) => message.content),
        GLOBAL_LANGUAGE_INSTRUCTIONS,
        languageOverride,
    ]
        .filter(Boolean)
        .join("\n\n");

    const transcriptMessages: ChatMessage[] = [
        ...additionalMessages.filter((message) => message.role !== "system"),
        { role: "user", content: params.userPrompt },
    ];

    const stream = openai.responses.stream({
        model,
        instructions: systemInstructions,
        input: formatConversation(transcriptMessages),
        ...(supportsTemperature(model) ? { temperature: params.temperature ?? 0 } : {}),
        ...(supportsReasoningEffort(model)
            ? { reasoning: { effort: params.thinkingMode ? "high" : "low" } }
            : {}),
        text: { format: { type: "text" }, verbosity: params.thinkingMode ? "medium" : "low" },
        parallel_tool_calls: true,
    });

    let lastSnapshot = "";
    stream.on("response.output_text.delta", async (event) => {
        lastSnapshot = event.snapshot;
        if (event.delta) {
            await params.onDelta(event.delta);
        }
    });

    const final = await stream.finalResponse();
    return final.output_text ?? lastSnapshot;
}

export function normalizeEmbedding(embedding: number[]): number[] {
    if (embedding.length === 1536) {
        return embedding;
    }

    if (embedding.length === 3072) {
        // Down-project 3072-d embeddings (e.g., text-embedding-3-large) to 1536 by averaging pairs.
        return embedding.reduce((acc: number[], val: number, idx: number) => {
            const targetIdx = Math.floor(idx / 2);
            acc[targetIdx] = (acc[targetIdx] ?? 0) + val / 2;
            return acc;
        }, new Array(1536).fill(0));
    }

    throw new Error(`Unexpected embedding dimensions: ${embedding.length}`);
}

export async function embedText(
    text: string,
    options?: { model?: string; maxRetries?: number; retryDelayMs?: number; normalize?: boolean }
): Promise<number[]> {
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

    const model = options?.model || DEFAULT_EMBED_MODEL;
    const maxRetries = options?.maxRetries ?? 3;
    const retryDelayMs = options?.retryDelayMs ?? 500;
    const normalize = options?.normalize ?? true;

    let lastError: unknown;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await openai.embeddings.create({
                model,
                input: text,
            });

            const embedding = response.data[0].embedding;
            return normalize ? normalizeEmbedding(embedding) : embedding;
        } catch (error) {
            lastError = error;
            if (attempt === maxRetries - 1) break;
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
        }
    }

    throw new Error(
        `OpenAI embeddings failed after ${maxRetries} attempts: ${lastError instanceof Error ? lastError.message : "Unknown error"
        }`
    );
}
