type FactEntry = {
    key: string;
    value: unknown;
};

type KnowledgeBlock = {
    scopeType?: string;
    itemId?: string | null;
    blockKey?: string;
    json?: Record<string, { value?: unknown }> | null;
};

type ItemSummary = {
    title?: string;
    name?: string;
    typeKey?: string;
    status?: string;
    scope?: {
        quantity?: number;
        unit?: string;
        dimensions?: string;
        location?: string;
        constraints?: string[];
        assumptions?: string[];
    };
};

type KnowledgeDoc = {
    title?: string;
    summary?: string;
    sourceType?: string;
    keyPoints?: string[];
};

function formatValue(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

export function summarizeFacts(facts: FactEntry[], limit = 30): string {
    if (!facts.length) return "(none)";
    return facts
        .slice(0, limit)
        .map((fact) => `- ${fact.key}: ${formatValue(fact.value)}`)
        .join("\n");
}

export function summarizeKnowledgeBlocks(blocks: KnowledgeBlock[], limit = 12): string {
    if (!blocks.length) return "(none)";
    return blocks.slice(0, limit).map((block) => {
        const scope =
            block.scopeType === "item" ? `item:${block.itemId ?? "unknown"}` : "project";
        const fields = block.json
            ? Object.entries(block.json)
                .slice(0, 6)
                .map(([key, value]) => `${key}=${formatValue(value?.value)}`)
                .filter((entry) => entry.trim().length > 0)
                .join("; ")
            : "";
        const blockKey = block.blockKey ?? "unknown";
        return fields ? `- ${scope} ${blockKey}: ${fields}` : `- ${scope} ${blockKey}`;
    }).join("\n");
}

export function summarizeItems(items: ItemSummary[], limit = 20): string {
    if (!items.length) return "(none)";
    return items.slice(0, limit).map((item) => {
        const title = item.title || item.name || "Untitled item";
        const typeKey = item.typeKey ?? "unknown";
        const status = item.status ?? "unknown";
        const parts = [`${title} [${typeKey}] status=${status}`];
        const scope = item.scope;
        if (scope) {
            if (scope.quantity || scope.unit) {
                const qty = scope.quantity ?? "?";
                const unit = scope.unit ?? "";
                parts.push(`qty=${qty} ${unit}`.trim());
            }
            if (scope.dimensions) parts.push(`dims=${scope.dimensions}`);
            if (scope.location) parts.push(`loc=${scope.location}`);
            if (scope.constraints && scope.constraints.length) {
                parts.push(`constraints=${scope.constraints.slice(0, 3).join("; ")}`);
            }
            if (scope.assumptions && scope.assumptions.length) {
                parts.push(`assumptions=${scope.assumptions.slice(0, 3).join("; ")}`);
            }
        }
        return `- ${parts.join(" | ")}`;
    }).join("\n");
}

export function summarizeKnowledgeDocs(docs: KnowledgeDoc[], limit = 8): string {
    if (!docs.length) return "(none)";
    return docs.slice(0, limit).map((doc) => {
        const source = doc.sourceType ?? "doc";
        const title = doc.title ?? "Untitled";
        const summary = doc.summary ? formatValue(doc.summary) : "";
        const keyPoints = doc.keyPoints && doc.keyPoints.length
            ? ` Key points: ${doc.keyPoints.slice(0, 4).join("; ")}`
            : "";
        return `- [${source}] ${title}${summary ? `: ${summary}` : ""}${keyPoints}`;
    }).join("\n");
}
