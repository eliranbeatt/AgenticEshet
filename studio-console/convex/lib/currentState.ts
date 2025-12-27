type KnowledgeBlock = {
    scopeType?: "project" | "item";
    itemId?: string | null;
    blockKey?: string | null;
    renderedMarkdown?: string | null;
    json?: Record<string, { value?: unknown }> | null;
};

type ItemSummary = {
    id: string;
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

function formatScope(scope?: ItemSummary["scope"]) {
    if (!scope) return "";
    const parts: string[] = [];
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
    return parts.length ? parts.join(" | ") : "";
}

function renderBlocks(blocks: KnowledgeBlock[]) {
    const lines: string[] = [];
    for (const block of blocks) {
        if (block.renderedMarkdown) {
            lines.push(block.renderedMarkdown.trim());
        } else if (block.blockKey) {
            lines.push(`### ${block.blockKey}`);
        }
    }
    return lines.filter(Boolean).join("\n\n");
}

export function buildDerivedCurrentState(args: {
    projectName?: string | null;
    items: ItemSummary[];
    knowledgeBlocks: KnowledgeBlock[];
}) {
    const projectBlocks = args.knowledgeBlocks
        .filter((block) => block.scopeType === "project")
        .sort((a, b) => String(a.blockKey ?? "").localeCompare(String(b.blockKey ?? "")));

    const blocksByItem = new Map<string, KnowledgeBlock[]>();
    for (const block of args.knowledgeBlocks) {
        if (block.scopeType !== "item" || !block.itemId) continue;
        const list = blocksByItem.get(block.itemId) ?? [];
        list.push(block);
        blocksByItem.set(block.itemId, list);
    }

    for (const list of blocksByItem.values()) {
        list.sort((a, b) => String(a.blockKey ?? "").localeCompare(String(b.blockKey ?? "")));
    }

    const lines: string[] = [];
    lines.push("# Current State (Derived)");
    if (args.projectName) lines.push(`_Project: ${args.projectName}_`);
    lines.push("");
    lines.push("## Project Facts");
    const projectMarkdown = renderBlocks(projectBlocks);
    lines.push(projectMarkdown || "(none)");
    lines.push("");
    lines.push("## Items");

    if (args.items.length === 0) {
        lines.push("(none)");
        return lines.join("\n");
    }

    for (const item of args.items) {
        const title = item.title || item.name || "Untitled item";
        const typeKey = item.typeKey ?? "unknown";
        const status = item.status ?? "unknown";
        lines.push(`### Item: ${title}`);
        lines.push(`- Type: ${typeKey}`);
        lines.push(`- Status: ${status}`);
        const scopeLine = formatScope(item.scope);
        if (scopeLine) {
            lines.push(`- Scope: ${scopeLine}`);
        }
        const itemBlocks = blocksByItem.get(item.id) ?? [];
        const itemMarkdown = renderBlocks(itemBlocks);
        if (itemMarkdown) {
            lines.push("");
            lines.push(itemMarkdown);
        }
        lines.push("");
    }

    return lines.join("\n").trim();
}
