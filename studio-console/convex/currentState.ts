import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { buildDerivedCurrentState } from "./lib/currentState";
import { api, internal } from "./_generated/api";
import { summarizeItems } from "./lib/contextSummary";
import { buildBrainContext } from "./lib/brainContext";

const PROPOSED_CONTEXT_THRESHOLD = 0.85;

function buildDerivedFromFacts(args: {
    projectName?: string | null;
    items: Array<{
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
    }>;
    projectFacts: Array<{ factTextHe: string }>;
    itemFactsById: Map<string, Array<{ factTextHe: string }>>;
}) {
    const lines: string[] = [];
    lines.push("# Current State (Derived)");
    if (args.projectName) lines.push(`_Project: ${args.projectName}_`);
    lines.push("");
    lines.push("## Project Facts (V2)");
    if (args.projectFacts.length === 0) {
        lines.push("(none)");
    } else {
        for (const fact of args.projectFacts) {
            lines.push(`- ${fact.factTextHe}`);
        }
    }
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
        const scope = item.scope ?? {};
        const scopeParts: string[] = [];
        if (scope.quantity || scope.unit) {
            const qty = scope.quantity ?? "?";
            const unit = scope.unit ?? "";
            scopeParts.push(`qty=${qty} ${unit}`.trim());
        }
        if (scope.dimensions) scopeParts.push(`dims=${scope.dimensions}`);
        if (scope.location) scopeParts.push(`loc=${scope.location}`);
        if (scope.constraints && scope.constraints.length) {
            scopeParts.push(`constraints=${scope.constraints.slice(0, 3).join("; ")}`);
        }
        if (scope.assumptions && scope.assumptions.length) {
            scopeParts.push(`assumptions=${scope.assumptions.slice(0, 3).join("; ")}`);
        }
        if (scopeParts.length) {
            lines.push(`- Scope: ${scopeParts.join(" | ")}`);
        }
        const itemFacts = args.itemFactsById.get(item.id) ?? [];
        if (itemFacts.length > 0) {
            lines.push("");
            lines.push("#### Item Facts (V2)");
            for (const fact of itemFacts) {
                lines.push(`- ${fact.factTextHe}`);
            }
        }
        lines.push("");
    }

    return lines.join("\n").trim();
}

const scopeTypeValidator = v.optional(
    v.union(v.literal("allProject"), v.literal("singleItem"), v.literal("multiItem"))
);

export const getDerived = query({
    args: {
        projectId: v.id("projects"),
        scopeType: scopeTypeValidator,
        scopeItemIds: v.optional(v.array(v.id("projectItems"))),
    },
    handler: async (ctx, args) => {
        const project = await ctx.db.get(args.projectId);
        const scoped = args.scopeType && args.scopeType !== "allProject";
        const scopeItemIds = scoped ? (args.scopeItemIds ?? []) : [];

        const items = scopeItemIds.length > 0
            ? await Promise.all(scopeItemIds.map((id) => ctx.db.get(id)))
            : await ctx.db
                .query("projectItems")
                .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId))
                .collect();

        const filteredItems = items.filter(Boolean).map((item) => ({
            id: item!._id,
            title: item!.title,
            name: item!.name,
            typeKey: item!.typeKey,
            status: item!.status,
            scope: item!.scope,
        }));

        if (project?.features?.factsEnabled === false) {
            const brain = await ctx.db
                .query("projectBrains")
                .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
                .unique();
            const markdown = [
                "# Project Brain",
                brain ? buildBrainContext(brain) : "(none)",
                "",
                "## Items",
                summarizeItems(filteredItems),
            ].join("\n");
            return { markdown };
        }

        const knowledgeBlocks = await ctx.db
            .query("knowledgeBlocks")
            .withIndex("by_scope_block", (q) => q.eq("projectId", args.projectId))
            .collect();

        const scopeItemIdSet = scopeItemIds.length
            ? new Set(scopeItemIds.map(String))
            : null;

        const filteredBlocks = knowledgeBlocks.filter((block) => {
            if (block.scopeType === "project") return true;
            if (!scopeItemIdSet) return true;
            return block.itemId && scopeItemIdSet.has(String(block.itemId));
        });

        const hasRenderedBlocks = filteredBlocks.some((block) => Boolean(block.renderedMarkdown));
        if (hasRenderedBlocks) {
            const markdown = buildDerivedCurrentState({
                projectName: project?.name ?? null,
                items: filteredItems,
                knowledgeBlocks: filteredBlocks.map((block) => ({
                    scopeType: block.scopeType,
                    itemId: block.itemId,
                    blockKey: block.blockKey,
                    renderedMarkdown: block.renderedMarkdown,
                    json: block.json,
                })),
            });
            return { markdown };
        }

        const acceptedProjectFacts = await ctx.db
            .query("factAtoms")
            .withIndex("by_project_scope_status", (q) =>
                q.eq("projectId", args.projectId)
                    .eq("scopeType", "project")
                    .eq("itemId", null)
                    .eq("status", "accepted")
            )
            .collect();

        const proposedProjectFacts = await ctx.db
            .query("factAtoms")
            .withIndex("by_project_scope_status", (q) =>
                q.eq("projectId", args.projectId)
                    .eq("scopeType", "project")
                    .eq("itemId", null)
                    .eq("status", "proposed")
            )
            .filter((q) => q.gte(q.field("confidence"), PROPOSED_CONTEXT_THRESHOLD))
            .collect();

        const itemFacts = await ctx.db
            .query("factAtoms")
            .withIndex("by_project_scope_status", (q) =>
                q.eq("projectId", args.projectId).eq("scopeType", "item")
            )
            .filter((q) =>
                q.or(
                    q.eq(q.field("status"), "accepted"),
                    q.and(q.eq(q.field("status"), "proposed"), q.gte(q.field("confidence"), PROPOSED_CONTEXT_THRESHOLD))
                )
            )
            .collect();

        const itemFactsById = new Map<string, Array<{ factTextHe: string }>>();
        for (const fact of itemFacts) {
            if (!fact.itemId) continue;
            if (scopeItemIdSet && !scopeItemIdSet.has(String(fact.itemId))) continue;
            const list = itemFactsById.get(String(fact.itemId)) ?? [];
            list.push({ factTextHe: fact.factTextHe });
            itemFactsById.set(String(fact.itemId), list);
        }

        const markdown = buildDerivedFromFacts({
            projectName: project?.name ?? null,
            items: filteredItems,
            projectFacts: [...acceptedProjectFacts, ...proposedProjectFacts].map((fact) => ({
                factTextHe: fact.factTextHe,
            })),
            itemFactsById,
        });

        return { markdown };
    },
});

function resolveBundleStage(projectStage?: string | null): "ideation" | "planning" | "solutioning" {
    switch (projectStage) {
        case "ideation":
            return "ideation";
        case "planning":
            return "planning";
        case "production":
        case "done":
            return "solutioning";
        default:
            return "ideation";
    }
}

export const submitCurrentStateText = mutation({
    args: {
        projectId: v.id("projects"),
        scopeType: scopeTypeValidator,
        scopeItemIds: v.optional(v.array(v.id("projectItems"))),
        text: v.string(),
    },
    handler: async (ctx, args) => {
        const project = await ctx.db.get(args.projectId);
        if (!project) throw new Error("Project not found");
        if (project.features?.factsEnabled === false) {
            const trimmed = args.text.trim();
            if (trimmed) {
                const brainEventId = await ctx.runMutation(internal.brainEvents.create, {
                    projectId: args.projectId,
                    eventType: "manual_add",
                    payload: { source: "current_state_submit", text: trimmed },
                });
                await ctx.scheduler.runAfter(0, api.agents.brainUpdater.run, {
                    projectId: args.projectId,
                    brainEventId,
                });
            }
            return { ok: true, skippedFacts: true };
        }

        const itemRefs = await ctx.runQuery(internal.items.getItemRefs, {
            projectId: args.projectId,
        });

        const scopeType = args.scopeType ?? "allProject";
        const scope =
            scopeType === "allProject"
                ? { type: "project" as const }
                : scopeType === "singleItem"
                    ? { type: "item" as const, itemIds: args.scopeItemIds }
                    : { type: "multiItem" as const, itemIds: args.scopeItemIds };

        await ctx.runMutation(internal.turnBundles.createFromTurn, {
            projectId: args.projectId,
            stage: resolveBundleStage(project.stage),
            scope,
            source: {
                type: "generation",
                sourceIds: [`current_state:${Date.now()}`],
            },
            itemRefs,
            freeChat: args.text,
        });

        const brainEventId = await ctx.runMutation(internal.brainEvents.create, {
            projectId: args.projectId,
            eventType: "manual_add",
            payload: {
                source: "current_state_submit",
                text: args.text,
                scope,
            },
        });

        await ctx.scheduler.runAfter(0, api.agents.brainUpdater.run, {
            projectId: args.projectId,
            brainEventId,
        });

        return { ok: true };
    },
});
