import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { callChatWithSchema, streamChatText } from "../lib/openai";
import { SolutioningExtractedPlanSchema } from "../lib/zodSchemas";

const FALLBACK_SYSTEM_PROMPT = [
    "You are a production solutioning expert for a creative studio.",
    "Help the user define exactly how to produce or procure a specific material line item.",
    "Be practical, cost-aware, and ask clarifying questions when needed.",
    "Default to the project's default language unless the user explicitly requests otherwise.",
].join("\n");

export const getContext = internalQuery({
    args: { projectId: v.id("projects"), materialLineId: v.id("materialLines") },
    handler: async (ctx, args) => {
        const project = await ctx.db.get(args.projectId);
        if (!project) throw new Error("Project not found");

        const materialLine = await ctx.db.get(args.materialLineId);
        if (!materialLine) throw new Error("Material line not found");

        const section = await ctx.db.get(materialLine.sectionId);

        const skill = await ctx.db
            .query("skills")
            .withIndex("by_name", (q) => q.eq("name", "solutioning"))
            .first();

        return {
            project,
            materialLine,
            section,
            systemPrompt: skill?.content || FALLBACK_SYSTEM_PROMPT,
        };
    },
});

export const saveDraftPlan = internalMutation({
    args: {
        materialLineId: v.id("materialLines"),
        solutionPlan: v.string(),
        solutionPlanJson: v.string(),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.materialLineId, {
            solutionPlan: args.solutionPlan,
            solutionPlanJson: args.solutionPlanJson,
            updatedAt: Date.now(),
            lastUpdatedBy: "solutioning_agent",
        });
    },
});

export const send = action({
    args: {
        threadId: v.id("chatThreads"),
        materialLineId: v.id("materialLines"),
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

        const { materialLine, section, systemPrompt } = await ctx.runQuery(internal.agents.solutioningV2.getContext, {
            projectId: project._id,
            materialLineId: args.materialLineId,
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

        const contextLines = [
            `Project: ${project.name}`,
            `Client: ${project.clientName}`,
            `Stage: ${project.stage ?? "planning"}`,
            `Budget tier: ${project.budgetTier ?? "unknown"}`,
            `Project types: ${(project.projectTypes ?? []).join(", ") || "none"}`,
            `Default language: ${project.defaultLanguage ?? "he"}`,
            "",
            "Material line:",
            `- Label: ${materialLine.label}`,
            `- Category: ${materialLine.category}`,
            `- Quantity: ${materialLine.plannedQuantity} ${materialLine.unit}`,
            `- Section: ${section ? `${section.group} / ${section.name}` : "unknown"}`,
            `- Note: ${materialLine.note ?? "none"}`,
            "",
            "Existing plan (if any):",
            materialLine.solutionPlan ?? "(none)",
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
        materialLineId: v.id("materialLines"),
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
            materialLineId: args.materialLineId,
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
            materialLineId: args.materialLineId,
            solutionPlan: extracted.markdown,
            solutionPlanJson: JSON.stringify(extracted.plan),
        });

        return { ok: true };
    },
});
