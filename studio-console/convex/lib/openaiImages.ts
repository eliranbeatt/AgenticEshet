import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;
const DEFAULT_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";

if (!apiKey) {
    console.warn("OPENAI_API_KEY is not set in environment variables");
}

const openai = new OpenAI({
    apiKey: apiKey || "dummy",
});

export async function generateImageBase64Png(args: {
    prompt: string;
    model?: string;
    size?: "1024x1024" | "1024x1536" | "1536x1024";
}): Promise<{ base64Png: string; model: string }> {
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

    const model = args.model || DEFAULT_IMAGE_MODEL;
    const response = await openai.images.generate({
        model,
        prompt: args.prompt,
        size: args.size || "1024x1024",
        response_format: "b64_json",
    });

    const base64Png = response.data?.[0]?.b64_json;
    if (!base64Png) throw new Error("OpenAI returned no image data");
    return { base64Png, model };
}

