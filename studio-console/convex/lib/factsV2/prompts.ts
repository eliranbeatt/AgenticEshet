const CATEGORY_LIST = [
    "constraints",
    "dimensions",
    "materials",
    "logistics",
    "timeline",
    "stakeholders",
    "budget",
    "preferences",
    "risks",
    "other",
] as const;

export type FactCategory = typeof CATEGORY_LIST[number];

export const CATEGORY_HINT = CATEGORY_LIST.join(", ");

export const SYSTEM_PROMPT = `You are a Fact Extraction Engine.
Extract atomic facts from the provided bundle text.

Rules:
1) Output Hebrew facts only (factTextHe).
2) Each fact must be a single atomic statement.
3) If directly supported by a quote in the bundle, set sourceTier="user_evidence" and include evidence.
4) If inferred beyond direct evidence, set sourceTier="hypothesis" (evidence optional).
5) Keep facts concise. No extra commentary.
6) Scope must be "project" or "item". Use itemId only if confidently linked.
7) Use category from the allowed list: ${CATEGORY_HINT}.
8) Do not invent keys. key is optional and should be used only if it is a clear grouping key.
9) Confidence must be 0..1. Importance must be 1..5.
10) Evidence objects must include quoteHe and should include startChar/endChar offsets within the provided text; if unknown, set startChar/endChar to 0.
11) Evidence should include sourceSection (e.g. "TURN_META", "STRUCTURED_QUESTIONS", "USER_ANSWERS", "FREE_CHAT", "AGENT_OUTPUT") and sourceKind ("user", "doc", "agentOutput").

Output JSON only.`;

export function buildUserPrompt(args: {
    bundleText: string;
    items: { id: string; name: string }[];
    acceptedFacts: { factTextHe: string; scopeType: string; itemId?: string | null }[];
}): string {
    return [
        "CONTEXT SNAPSHOT:",
        `Items: ${JSON.stringify(args.items)}`,
        `Accepted Facts: ${JSON.stringify(args.acceptedFacts)}`,
        "",
        "TURN BUNDLE:",
        args.bundleText,
    ].join("\n");
}
