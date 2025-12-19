import { v } from "convex/values";
import { action, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { callChatWithSchema, streamChatText } from "../lib/openai";
import { ClarificationSchema } from "../lib/zodSchemas";

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
        thinkingMode: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const { project, scenario, messages } = await ctx.runQuery(internal.chat.getThreadContext, {
            threadId: args.threadId,
        });

        const { systemPrompt, activePlan, knowledgeDocs } = await ctx.runQuery(internal.agents.clarification.getContext, {
            projectId: project._id,
        });

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

