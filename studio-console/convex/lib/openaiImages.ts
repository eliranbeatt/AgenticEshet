import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;
const DEFAULT_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1.5";

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
    let response: Awaited<ReturnType<typeof openai.images.generate>>;
    try {
        response = await openai.images.generate({
            model,
            prompt: args.prompt,
            size: args.size || "1024x1024",
            response_format: "b64_json",
        });
    } catch (error) {
        const message = typeof error === "object" && error ? String((error as { message?: unknown }).message) : "";
        const param = typeof error === "object" && error ? (error as { param?: unknown }).param : undefined;
        const isResponseFormatError =
            message.toLowerCase().includes("response_format") || String(param).toLowerCase() === "response_format";

        if (!isResponseFormatError) throw error;

        response = await openai.images.generate({
            model,
            prompt: args.prompt,
            size: args.size || "1024x1024",
        });
    }

    let base64Png = response.data?.[0]?.b64_json;
    if (!base64Png) {
        const url = response.data?.[0]?.url;
        if (!url) throw new Error("OpenAI returned no image data");

        const fetchResponse = await fetch(url);
        if (!fetchResponse.ok) {
            throw new Error(`Failed to download generated image: ${fetchResponse.status}`);
        }
        const arrayBuffer = await fetchResponse.arrayBuffer();
        base64Png = arrayBufferToBase64(arrayBuffer);
    }
    return { base64Png, model };
}

function arrayBufferToBase64(arrayBuffer: ArrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}
