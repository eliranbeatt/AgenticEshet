import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { callChatWithSchema, streamChatText } from "../lib/openai";
import { IdeationConceptsSchema } from "../lib/zodSchemas";

const FALLBACK_SYSTEM_PROMPT = [
    "You are an ideation assistant for experiential design / studio build projects.",
    "You propose concepts that are realistic to execute and aligned with constraints.",
    "Always default to the project's default language unless the user explicitly requests otherwise.",
].join("\n");

export const getContext = internalQuery({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const project = await ctx.db.get(args.projectId);
        if (!project) throw new Error("Project not found");

        const skill = await ctx.db
            .query("skills")
            .withIndex("by_name", (q) => q.eq("name", "ideation"))
            .first();

        const relatedProjects = project.relatedPastProjectIds?.length
            ? await Promise.all(project.relatedPastProjectIds.map((id) => ctx.db.get(id)))
            : [];

        return {
            project,
            systemPrompt: skill?.content || FALLBACK_SYSTEM_PROMPT,
            relatedProjects: relatedProjects.filter(Boolean),
        };
    },
});

export const upsertConceptCards = internalMutation({
    args: {
        projectId: v.id("projects"),
        threadId: v.id("chatThreads"),
        concepts: v.array(
            v.object({
                title: v.string(),
                oneLiner: v.string(),
                detailsMarkdown: v.string(),
            })
        ),
    },
    handler: async (ctx, args) => {
        const createdAt = Date.now();
        for (const concept of args.concepts) {
            await ctx.db.insert("ideationConceptCards", {
                projectId: args.projectId,
                threadId: args.threadId,
                title: concept.title,
                oneLiner: concept.oneLiner,
                detailsMarkdown: concept.detailsMarkdown,
                createdAt,
                createdBy: "agent",
            });
        }
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
        const { systemPrompt, relatedProjects } = await ctx.runQuery(internal.agents.ideation.getContext, {
            projectId: project._id,
        });

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
            `Stage: ${project.stage ?? "ideation"}`,
            `Budget tier: ${project.budgetTier ?? "unknown"}`,
            `Project types: ${(project.projectTypes ?? []).join(", ") || "none"}`,
            `Default language: ${project.defaultLanguage ?? "he"}`,
        ];

        const relatedLines = relatedProjects.length
            ? [
                  "Related past projects (for inspiration, do not copy blindly):",
                  ...relatedProjects.map((p) => `- ${p.name}: ${p.overviewSummary ?? p.details.notes ?? ""}`.trim()),
              ]
            : ["Related past projects: none"];

        const transcript = [
            ...messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`),
            `USER: ${args.userContent}`,
        ].join("\n");

        const userPrompt = [
            ...contextLines,
            "",
            ...relatedLines,
            "",
            "Task:",
            "Generate exactly 3 distinct concept directions.",
            "Format as Markdown with headings:",
            "## Concept 1: <title>",
            "## Concept 2: <title>",
            "## Concept 3: <title>",
            "Under each concept include:",
            "- One-liner (bold)",
            "- Visual language keywords",
            "- Materials / build approach",
            "- Timeline (high level)",
            "- Risks + mitigations",
            "- Budget fit (tie to the project's budget tier)",
            "",
            "Conversation history:",
            transcript,
        ].join("\n");

        let buffer = "";
        let lastFlushedAt = 0;
        try {
            await streamChatText({
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

            const extracted = await callChatWithSchema(IdeationConceptsSchema, {
                systemPrompt:
                    "Extract exactly 3 concept cards from the assistant markdown. Use the same language as the content.",
                userPrompt: finalContent,
                maxRetries: 2,
                language: project.defaultLanguage === "en" ? "en" : "he",
            });

            await ctx.runMutation(internal.agents.ideation.upsertConceptCards, {
                projectId: project._id,
                threadId: args.threadId,
                concepts: extracted.concepts.slice(0, 3),
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
