import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { callChatWithSchema, streamChatText } from "../lib/openai";
import { syncItemProjections } from "../lib/itemProjections";
import {
    ItemSpecV2Schema,
    SolutionItemPlanV1Schema,
    SolutioningExtractedPlanSchema,
    SolutioningExtractedPlanLooseSchema,
    type ItemSpecV2,
    type SolutionItemPlanV1,
} from "../lib/zodSchemas";
import type { Doc, Id } from "../_generated/dataModel";

const FALLBACK_SYSTEM_PROMPT = [
    "You are a production solutioning expert for a creative studio.",
    "Help the user define exactly how to produce or procure a specific project item.",
    "Be practical, cost-aware, and ask clarifying questions when needed.",
    "Default to the project's default language unless the user explicitly requests otherwise.",
    "When listing step materials, include name, quantity, unit, and estimated unit cost if known.",
].join("\n");

type StepMaterial = {
    name: string;
    quantity?: number;
    unit?: string;
    unitCostEstimate?: number;
    notes?: string;
};

function coerceNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const cleaned = value.trim().replace(/,/g, "");
        if (!cleaned) return undefined;
        const parsed = Number.parseFloat(cleaned);
        if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
}

function parseItemSpec(data: unknown): ItemSpecV2 | null {
    const parsed = ItemSpecV2Schema.safeParse(data);
    if (!parsed.success) return null;
    return parsed.data;
}

function buildBaseItemSpec(item: Doc<"projectItems">): ItemSpecV2 {
    return ItemSpecV2Schema.parse({
        version: "ItemSpecV2",
        identity: {
            title: item.title,
            typeKey: item.typeKey,
        },
    });
}

function withSolutionPlan(spec: ItemSpecV2, planMarkdown: string, planJson?: string | null): ItemSpecV2 {
    const studioWork = spec.studioWork ? { ...spec.studioWork } : { required: true };
    const required = studioWork.required ?? true;
    return ItemSpecV2Schema.parse({
        ...spec,
        studioWork: {
            ...studioWork,
            required,
            buildPlanMarkdown: planMarkdown,
            buildPlanJson: planJson ?? undefined,
        },
    });
}

function parsePlanJson(planJson?: string | null): SolutionItemPlanV1 | null {
    if (!planJson) return null;
    try {
        const parsed = JSON.parse(planJson) as unknown;
        const result = SolutionItemPlanV1Schema.safeParse(parsed);
        if (result.success) return result.data;
        const coerced = coercePlanFromLooseFormat(parsed);
        return coerced ?? null;
    } catch {
        return null;
    }
}

function buildSubtasksFromPlan(plan: SolutionItemPlanV1) {
    return plan.steps.map((step, index) => ({
        id: step.id?.trim() ? step.id : `step:${index + 1}`,
        title: step.title,
        description: [
            step.details,
            formatMaterialList(normalizeStepMaterials(step.materials)),
            step.tools && step.tools.length ? `Tools: ${step.tools.join(", ")}` : "",
        ]
            .filter((line) => line.trim())
            .join("\n"),
        status: "todo",
        estMinutes: step.estimatedMinutes,
    }));
}

function normalizeToken(value: string) {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return "";
    return trimmed
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+/, "")
        .replace(/-+$/, "");
}

function normalizeStepMaterials(
    materials: SolutionItemPlanV1["steps"][number]["materials"],
): StepMaterial[] {
    if (!materials || materials.length === 0) return [];
    const results: StepMaterial[] = [];
    for (const entry of materials) {
        if (typeof entry === "string") {
            const name = entry.trim();
            if (name) results.push({ name });
            continue;
        }
        if (!entry || typeof entry !== "object") continue;
        const candidate = entry as Record<string, unknown>;
        const nameValue = typeof candidate.name === "string" ? candidate.name : "";
        if (!nameValue.trim()) continue;
        const name = nameValue.trim();
        if (!name) continue;
        results.push({
            name,
            quantity: coerceNumber(candidate.quantity),
            unit: typeof candidate.unit === "string" ? candidate.unit : undefined,
            unitCostEstimate: coerceNumber(candidate.unitCostEstimate),
            notes: typeof candidate.notes === "string" ? candidate.notes : undefined,
        });
    }
    return results;
}

function formatMaterialLabel(material: StepMaterial) {
    const parts: string[] = [];
    if (typeof material.quantity === "number") {
        parts.push(material.quantity.toString());
    }
    if (material.unit) {
        parts.push(material.unit);
    }
    if (typeof material.unitCostEstimate === "number") {
        parts.push(`@ ${material.unitCostEstimate}`);
    }
    return parts.length > 0 ? `${material.name} (${parts.join(" ")})` : material.name;
}

function formatMaterialList(materials: StepMaterial[]) {
    if (!materials.length) return "";
    return `Materials: ${materials.map(formatMaterialLabel).join(", ")}`;
}

function deriveMaterialsFromPlan(plan: SolutionItemPlanV1) {
    const materialMap = new Map<string, ItemSpecV2["breakdown"]["materials"][number]>();
    let fallbackIndex = 0;

    for (const [index, step] of plan.steps.entries()) {
        const stepToken = normalizeToken(step.id?.trim() ? step.id : step.title) || `step-${index + 1}`;
        for (const material of normalizeStepMaterials(step.materials)) {
            const label = material.name.trim();
            if (!label) continue;
            const token = normalizeToken(label) || `item-${++fallbackIndex}`;
            const id = `plan-mat:${stepToken}:${token}`;
            if (materialMap.has(id)) continue;
            const descriptionParts = [`Step: ${step.title}`];
            if (material.notes) descriptionParts.push(material.notes);
            materialMap.set(id, {
                id,
                category: "General",
                label,
                description: descriptionParts.join(" "),
                qty: material.quantity ?? 1,
                unit: material.unit ?? "unit",
                unitCostEstimate: material.unitCostEstimate ?? 0,
                status: "planned",
            });
        }
    }

    return [...materialMap.values()];
}

function deriveLaborFromPlan(plan: SolutionItemPlanV1) {
    return plan.steps.map((step, index) => {
        const idToken = step.id?.trim() ? step.id.trim() : `step-${index + 1}`;
        const quantity =
            typeof step.estimatedMinutes === "number"
                ? Number((step.estimatedMinutes / 60).toFixed(2))
                : undefined;
        return {
            id: `plan-labor:${idToken}`,
            workType: "studio",
            role: step.title,
            rateType: "hour" as const,
            quantity: quantity && quantity > 0 ? quantity : undefined,
            unitCost: 0,
            description: step.details?.trim() || undefined,
        };
    });
}

function mergePlanDerived<T extends { id: string }>(existing: T[], derived: T[], prefix: string) {
    const retained = existing.filter((entry) => !entry.id.startsWith(prefix));
    return [...retained, ...derived];
}

function renderPlanMarkdown(plan: SolutionItemPlanV1): string {
    const lines: string[] = [];
    lines.push(`# ${plan.title}`);
    if (plan.summary?.trim()) {
        lines.push("", plan.summary.trim());
    }
    lines.push("", "## Steps");
    for (const step of plan.steps) {
        lines.push("", `### ${step.title}`);
        if (step.details.trim()) lines.push(step.details.trim());
        if (typeof step.estimatedMinutes === "number") {
            lines.push("", `- Est. minutes: ${step.estimatedMinutes}`);
        }
        const normalizedMaterials = normalizeStepMaterials(step.materials);
        if (normalizedMaterials.length) {
            lines.push("", `- ${formatMaterialList(normalizedMaterials)}`);
        }
        if (step.tools && step.tools.length) {
            lines.push("", `- Tools: ${step.tools.join(", ")}`);
        }
    }
    return lines.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function getString(source: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
}

function getUnknown(source: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
            return source[key];
        }
    }
    return undefined;
}

function normalizeMaterialEntry(entry: unknown): StepMaterial | null {
    if (typeof entry === "string") {
        const name = entry.trim();
        return name ? { name } : null;
    }
    if (!isRecord(entry)) return null;
    const name =
        getString(entry, ["name", "label", "material", "item", "title"]) ||
        getString(entry, ["Name", "Label", "Material", "Item", "Title"]);
    if (!name) return null;
    return {
        name,
        quantity: coerceNumber(
            getUnknown(entry, ["quantity", "qty", "amount", "count", "Quantity", "Qty", "Amount", "Count"])
        ),
        unit:
            getString(entry, ["unit", "uom", "units", "Unit", "Uom", "Units"]) || undefined,
        unitCostEstimate: coerceNumber(
            getUnknown(entry, [
                "unitCostEstimate",
                "unitCost",
                "unitPrice",
                "cost",
                "price",
                "estimatedUnitCost",
                "estimatedUnitPrice",
                "UnitCostEstimate",
                "UnitCost",
                "UnitPrice",
                "Cost",
                "Price",
            ])
        ),
        notes:
            getString(entry, ["notes", "note", "description", "Notes", "Note", "Description"]) ||
            undefined,
    };
}

function normalizeMaterialsList(raw: unknown): StepMaterial[] {
    if (!raw) return [];
    if (typeof raw === "string") {
        return raw
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean)
            .map((name) => ({ name }));
    }
    if (Array.isArray(raw)) {
        const results: StepMaterial[] = [];
        for (const entry of raw) {
            const normalized = normalizeMaterialEntry(entry);
            if (normalized) results.push(normalized);
        }
        return results;
    }
    if (isRecord(raw)) {
        const nested =
            getUnknown(raw, ["items", "materials", "Materials", "Items", "list", "List"]) ?? null;
        if (nested) return normalizeMaterialsList(nested);
    }
    return [];
}

function normalizeToolsList(raw: unknown): string[] {
    if (!raw) return [];
    if (typeof raw === "string") {
        return raw
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
    }
    if (Array.isArray(raw)) {
        return raw.filter((entry) => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean);
    }
    return [];
}

function normalizeStepFromLooseFormat(step: unknown, index: number) {
    const stepObj = isRecord(step) ? step : {};
    const title =
        getString(stepObj, ["title", "Title", "name", "Name", "step", "Step"]) ||
        `Step ${index + 1}`;
    const details =
        getString(stepObj, ["details", "Details", "description", "Description", "notes", "Notes"]) ||
        "";
    const id = getString(stepObj, ["id", "Id", "ID"]) || `S${index + 1}`;
    const estimatedMinutes = coerceNumber(
        getUnknown(stepObj, [
            "estimatedMinutes",
            "estimated_minutes",
            "durationMinutes",
            "duration",
            "estMinutes",
            "estimatedTimeMinutes",
            "EstimatedMinutes",
            "DurationMinutes",
        ])
    );
    let materials = normalizeMaterialsList(
        getUnknown(stepObj, [
            "materials",
            "Materials",
            "materialList",
            "materialsList",
            "MaterialsList",
            "materials_needed",
        ])
    );
    let tools = normalizeToolsList(
        getUnknown(stepObj, ["tools", "Tools", "toolList", "toolsList", "ToolsList"])
    );
    if ((!materials.length || !tools.length) && details) {
        const extracted = extractResourcesFromText(details);
        if (!materials.length) materials = extracted.materials;
        if (!tools.length) tools = extracted.tools;
    }
    return {
        id,
        title,
        details,
        estimatedMinutes,
        materials: materials.length ? materials : undefined,
        tools: tools.length ? tools : undefined,
    };
}

function coercePlanFromLooseFormat(value: unknown): SolutionItemPlanV1 | null {
    if (!isRecord(value)) return null;
    const parsed = SolutionItemPlanV1Schema.safeParse(value);
    if (parsed.success) return parsed.data;

    const title =
        getString(value, ["project_title", "ProjectTitle", "title", "Title"]) ||
        getString(value, ["name", "Name"]) ||
        "Solution Plan";

    const goals = isRecord(value.Goals) ? value.Goals : null;
    const summary =
        (goals ? getString(goals, ["Description", "description"]) : "") ||
        getString(value, ["Summary", "summary"]);

    const planNode =
        (isRecord(value.ConciseStepByStepPlan) ? value.ConciseStepByStepPlan : null) ||
        (isRecord(value.StepByStepPlan) ? value.StepByStepPlan : null) ||
        (isRecord(value.StepsPlan) ? value.StepsPlan : null);
    const stepsNode =
        (Array.isArray(value.steps) && value.steps) ||
        (Array.isArray(value.Steps) && value.Steps) ||
        (planNode && Array.isArray((planNode as Record<string, unknown>).Steps)
            ? (planNode as Record<string, unknown>).Steps
            : planNode && Array.isArray((planNode as Record<string, unknown>).steps)
            ? (planNode as Record<string, unknown>).steps
            : null);

    const steps = Array.isArray(stepsNode)
        ? stepsNode.map((step, index) => normalizeStepFromLooseFormat(step, index))
        : [];

    const normalized: SolutionItemPlanV1 = {
        version: "SolutionItemPlanV1",
        title,
        summary: summary || undefined,
        steps: steps.length
            ? steps
            : [
                  {
                      id: "S1",
                      title: "Step 1",
                      details: summary || "Draft plan requires clarification.",
                  },
              ],
    };

    const normalizedParsed = SolutionItemPlanV1Schema.safeParse(normalized);
    if (!normalizedParsed.success) return null;
    return normalizedParsed.data;
}

function parseStepsFromMarkdown(markdown: string): SolutionItemPlanV1["steps"] {
    const steps: SolutionItemPlanV1["steps"] = [];
    const lines = markdown.split("\n");
    let current: { title: string; details: string[] } | null = null;
    for (const line of lines) {
        const trimmed = line.trimStart();
        const headingMatch = trimmed.match(/^###\s+(.*)$/);
        if (headingMatch) {
            if (current) {
                steps.push({
                    id: `S${steps.length + 1}`,
                    title: current.title,
                    details: current.details.join("\n").trim(),
                });
            }
            current = {
                title: headingMatch[1].trim() || `Step ${steps.length + 1}`,
                details: [],
            };
            continue;
        }

        const numberedMatch = trimmed.match(/^(?:-?\s*)?\d+[\.\)]\s+(.*)$/);
        if (numberedMatch) {
            if (current) {
                steps.push({
                    id: `S${steps.length + 1}`,
                    title: current.title,
                    details: current.details.join("\n").trim(),
                });
            }
            current = {
                title: numberedMatch[1].trim() || `Step ${steps.length + 1}`,
                details: [],
            };
            continue;
        }

        const labeledMatch = trimmed.match(/^(?:-?\s*)?(?:s|step)\s*\d+\s*[:\.\-\)]\s*(.+)$/i);
        if (labeledMatch) {
            if (current) {
                steps.push({
                    id: `S${steps.length + 1}`,
                    title: current.title,
                    details: current.details.join("\n").trim(),
                });
            }
            current = {
                title: labeledMatch[1].trim() || `Step ${steps.length + 1}`,
                details: [],
            };
            continue;
        }

        if (current && trimmed.startsWith("-")) {
            current.details.push(trimmed.replace(/^-\s*/, ""));
        }
    }

    if (current) {
        steps.push({
            id: `S${steps.length + 1}`,
            title: current.title,
            details: current.details.join("\n").trim(),
        });
    }

    return steps;
}

function fillStepDetailsFromMarkdown(
    steps: SolutionItemPlanV1["steps"],
    markdown: string,
) {
    if (steps.length === 0) return steps;
    const sections = markdown.split(/^###\s+/m);
    if (sections.length <= 1) return steps;
    const mapped = steps.map((step, index) => {
        const body = sections[index + 1] ?? "";
        const detailLines = body.split("\n").slice(1).join("\n").trim();
        const { materials, tools } = extractResourcesFromText(detailLines);
        return {
            ...step,
            details: detailLines || step.details,
            materials: step.materials?.length ? step.materials : materials,
            tools: step.tools?.length ? step.tools : tools,
        };
    });
    return mapped;
}

function extractResourcesFromText(text: string) {
    const materials: StepMaterial[] = [];
    const tools: string[] = [];
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
        const normalized = line.replace(/^\-+\s*/, "").trim();
        const [label, rest] = normalized.split(/:\s*/, 2);
        if (!rest) continue;
        const lower = label.toLowerCase();
        if (lower === "materials" || lower === "material") {
            materials.push(
                ...rest.split(",")
                    .map((item) => item.trim())
                    .filter(Boolean)
                    .map((name) => ({ name })),
            );
        }
        if (lower === "tools" || lower === "tool") {
            tools.push(...rest.split(",").map((item) => item.trim()).filter(Boolean));
        }
    }
    return { materials, tools };
}

function normalizeExtractedPlan(extracted: {
    plan?: unknown;
    markdown?: string;
    SolutionItemPlanV1?: unknown;
    MarkdownPlan?: string;
}) {
    const plan =
        coercePlanFromLooseFormat(extracted.plan) ||
        coercePlanFromLooseFormat(extracted.SolutionItemPlanV1);
    if (!plan) {
        throw new Error("Extracted plan did not contain a usable structure.");
    }

    const markdown =
        extracted.markdown?.trim() ||
        extracted.MarkdownPlan?.trim() ||
        renderPlanMarkdown(plan);

    const fallbackSteps = parseStepsFromMarkdown(markdown);
    if (plan.steps.length <= 1 && fallbackSteps.length > 1) {
        plan.steps = fillStepDetailsFromMarkdown(fallbackSteps, markdown);
    }
    plan.steps = fillStepDetailsFromMarkdown(plan.steps, markdown);

    return { plan, markdown };
}

function findSolutioningDraft(revisions: Doc<"itemRevisions">[]) {
    return revisions
        .filter((rev) => rev.tabScope === "solutioning" && rev.state === "proposed")
        .sort((a, b) => b.revisionNumber - a.revisionNumber)[0] ?? null;
}

function findApprovedRevision(
    revisions: Doc<"itemRevisions">[],
    approvedRevisionId?: Id<"itemRevisions">
) {
    if (!approvedRevisionId) return null;
    return revisions.find((rev) => rev._id === approvedRevisionId) ?? null;
}

function resolveActiveSpec(item: Doc<"projectItems">, revisions: Doc<"itemRevisions">[]) {
    const draft = findSolutioningDraft(revisions);
    const approved = findApprovedRevision(revisions, item.approvedRevisionId);
    const active = draft ?? approved;
    const spec = active ? parseItemSpec(active.data) : null;
    return {
        draft,
        approved,
        active,
        spec: spec ?? buildBaseItemSpec(item),
    };
}

export const getContext = internalQuery({
    args: { projectId: v.id("projects"), itemId: v.id("projectItems") },
    handler: async (ctx, args) => {
        const project = await ctx.db.get(args.projectId);
        if (!project) throw new Error("Project not found");

        const item = await ctx.db.get(args.itemId);
        if (!item) throw new Error("Item not found");

        const revisions = await ctx.db
            .query("itemRevisions")
            .withIndex("by_item_revision", (q) => q.eq("itemId", item._id))
            .collect();

        const { spec } = resolveActiveSpec(item, revisions);

        const skill = await ctx.db
            .query("skills")
            .withIndex("by_name", (q) => q.eq("name", "solutioning"))
            .first();

        return {
            project,
            item,
            spec,
            systemPrompt: skill?.content || FALLBACK_SYSTEM_PROMPT,
        };
    },
});

export const saveDraftPlan = internalMutation({
    args: {
        itemId: v.id("projectItems"),
        solutionPlan: v.string(),
        solutionPlanJson: v.optional(v.string()),
        createdBy: v.optional(v.union(v.literal("user"), v.literal("agent"))),
    },
    handler: async (ctx, args) => {
        const item = await ctx.db.get(args.itemId);
        if (!item) throw new Error("Item not found");

        const revisions = await ctx.db
            .query("itemRevisions")
            .withIndex("by_item_revision", (q) => q.eq("itemId", item._id))
            .collect();

        const draft = findSolutioningDraft(revisions);
        const approved = findApprovedRevision(revisions, item.approvedRevisionId);
        const baseSpec = draft
            ? parseItemSpec(draft.data) ?? buildBaseItemSpec(item)
            : approved
            ? parseItemSpec(approved.data) ?? buildBaseItemSpec(item)
            : buildBaseItemSpec(item);

        const planMarkdown = args.solutionPlan.trim();
        const plan = parsePlanJson(args.solutionPlanJson ?? undefined);
        let spec = withSolutionPlan(baseSpec, planMarkdown, args.solutionPlanJson ?? undefined);
        if (plan && plan.steps.length > 0) {
            const derivedMaterials = deriveMaterialsFromPlan(plan);
            const derivedLabor = deriveLaborFromPlan(plan);
            spec = ItemSpecV2Schema.parse({
                ...spec,
                breakdown: {
                    ...spec.breakdown,
                    subtasks: buildSubtasksFromPlan(plan),
                    materials: mergePlanDerived(spec.breakdown.materials ?? [], derivedMaterials, "plan-mat:"),
                    labor: mergePlanDerived(spec.breakdown.labor ?? [], derivedLabor, "plan-labor:"),
                },
            });
        }

        const now = Date.now();
        if (draft) {
            await ctx.db.patch(draft._id, {
                data: spec,
                summaryMarkdown: "Solutioning draft updated.",
            });
            await ctx.db.patch(item._id, { updatedAt: now });
            const revision = await ctx.db.get(draft._id);
            if (revision) {
                await syncItemProjections(ctx, { item, revision, spec, force: true });
            }
            return { revisionId: draft._id };
        }

        const revisionNumber = item.latestRevisionNumber + 1;
        const revisionId = await ctx.db.insert("itemRevisions", {
            projectId: item.projectId,
            itemId: item._id,
            tabScope: "solutioning",
            state: "proposed",
            revisionNumber,
            baseApprovedRevisionId: item.approvedRevisionId,
            data: spec,
            summaryMarkdown: "Solutioning draft created.",
            createdBy: { kind: args.createdBy ?? "user" },
            createdAt: now,
        });

        await ctx.db.patch(item._id, {
            latestRevisionNumber: revisionNumber,
            updatedAt: now,
        });

        const revision = await ctx.db.get(revisionId);
        if (revision) {
            await syncItemProjections(ctx, { item, revision, spec, force: true });
        }

        return { revisionId };
    },
});

export const send = action({
    args: {
        threadId: v.id("chatThreads"),
        itemId: v.id("projectItems"),
        userContent: v.string(),
        thinkingMode: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        await ctx.runMutation(internal.rateLimit.consume, {
            key: `solutioning:${args.threadId}`,
            limit: 30,
            windowMs: 60_000,
        });

        const { project, scenario, messages } = await ctx.runQuery(internal.chat.getThreadContext, {
            threadId: args.threadId,
        });

        const { spec, systemPrompt } = await ctx.runQuery(internal.agents.solutioningV2.getContext, {
            projectId: project._id,
            itemId: args.itemId,
        });

        const settings = await ctx.runQuery(internal.settings.getAll);
        const model = settings.modelConfig?.solutioning || "gpt-5.2";

        const userMessageId = await ctx.runMutation(internal.chat.createMessage, {
            projectId: project._id,
            scenarioId: scenario._id,
            threadId: args.threadId,
            role: "user",
            content: args.userContent,
            status: "final",
        });

        const assistantMessageId = await ctx.runMutation(internal.chat.createMessage, {
            projectId: project._id,
            scenarioId: scenario._id,
            threadId: args.threadId,
            role: "assistant",
            content: "",
            status: "streaming",
        });

        const identity = spec.identity;
        const tags = identity.tags?.join(", ") || "none";
        const plan = spec.studioWork?.buildPlanMarkdown ?? "(none)";

        const contextLines = [
            `Project: ${project.name}`,
            `Client: ${project.clientName}`,
            `Stage: ${project.stage ?? "planning"}`,
            `Budget tier: ${project.budgetTier ?? "unknown"}`,
            `Project types: ${(project.projectTypes ?? []).join(", ") || "none"}`,
            `Default language: ${project.defaultLanguage ?? "he"}`,
            "",
            "Project item:",
            `- Title: ${identity.title}`,
            `- Type: ${identity.typeKey}`,
            `- Description: ${identity.description ?? "none"}`,
            `- Tags: ${tags}`,
            `- Accounting group: ${identity.accountingGroup ?? "none"}`,
            "",
            "Existing plan (if any):",
            plan,
        ];

        const transcript = [
            ...messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`),
            `USER: ${args.userContent}`,
        ].join("\n");

        const userPrompt = [
            ...contextLines,
            "",
            "Conversation history:",
            transcript,
            "",
            "Instructions:",
            "- Ask any critical clarifying questions before committing to a final build plan.",
            "- Always include a draft step-by-step build/procurement plan, even if you must state assumptions.",
            "- If assumptions are needed, list them explicitly before the steps.",
            "- Keep the response actionable and specific (dimensions, materials, suppliers, tools, sequencing).",
            "- For each step, list materials with name, quantity, unit, and estimated unit cost when possible.",
        ].join("\n");

        let buffer = "";
        let lastFlushedAt = 0;
        try {
            await streamChatText({
                model,
                systemPrompt,
                userPrompt,
                thinkingMode: args.thinkingMode,
                language: project.defaultLanguage === "en" ? "en" : "he",
                onDelta: async (delta) => {
                    buffer += delta;
                    const now = Date.now();
                    if (now - lastFlushedAt < 200) return;
                    lastFlushedAt = now;
                    await ctx.runMutation(internal.chat.patchMessage, {
                        messageId: assistantMessageId,
                        content: buffer,
                        status: "streaming",
                    });
                },
            });

            await ctx.runMutation(internal.chat.patchMessage, {
                messageId: assistantMessageId,
                content: buffer.trim() ? buffer : "(empty)",
                status: "final",
            });

            const finalContent = buffer.trim() ? buffer : "(empty)";
            if (finalContent.length > 40) {
                try {
                    let extracted;
                    try {
                        extracted = await callChatWithSchema(SolutioningExtractedPlanSchema, {
                            model,
                            systemPrompt: [
                                systemPrompt,
                                "",
                                "Extract a structured plan (SolutionItemPlanV1) and a clean Markdown plan from the assistant message.",
                                "Return JSON with keys: plan and markdown.",
                                "The plan.steps array must contain multiple atomic steps (each is a single task).",
                                "If the message is long, split it into 4-10 steps.",
                                "Each step.materials entry should be an object with name, quantity, unit, and unitCostEstimate when available.",
                                "Use the same language as the message content.",
                                "Return valid JSON only.",
                            ].join("\n"),
                            userPrompt: finalContent,
                            maxRetries: 2,
                            language: project.defaultLanguage === "en" ? "en" : "he",
                        });
                    } catch {
                        extracted = await callChatWithSchema(SolutioningExtractedPlanLooseSchema, {
                            model,
                            systemPrompt: [
                                systemPrompt,
                                "",
                                "Extract a structured plan (SolutionItemPlanV1) and a clean Markdown plan from the assistant message.",
                                "Return JSON with keys: plan and markdown.",
                                "The plan.steps array must contain multiple atomic steps (each is a single task).",
                                "If the message is long, split it into 4-10 steps.",
                                "Each step.materials entry should be an object with name, quantity, unit, and unitCostEstimate when available.",
                                "Use the same language as the message content.",
                                "Return valid JSON only.",
                            ].join("\n"),
                            userPrompt: finalContent,
                            maxRetries: 2,
                            language: project.defaultLanguage === "en" ? "en" : "he",
                        });
                    }

                    const normalized = normalizeExtractedPlan(extracted);
                    await ctx.runMutation(internal.agents.solutioningV2.saveDraftPlan, {
                        itemId: args.itemId,
                        solutionPlan: normalized.markdown,
                        solutionPlanJson: JSON.stringify(normalized.plan),
                        createdBy: "agent",
                    });
                    await ctx.runMutation(internal.chat.createMessage, {
                        projectId: project._id,
                        scenarioId: scenario._id,
                        threadId: args.threadId,
                        role: "system",
                        content: "Draft plan extracted and saved to the item.",
                        status: "final",
                    });
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    await ctx.runMutation(internal.chat.createMessage, {
                        projectId: project._id,
                        scenarioId: scenario._id,
                        threadId: args.threadId,
                        role: "system",
                        content: `Auto-extract failed: ${message}`,
                        status: "error",
                    });
                }
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await ctx.runMutation(internal.chat.patchMessage, {
                messageId: assistantMessageId,
                status: "error",
                content: `Error: ${message}`,
            });
            await ctx.runMutation(internal.chat.createMessage, {
                projectId: project._id,
                scenarioId: scenario._id,
                threadId: args.threadId,
                role: "system",
                content: `Error: ${message}`,
                status: "error",
            });
        }

        return { ok: true, userMessageId, assistantMessageId };
    },
});

export const extractPlanFromThread = action({
    args: {
        threadId: v.id("chatThreads"),
        itemId: v.id("projectItems"),
    },
    handler: async (ctx, args) => {
        await ctx.runMutation(internal.rateLimit.consume, {
            key: `solutioning_extract:${args.threadId}`,
            limit: 10,
            windowMs: 60_000,
        });

        const { project, scenario, messages } = await ctx.runQuery(internal.chat.getThreadContext, {
            threadId: args.threadId,
        });
        const { systemPrompt } = await ctx.runQuery(internal.agents.solutioningV2.getContext, {
            projectId: project._id,
            itemId: args.itemId,
        });

        const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" && m.content.trim());
        if (!lastAssistant) {
            await ctx.runMutation(internal.chat.createMessage, {
                projectId: project._id,
                scenarioId: scenario._id,
                threadId: args.threadId,
                role: "system",
                content: "Extract failed: no assistant message found in this thread.",
                status: "error",
            });
            throw new Error("No assistant message found to extract from");
        }

        const settings = await ctx.runQuery(internal.settings.getAll);
        const model = settings.modelConfig?.solutioning || "gpt-5.2";

        try {
            let extracted;
            try {
                extracted = await callChatWithSchema(SolutioningExtractedPlanSchema, {
                    model,
                    systemPrompt: [
                        systemPrompt,
                        "",
                        "Extract a structured plan (SolutionItemPlanV1) and a clean Markdown plan from the assistant message.",
                        "Return JSON with keys: plan and markdown.",
                        "The plan.steps array must contain multiple atomic steps (each is a single task).",
                        "If the message is long, split it into 4-10 steps.",
                        "Each step.materials entry should be an object with name, quantity, unit, and unitCostEstimate when available.",
                        "Use the same language as the message content.",
                        "Return valid JSON only.",
                    ].join("\n"),
                    userPrompt: lastAssistant.content,
                    maxRetries: 2,
                    language: project.defaultLanguage === "en" ? "en" : "he",
                });
            } catch {
                extracted = await callChatWithSchema(SolutioningExtractedPlanLooseSchema, {
                    model,
                    systemPrompt: [
                        systemPrompt,
                        "",
                        "Extract a structured plan (SolutionItemPlanV1) and a clean Markdown plan from the assistant message.",
                        "Return JSON with keys: plan and markdown.",
                        "The plan.steps array must contain multiple atomic steps (each is a single task).",
                        "If the message is long, split it into 4-10 steps.",
                        "Each step.materials entry should be an object with name, quantity, unit, and unitCostEstimate when available.",
                        "Use the same language as the message content.",
                        "Return valid JSON only.",
                    ].join("\n"),
                    userPrompt: lastAssistant.content,
                    maxRetries: 2,
                    language: project.defaultLanguage === "en" ? "en" : "he",
                });
            }

            const normalized = normalizeExtractedPlan(extracted);
            await ctx.runMutation(internal.agents.solutioningV2.saveDraftPlan, {
                itemId: args.itemId,
                solutionPlan: normalized.markdown,
                solutionPlanJson: JSON.stringify(normalized.plan),
                createdBy: "agent",
            });

            await ctx.runMutation(internal.chat.createMessage, {
                projectId: project._id,
                scenarioId: scenario._id,
                threadId: args.threadId,
                role: "system",
                content: "Plan extracted and saved to the item.",
                status: "final",
            });

            return { ok: true, plan: normalized.plan, markdown: normalized.markdown };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await ctx.runMutation(internal.chat.createMessage, {
                projectId: project._id,
                scenarioId: scenario._id,
                threadId: args.threadId,
                role: "system",
                content: `Extract failed: ${message}`,
                status: "error",
            });
            throw error;
        }
    },
});
