type ImagenPredictResponse = {
    predictions?: Array<{
        bytesBase64Encoded?: string;
        mimeType?: string;
    }>;
    generatedImages?: Array<{
        bytesBase64Encoded?: string;
        mimeType?: string;
    }>;
    error?: { message?: string };
};

const apiKey = process.env.GOOGLE_API_KEY;

if (!apiKey) {
    console.warn("GOOGLE_API_KEY is not set in environment variables");
}

export async function generateImageBase64WithGemini(args: {
    prompt: string;
    model: string;
    sampleCount?: number;
}): Promise<{ base64: string; mimeType: string; model: string }> {
    if (!apiKey) throw new Error("GOOGLE_API_KEY is not set");

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:predict?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            instances: [{ prompt: args.prompt }],
            parameters: { sampleCount: args.sampleCount ?? 1 },
        }),
    });

    const payload = (await response.json().catch(() => ({}))) as ImagenPredictResponse;
    if (!response.ok) {
        throw new Error(payload.error?.message ?? `Gemini image request failed (${response.status})`);
    }

    const image =
        payload.predictions?.[0]?.bytesBase64Encoded ?? payload.generatedImages?.[0]?.bytesBase64Encoded ?? null;
    const mimeType = payload.predictions?.[0]?.mimeType ?? payload.generatedImages?.[0]?.mimeType ?? "image/png";
    if (!image) throw new Error("Gemini returned no image data");
    return { base64: image, mimeType, model: args.model };
}

