import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";

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
    maxRetries?: number;
    retryDelayMs?: number;
};

const apiKey = process.env.OPENAI_API_KEY;
export const DEFAULT_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4o-2024-08-06";
// Default to a 1536-d model to match the vector index. Larger models are down-projected.
export const DEFAULT_EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";

if (!apiKey) {
    console.warn("OPENAI_API_KEY is not set in environment variables");
}

const openai = new OpenAI({
    apiKey: apiKey || "dummy",
});
const openaiClient = openai as any;

export async function callChatWithSchema<T>(
    schema: z.ZodSchema<T>,
    params: ChatParams
): Promise<T> {
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

    const model = params.model || DEFAULT_CHAT_MODEL;
    const maxRetries = params.maxRetries ?? 3;
    const retryDelayMs = params.retryDelayMs ?? 500;

    const messages: ChatMessage[] = [
        { role: "system", content: params.systemPrompt },
        ...(params.additionalMessages || []),
        { role: "user", content: params.userPrompt },
    ];

    let lastError: unknown;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            // Prefer the structured parse API when available; otherwise fall back to JSON mode.
            if (openaiClient.beta?.chat?.completions?.parse) {
                const completion = await openaiClient.beta.chat.completions.parse({
                    model,
                    temperature: params.temperature ?? 0,
                    messages,
                    response_format: zodResponseFormat(schema, "output"),
                });

                const refusal = completion.choices?.[0]?.message?.refusal;
                if (refusal) {
                    throw new Error(`OpenAI refused request: ${refusal}`);
                }

                const result = completion.choices?.[0]?.message?.parsed;
                if (!result) {
                    throw new Error("OpenAI returned an empty response");
                }
                return result;
            }

            const completion = await openai.chat.completions.create({
                model,
                temperature: params.temperature ?? 0,
                messages,
                response_format: zodResponseFormat(schema, "output"),
            });
            const parsedChoice = (completion as unknown as {
                choices?: Array<{ message?: { parsed?: T; content?: unknown } }>;
            }).choices?.[0]?.message;

            if (parsedChoice?.parsed) {
                return parsedChoice.parsed;
            }

            const raw = parsedChoice?.content;
            if (!raw) {
                throw new Error("OpenAI returned an empty response");
            }
            const content = Array.isArray(raw)
                ? raw.map((part) => (typeof part === "string" ? part : (part as { text?: string }).text || "")).join("")
                : raw;
            return schema.parse(JSON.parse(content as string));
        } catch (error) {
            lastError = error;
            if (attempt === maxRetries - 1) break;
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
        }
    }

    throw new Error(
        `OpenAI chat completion failed after ${maxRetries} attempts: ${
            lastError instanceof Error ? lastError.message : "Unknown error"
        }`
    );
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
        `OpenAI embeddings failed after ${maxRetries} attempts: ${
            lastError instanceof Error ? lastError.message : "Unknown error"
        }`
    );
}
