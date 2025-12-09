import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
    // We don't throw here to allow build time, but run time will fail
    console.warn("OPENAI_API_KEY is not set in environment variables");
}

const openai = new OpenAI({
    apiKey: apiKey || "dummy",
});

export async function callChatWithSchema<T>(
    schema: z.ZodSchema<T>,
    params: {
        systemPrompt: string;
        userPrompt: string;
        model?: string;
        additionalMessages?: { role: "system" | "user" | "assistant"; content: string }[];
    }
): Promise<T> {
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

    const model = params.model || "gpt-4o-2024-08-06"; // structured outputs supported model

    const messages: any[] = [
        { role: "system", content: params.systemPrompt },
        ...(params.additionalMessages || []),
        { role: "user", content: params.userPrompt },
    ];

    const completion = await openai.beta.chat.completions.parse({
        model: model,
        messages: messages,
        response_format: zodResponseFormat(schema, "output"),
    });

    const refusal = completion.choices[0].message.refusal;
    if (refusal) {
        throw new Error(`OpenAI refused: ${refusal}`);
    }

    const result = completion.choices[0].message.parsed;
    if (!result) {
        throw new Error("OpenAI failed to parse output");
    }

    return result;
}

export async function embedText(text: string): Promise<number[]> {
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

    const response = await openai.embeddings.create({
        model: "text-embedding-3-large",
        input: text,
    });

    return response.data[0].embedding;
}
