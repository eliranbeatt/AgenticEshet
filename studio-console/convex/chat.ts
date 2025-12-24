import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { streamChatText } from "./lib/openai";

export const getThreadMessagesByScenarioKey = internalQuery({
    args: {
        projectId: v.id("projects"),
        phase: v.string(),
        scenarioKey: v.string(),
    },
    handler: async (ctx, args) => {
        const scenario = await ctx.db
            .query("projectScenarios")
            .withIndex("by_project_phase_key", (q) =>
                q.eq("projectId", args.projectId).eq("phase", args.phase).eq("scenarioKey", args.scenarioKey)
            )
            .first();

        if (!scenario) return [];

        const thread = await ctx.db
            .query("chatThreads")
            .withIndex("by_scenario", (q) => q.eq("scenarioId", scenario._id))
            .first();

        if (!thread) return [];

        const messages = await ctx.db
            .query("chatMessages")
            .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
            .collect();

        return messages;
    },
});

export const ensureThread = mutation({
    args: {
        projectId: v.id("projects"),
        phase: v.union(
            v.literal("ideation"),
            v.literal("clarification"),
            v.literal("planning"),
            v.literal("solutioning"),
            v.literal("tasks"),
            v.literal("quote")
        ),
        scenarioKey: v.string(),
        title: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const scenario =
            (await ctx.db
                .query("projectScenarios")
                .withIndex("by_project_phase_key", (q) =>
                    q.eq("projectId", args.projectId).eq("phase", args.phase).eq("scenarioKey", args.scenarioKey)
                )
                .first()) ?? null;

        const scenarioId =
            scenario?._id ??
            (await ctx.db.insert("projectScenarios", {
                projectId: args.projectId,
                phase: args.phase,
                scenarioKey: args.scenarioKey,
                title: args.title,
                createdAt: Date.now(),
                createdBy: "user",
            }));

        const thread =
            (await ctx.db
                .query("chatThreads")
                .withIndex("by_scenario", (q) => q.eq("scenarioId", scenarioId))
                .first()) ?? null;

        const threadId =
            thread?._id ??
            (await ctx.db.insert("chatThreads", {
                projectId: args.projectId,
                scenarioId,
                title: args.title,
                createdAt: Date.now(),
                createdBy: "user",
            }));

        if (scenario && args.title && args.title !== scenario.title) {
            await ctx.db.patch(scenario._id, { title: args.title, updatedAt: Date.now() });
        }
        if (thread && args.title && args.title !== thread.title) {
            await ctx.db.patch(thread._id, { title: args.title, updatedAt: Date.now() });
        }

        return { scenarioId, threadId };
    },
});

export const ensureDefaultThread = mutation({
    args: {
        projectId: v.id("projects"),
        phase: v.union(
            v.literal("ideation"),
            v.literal("clarification"),
            v.literal("planning"),
            v.literal("solutioning"),
            v.literal("tasks"),
            v.literal("quote")
        ),
        title: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const scenarioKey = "default";
        const scenario =
            (await ctx.db
                .query("projectScenarios")
                .withIndex("by_project_phase_key", (q) =>
                    q.eq("projectId", args.projectId).eq("phase", args.phase).eq("scenarioKey", scenarioKey)
                )
                .first()) ?? null;

        const scenarioId =
            scenario?._id ??
            (await ctx.db.insert("projectScenarios", {
                projectId: args.projectId,
                phase: args.phase,
                scenarioKey,
                title: args.title,
                createdAt: Date.now(),
                createdBy: "user",
            }));

        const thread =
            (await ctx.db
                .query("chatThreads")
                .withIndex("by_scenario", (q) => q.eq("scenarioId", scenarioId))
                .first()) ?? null;

        const threadId =
            thread?._id ??
            (await ctx.db.insert("chatThreads", {
                projectId: args.projectId,
                scenarioId,
                title: args.title,
                createdAt: Date.now(),
                createdBy: "user",
            }));

        return { scenarioId, threadId };
    },
});

export const listMessages = query({
    args: { threadId: v.id("chatThreads") },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("chatMessages")
            .withIndex("by_thread_createdAt", (q) => q.eq("threadId", args.threadId))
            .order("asc")
            .collect();
    },
});

export const getThreadContext = internalQuery({
    args: { threadId: v.id("chatThreads") },
    handler: async (ctx, args) => {
        const thread = await ctx.db.get(args.threadId);
        if (!thread) throw new Error("Thread not found");
        const scenario = await ctx.db.get(thread.scenarioId);
        if (!scenario) throw new Error("Scenario not found");
        const project = await ctx.db.get(thread.projectId);
        if (!project) throw new Error("Project not found");

        const messages = await ctx.db
            .query("chatMessages")
            .withIndex("by_thread_createdAt", (q) => q.eq("threadId", args.threadId))
            .order("asc")
            .collect();

        return { thread, scenario, project, messages };
    },
});

export const createMessage = internalMutation({
    args: {
        projectId: v.id("projects"),
        scenarioId: v.id("projectScenarios"),
        threadId: v.id("chatThreads"),
        role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
        content: v.string(),
        status: v.optional(v.union(v.literal("streaming"), v.literal("final"), v.literal("error"))),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("chatMessages", {
            projectId: args.projectId,
            scenarioId: args.scenarioId,
            threadId: args.threadId,
            role: args.role,
            content: args.content,
            status: args.status,
            createdAt: Date.now(),
            createdBy: "user",
        });
    },
});

export const patchMessage = internalMutation({
    args: {
        messageId: v.id("chatMessages"),
        content: v.optional(v.string()),
        status: v.optional(v.union(v.literal("streaming"), v.literal("final"), v.literal("error"))),
    },
    handler: async (ctx, args) => {
        const { messageId, ...patch } = args;
        await ctx.db.patch(messageId, { ...patch, updatedAt: Date.now() });
    },
});

export const sendAndStreamText = action({
    args: {
        threadId: v.id("chatThreads"),
        userContent: v.string(),
        systemPrompt: v.string(),
        model: v.optional(v.string()),
        thinkingMode: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        await ctx.runMutation(internal.rateLimit.consume, {
            key: `chat:${args.threadId}`,
            limit: 30,
            windowMs: 60_000,
        });

        const { project, scenario, messages } = await ctx.runQuery(internal.chat.getThreadContext, {
            threadId: args.threadId,
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

        try {
            const transcript = [
                ...messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`),
                `USER: ${args.userContent}`,
            ].join("\n");

            const input = [
                `PROJECT: ${project.name}`,
                `CLIENT: ${project.clientName}`,
                `PHASE: ${scenario.phase}`,
                `DEFAULT_LANGUAGE: ${project.defaultLanguage ?? "he"}`,
                "",
                "Conversation:",
                transcript,
            ].join("\n");

            let buffer = "";
            let lastFlushedAt = 0;
            await streamChatText({
                systemPrompt: args.systemPrompt,
                userPrompt: input,
                model: args.model,
                thinkingMode: args.thinkingMode,
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
