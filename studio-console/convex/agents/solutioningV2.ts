import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { callChatWithSchema, streamChatText } from "../lib/openai";
import { ItemSpecV2Schema, SolutioningExtractedPlanSchema, type ItemSpecV2 } from "../lib/zodSchemas";
import type { Doc, Id } from "../_generated/dataModel";

const FALLBACK_SYSTEM_PROMPT = [
    "You are a production solutioning expert for a creative studio.",
    "Help the user define exactly how to produce or procure a specific project item.",
    "Be practical, cost-aware, and ask clarifying questions when needed.",
    "Default to the project's default language unless the user explicitly requests otherwise.",
].join("\n");

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
        const spec = withSolutionPlan(baseSpec, planMarkdown, args.solutionPlanJson ?? undefined);

        const now = Date.now();
        if (draft) {
            await ctx.db.patch(draft._id, {
                data: spec,
                summaryMarkdown: "Solutioning draft updated.",
            });
            await ctx.db.patch(item._id, { updatedAt: now });
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
            "- When you can, propose a concise step-by-step build/procurement method.",
            "- Keep the response actionable and specific (dimensions, materials, suppliers, tools, sequencing).",
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

        const { project, messages } = await ctx.runQuery(internal.chat.getThreadContext, {
            threadId: args.threadId,
        });
        const { systemPrompt } = await ctx.runQuery(internal.agents.solutioningV2.getContext, {
            projectId: project._id,
            itemId: args.itemId,
        });

        const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" && m.content.trim());
        if (!lastAssistant) throw new Error("No assistant message found to extract from");

        const settings = await ctx.runQuery(internal.settings.getAll);
        const model = settings.modelConfig?.solutioning || "gpt-5.2";

        const extracted = await callChatWithSchema(SolutioningExtractedPlanSchema, {
            model,
            systemPrompt: [
                systemPrompt,
                "",
                "Extract a structured plan (SolutionItemPlanV1) and a clean Markdown plan from the assistant message.",
                "Use the same language as the message content.",
                "Return valid JSON only.",
            ].join("\n"),
            userPrompt: lastAssistant.content,
            maxRetries: 2,
            language: project.defaultLanguage === "en" ? "en" : "he",
        });

        await ctx.runMutation(internal.agents.solutioningV2.saveDraftPlan, {
            itemId: args.itemId,
            solutionPlan: extracted.markdown,
            solutionPlanJson: JSON.stringify(extracted.plan),
            createdBy: "agent",
        });

        return { ok: true, plan: extracted.plan, markdown: extracted.markdown };
    },
});
