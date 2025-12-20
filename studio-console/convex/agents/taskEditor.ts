import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { callChatWithSchema, streamChatText } from "../lib/openai";
import { ItemSpecV2Schema, TaskEditorPatchSchema, type ItemSpecV2 } from "../lib/zodSchemas";
import type { Doc } from "../_generated/dataModel";

const FALLBACK_SYSTEM_PROMPT = [
    "You are a task editor assistant for a creative studio project.",
    "Your job is to help the user refine and update a single task.",
    "Be concise, specific, and only change what the user asked for.",
    "Default to the project's default language unless the user explicitly requests otherwise.",
].join("\n");

function updateSubtaskById(
    subtasks: ItemSpecV2["breakdown"]["subtasks"],
    subtaskId: string,
    patch: Partial<ItemSpecV2["breakdown"]["subtasks"][number]>,
): { updated: boolean; subtasks: ItemSpecV2["breakdown"]["subtasks"] } {
    let updated = false;
    const next = subtasks.map((subtask) => {
        if (subtask.id === subtaskId) {
            updated = true;
            return { ...subtask, ...patch };
        }
        if (subtask.children && subtask.children.length > 0) {
            const childResult = updateSubtaskById(subtask.children, subtaskId, patch);
            if (childResult.updated) {
                updated = true;
                return { ...subtask, children: childResult.subtasks };
            }
        }
        return subtask;
    });
    return { updated, subtasks: next };
}

function resolveBaseSpec(item: Doc<"projectItems">, revisions: Doc<"itemRevisions">[]) {
    const draft = revisions
        .filter((rev) => rev.tabScope === "tasks" && rev.state === "proposed")
        .sort((a, b) => b.revisionNumber - a.revisionNumber)[0] ?? null;
    const approved = item.approvedRevisionId
        ? revisions.find((rev) => rev._id === item.approvedRevisionId) ?? null
        : null;
    const active = draft ?? approved;
    if (active) {
        const parsed = ItemSpecV2Schema.safeParse(active.data);
        if (parsed.success) return parsed.data;
    }
    return ItemSpecV2Schema.parse({
        version: "ItemSpecV2",
        identity: { title: item.title, typeKey: item.typeKey },
    });
}

export const getContext = internalQuery({
    args: { taskId: v.id("tasks") },
    handler: async (ctx, args) => {
        const task = await ctx.db.get(args.taskId);
        if (!task) throw new Error("Task not found");
        const project = await ctx.db.get(task.projectId);
        if (!project) throw new Error("Project not found");

        const skill = await ctx.db
            .query("skills")
            .withIndex("by_name", (q) => q.eq("name", "task_editor"))
            .first();

        return { project, task, systemPrompt: skill?.content || FALLBACK_SYSTEM_PROMPT };
    },
});

export const applyPatch = internalMutation({
    args: {
        taskId: v.id("tasks"),
        patch: v.object({
            title: v.optional(v.string()),
            description: v.optional(v.string()),
            status: v.optional(
                v.union(v.literal("todo"), v.literal("in_progress"), v.literal("blocked"), v.literal("done"))
            ),
            category: v.optional(
                v.union(
                    v.literal("Logistics"),
                    v.literal("Creative"),
                    v.literal("Finance"),
                    v.literal("Admin"),
                    v.literal("Studio")
                )
            ),
            priority: v.optional(v.union(v.literal("High"), v.literal("Medium"), v.literal("Low"))),
            estimatedMinutes: v.optional(v.union(v.number(), v.null())),
            steps: v.optional(v.array(v.string())),
            subtasks: v.optional(v.array(v.object({ title: v.string(), done: v.boolean() }))),
            assignee: v.optional(v.union(v.string(), v.null())),
        }),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.taskId, { ...args.patch, updatedAt: Date.now() });

        const task = await ctx.db.get(args.taskId);
        if (!task?.itemId || !task.itemSubtaskId) return;

        const item = await ctx.db.get(task.itemId);
        if (!item) return;

        const revisions = await ctx.db
            .query("itemRevisions")
            .withIndex("by_item_revision", (q) => q.eq("itemId", item._id))
            .collect();

        const baseSpec = resolveBaseSpec(item, revisions);
        const { updated, subtasks } = updateSubtaskById(baseSpec.breakdown.subtasks, task.itemSubtaskId, {
            status: task.status,
            estMinutes: task.estimatedMinutes ?? undefined,
        });

        if (!updated) return;

        const nextSpec = ItemSpecV2Schema.parse({
            ...baseSpec,
            breakdown: {
                ...baseSpec.breakdown,
                subtasks,
            },
        });

        await ctx.runMutation(api.items.upsertRevision, {
            itemId: item._id,
            tabScope: "tasks",
            dataOrPatch: nextSpec,
            changeReason: "Synced from task editor.",
            createdByKind: "agent",
        });
    },
});

export const send = action({
    args: {
        threadId: v.id("chatThreads"),
        taskId: v.id("tasks"),
        userContent: v.string(),
        thinkingMode: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        await ctx.runMutation(internal.rateLimit.consume, {
            key: `taskEditor:${args.threadId}`,
            limit: 30,
            windowMs: 60_000,
        });

        const { scenario, messages } = await ctx.runQuery(internal.chat.getThreadContext, {
            threadId: args.threadId,
        });
        const { project, task, systemPrompt } = await ctx.runQuery(internal.agents.taskEditor.getContext, {
            taskId: args.taskId,
        });

        const settings = await ctx.runQuery(internal.settings.getAll);
        const model = settings.modelConfig?.taskEditor || "gpt-5.2";

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

        const transcript = [
            ...messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`),
            `USER: ${args.userContent}`,
        ].join("\n");

        const taskSnapshot = {
            title: task.title,
            description: task.description ?? "",
            status: task.status,
            category: task.category,
            priority: task.priority,
            estimatedMinutes: task.estimatedMinutes ?? null,
            steps: task.steps ?? [],
            subtasks: task.subtasks ?? [],
            assignee: task.assignee ?? null,
        };

        const userPrompt = [
            `Project: ${project.name}`,
            `Client: ${project.clientName}`,
            `Default language: ${project.defaultLanguage ?? "he"}`,
            "",
            "Task (current state):",
            JSON.stringify(taskSnapshot, null, 2),
            "",
            "User request:",
            args.userContent,
            "",
            "Conversation history:",
            transcript,
            "",
            "Instructions:",
            "- Propose precise updates to the task and explain them.",
            "- Keep your response short and actionable.",
            "- Do not include raw JSON in the user-visible response; it will be extracted separately.",
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

            const extracted = await callChatWithSchema(TaskEditorPatchSchema, {
                model,
                systemPrompt: [
                    "You are extracting a task patch from a conversation.",
                    "Return a minimal patch object that updates ONLY what the user requested.",
                    "If a field should be cleared, use null (where supported) or [] for lists.",
                    "Return valid JSON only.",
                ].join("\n"),
                userPrompt: JSON.stringify(
                    {
                        userRequest: args.userContent,
                        taskBefore: taskSnapshot,
                        assistantMessage: finalContent,
                    },
                    null,
                    2
                ),
                maxRetries: 2,
                language: project.defaultLanguage === "en" ? "en" : "he",
            });

            await ctx.runMutation(internal.agents.taskEditor.applyPatch, {
                taskId: args.taskId,
                patch: extracted.patch,
            });

            await ctx.runMutation(internal.chat.createMessage, {
                projectId: project._id,
                scenarioId: scenario._id,
                threadId: args.threadId,
                role: "system",
                content: `Applied: ${extracted.summary}`,
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
