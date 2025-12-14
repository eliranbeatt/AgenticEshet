type GeminiInteraction = {
    id: string;
    status?: "in_progress" | "completed" | "failed";
    error?: string;
    outputs?: Array<{
        text?: string;
        content?: unknown;
    }>;
};

function requireGoogleApiKey() {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_API_KEY is not set");
    return apiKey;
}

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

async function geminiRequest<T>(params: {
    method: "GET" | "POST";
    path: string;
    body?: unknown;
}): Promise<T> {
    const apiKey = requireGoogleApiKey();
    const url = `${BASE_URL}${params.path}${params.path.includes("?") ? "&" : "?"}key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
        method: params.method,
        headers: { "Content-Type": "application/json" },
        body: params.body ? JSON.stringify(params.body) : undefined,
    });

    const payload = (await response.json().catch(() => ({}))) as unknown;
    if (!response.ok) {
        const message =
            (payload as { error?: { message?: string } } | null)?.error?.message ??
            `Gemini request failed (${response.status})`;
        throw new Error(message);
    }
    return payload as T;
}

export async function createDeepResearchInteraction(params: {
    input: string;
    agent?: string;
}): Promise<GeminiInteraction> {
    return await geminiRequest<GeminiInteraction>({
        method: "POST",
        path: "/interactions",
        body: {
            input: params.input,
            agent: params.agent ?? "deep-research-pro-preview-12-2025",
            background: true,
            store: true,
            agent_config: {
                type: "deep-research",
                thinking_summaries: "auto",
            },
        },
    });
}

export async function getInteraction(params: { id: string }): Promise<GeminiInteraction> {
    return await geminiRequest<GeminiInteraction>({
        method: "GET",
        path: `/interactions/${encodeURIComponent(params.id)}`,
    });
}
