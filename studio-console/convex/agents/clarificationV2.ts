import { v } from "convex/values";
import { action, internalMutation } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { callChatWithSchema, streamChatText } from "../lib/openai";
import { ClarificationSchema, ItemSpecV2Schema, ItemUpdateOutputSchema, type ItemSpecV2 } from "../lib/zodSchemas";
import type { Doc, Id } from "../_generated/dataModel";

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

function findClarificationDraft(revisions: Doc<"itemRevisions">[]) {
    return revisions
        .filter((rev) => rev.tabScope === "clarification" && rev.state === "proposed")
        .sort((a, b) => b.revisionNumber - a.revisionNumber)[0] ?? null;
}

function findApprovedRevision(revisions: Doc<"itemRevisions">[], approvedRevisionId?: Id<"itemRevisions">) {
    if (!approvedRevisionId) return null;
    return revisions.find((rev) => rev._id === approvedRevisionId) ?? null;
}

function resolveActiveSpec(item: Doc<"projectItems">, revisions: Doc<"itemRevisions">[]) {
    const draft = findClarificationDraft(revisions);
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

export const saveOutcome = internalMutation({
    args: {
        projectId: v.id("projects"),
        threadId: v.id("chatThreads"),
        summary: v.string(),
        openQuestions: v.array(v.string()),
        suggestedNextPhase: v.union(v.literal("stay_in_clarification"), v.literal("move_to_planning")),
        rawAssistantMarkdown: v.string(),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.projectId, { overviewSummary: args.summary });

        const existing = await ctx.db
            .query("plans")
            .withIndex("by_project_phase", (q) => q.eq("projectId", args.projectId).eq("phase", "clarification"))
            .collect();

        const version = existing.length + 1;
        const summaryMarkdown = [
            "## Clarification summary",
            args.summary,
            "",
            "## Open questions",
            args.openQuestions.length ? args.openQuestions.map((q) => `- ${q}`).join("\n") : "- No open questions.",
            "",
            `Suggested next phase: ${args.suggestedNextPhase}`,
            "",
            "## Assistant response (raw)",
            args.rawAssistantMarkdown,
        ].join("\n");

        await ctx.db.insert("plans", {
            projectId: args.projectId,
            version,
            phase: "clarification",
            isDraft: true,
            isActive: false,
            contentMarkdown: summaryMarkdown,
            reasoning: args.suggestedNextPhase,
            createdAt: Date.now(),
            createdBy: "agent",
        });
    },
});

export const send = action({
    args: {
        threadId: v.id("chatThreads"),
        userContent: v.string(),
        itemId: v.optional(v.id("projectItems")),
        thinkingMode: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const { project, scenario, messages } = await ctx.runQuery(internal.chat.getThreadContext, {
            threadId: args.threadId,
        });

        const { systemPrompt, activePlan, knowledgeDocs } = await ctx.runQuery(internal.agents.clarification.getContext, {
            projectId: project._id,
        });

        if (args.itemId) {
            const itemData = await ctx.runQuery(api.items.getItem, { itemId: args.itemId });
            if (!itemData) throw new Error("Item not found");
            const { item, revisions } = itemData;

            const { spec } = resolveActiveSpec(item, revisions);

            const settings = await ctx.runQuery(internal.settings.getAll);
            const model = settings.modelConfig?.clarification || "gpt-5.2";

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

            const tags = spec.identity.tags?.join(", ") || "none";
            const questions = spec.state.openQuestions.length
                ? spec.state.openQuestions.map((q) => `- ${q}`).join("\n")
                : "None recorded yet.";

            const context = [
                `Project: ${project.name}`,
                `Client: ${project.clientName}`,
                `Default language: ${project.defaultLanguage ?? "he"}`,
                "",
                "Item context:",
                `- Title: ${spec.identity.title}`,
                `- Type: ${spec.identity.typeKey}`,
                `- Description: ${spec.identity.description ?? "none"}`,
                `- Tags: ${tags}`,
                `- Accounting group: ${spec.identity.accountingGroup ?? "none"}`,
                "",
                "Open questions so far:",
                questions,
            ].join("\n");

            const transcript = [
                ...messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`),
                `USER: ${args.userContent}`,
            ].join("\n");

            const userPrompt = [
                context,
                "",
                "Conversation history:",
                transcript,
                "",
                "Instructions:",
                "1) Ask targeted clarification questions about this specific item.",
                "2) Summarize any new details learned.",
                "3) Keep the response in Hebrew.",
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

                const finalContent = buffer.trim() ? buffer : "(empty)";
                await ctx.runMutation(internal.chat.patchMessage, {
                    messageId: assistantMessageId,
                    content: finalContent,
                    status: "final",
                });

                const itemUpdate = await callChatWithSchema(ItemUpdateOutputSchema, {
                    model,
                    systemPrompt: [
                        "Update the item spec based on the conversation.",
                        "Return JSON only that matches the ItemUpdateOutput schema.",
                        "Keep all existing fields unless new info is provided.",
                        `itemId must be exactly "${String(item._id)}".`,
                    ].join("\n"),
                    userPrompt: JSON.stringify(
                        {
                            itemId: String(item._id),
                            baseSpec: spec,
                            userMessage: args.userContent,
                            assistantMessage: finalContent,
                        },
                        null,
                        2,
                    ),
                    maxRetries: 2,
                    language: project.defaultLanguage === "en" ? "en" : "he",
                });

                await ctx.runMutation(api.items.upsertRevision, {
                    itemId: args.itemId,
                    tabScope: "clarification",
                    dataOrPatch: itemUpdate.proposedData,
                    changeReason: itemUpdate.changeReason ?? itemUpdate.summaryMarkdown,
                    createdByKind: "agent",
                });

                await ctx.runMutation(internal.chat.createMessage, {
                    projectId: project._id,
                    scenarioId: scenario._id,
                    threadId: args.threadId,
                    role: "system",
                    content: `Proposed item update saved. ${itemUpdate.summaryMarkdown}`,
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
        }

        // Fetch model configuration
        const settings = await ctx.runQuery(internal.settings.getAll);
        const model = settings.modelConfig?.clarification || "gpt-5.2";

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

        const planSnippet = activePlan ? activePlan.contentMarkdown.slice(0, 900) : "No active plan.";
        const uploads = knowledgeDocs?.length
            ? knowledgeDocs.map((doc) => `- ${doc.title}: ${(doc.summary ?? "").slice(0, 240)}`).join("\n")
            : "No uploaded documents available.";

        const transcript = [
            ...messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`),
            `USER: ${args.userContent}`,
        ].join("\n");

        const userPrompt = [
            `Project: ${project.name}`,
            `Client: ${project.clientName}`,
            `Default language: ${project.defaultLanguage ?? "he"}`,
            "",
            "Active plan snapshot:",
            planSnippet,
            "",
            "Recently uploaded docs:",
            uploads,
            "",
            "Instructions:",
            "1) Ask smart, non-repetitive clarification questions.",
            "2) Summarize what we know so far.",
            "3) End your message with a line that starts with 'ANALYSIS_JSON:' followed by STRICT JSON for this schema:",
            JSON.stringify({
                briefSummary: "string",
                openQuestions: ["string"],
                suggestedNextPhase: "stay_in_clarification | move_to_planning",
            }),
            "",
            "Conversation history:",
            transcript,
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

            const finalContent = buffer.trim() ? buffer : "(empty)";
            await ctx.runMutation(internal.chat.patchMessage, {
                messageId: assistantMessageId,
                content: finalContent,
                status: "final",
            });

            const analysisLine = finalContent
                .split("\n")
                .map((line) => line.trim())
                .find((line) => line.startsWith("ANALYSIS_JSON:"));

            const extracted = analysisLine
                ? await callChatWithSchema(ClarificationSchema, {
                    model,
                    systemPrompt: "Parse the provided ANALYSIS_JSON line into valid JSON only.",
                    userPrompt: analysisLine.slice("ANALYSIS_JSON:".length),
                    maxRetries: 2,
                    language: "en",
                })
                : await callChatWithSchema(ClarificationSchema, {
                    model,
                    systemPrompt:
                        "Extract a briefSummary, openQuestions, and suggestedNextPhase from the assistant message.",
                    userPrompt: finalContent,
                    maxRetries: 2,
                    language: project.defaultLanguage === "en" ? "en" : "he",
                });

            await ctx.runMutation(internal.agents.clarificationV2.saveOutcome, {
                projectId: project._id,
                threadId: args.threadId,
                summary: extracted.briefSummary,
                openQuestions: extracted.openQuestions,
                suggestedNextPhase: extracted.suggestedNextPhase,
                rawAssistantMarkdown: finalContent,
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
