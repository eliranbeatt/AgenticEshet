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
export const DEFAULT_EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-large";

if (!apiKey) {
    console.warn("OPENAI_API_KEY is not set in environment variables");
}

const openai = new OpenAI({
    apiKey: apiKey || "dummy",
});

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
            const completion = await openai.beta.chat.completions.parse({
                model,
                temperature: params.temperature ?? 0,
                messages,
                response_format: zodResponseFormat(schema, "output"),
            });

            const refusal = completion.choices[0].message.refusal;
            if (refusal) {
                throw new Error(`OpenAI refused request: ${refusal}`);
            }

            const result = completion.choices[0].message.parsed;
            if (!result) {
                throw new Error("OpenAI returned an empty response");
            }

            return result;
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

export async function embedText(text: string, options?: { model?: string; maxRetries?: number; retryDelayMs?: number }): Promise<number[]> {
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

    const model = options?.model || DEFAULT_EMBED_MODEL;
    const maxRetries = options?.maxRetries ?? 3;
    const retryDelayMs = options?.retryDelayMs ?? 500;

    let lastError: unknown;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await openai.embeddings.create({
                model,
                input: text,
            });

            return response.data[0].embedding;
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
