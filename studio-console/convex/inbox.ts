import { v } from "convex/values";
import { action, mutation, query, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { callChatWithSchema } from "./lib/openai";
import { z } from "zod";

// Schema for Triage
const TriageSchema = z.object({
    tasks: z.array(z.object({
        title: z.string(),
        details: z.string().optional(),
        priority: z.enum(["High", "Medium", "Low"]).optional(),
        dueInDays: z.number().optional(),
        tags: z.array(z.string()),
    })),
    decisions: z.array(z.object({
        title: z.string(),
        details: z.string().optional(),
        options: z.array(z.string()).optional(),
    })),
    questions: z.array(z.object({
        question: z.string(),
        reason: z.string().optional(),
        priority: z.enum(["High", "Medium", "Low"]).optional(),
    })),
});

export const createItem = mutation({
    args: {
        projectId: v.optional(v.id("projects")),
        source: v.union(v.literal("email"), v.literal("whatsapp"), v.literal("upload"), v.literal("drive")),
        fromName: v.optional(v.string()),
        fromAddressOrPhone: v.optional(v.string()),
        subject: v.optional(v.string()),
        bodyText: v.string(),
        attachments: v.array(v.object({
            fileId: v.string(),
            name: v.string(),
            mimeType: v.string(),
            sizeBytes: v.number(),
        })),
    },
    handler: async (ctx, args) => {
        const itemId = await ctx.db.insert("inboxItems", {
            projectId: args.projectId,
            source: args.source,
            fromName: args.fromName,
            fromAddressOrPhone: args.fromAddressOrPhone,
            subject: args.subject,
            bodyText: args.bodyText,
            receivedAt: Date.now(),
            status: "new",
            attachments: args.attachments,
            linked: {},
        });

        // Trigger triage
        await ctx.scheduler.runAfter(0, api.inbox.runTriage, { inboxItemId: itemId });
        
        return itemId;
    },
});

export const list = query({
    args: { projectId: v.optional(v.id("projects")) },
    handler: async (ctx, args) => {
        if (args.projectId) {
            return await ctx.db
                .query("inboxItems")
                .withIndex("by_project_receivedAt", (q) => q.eq("projectId", args.projectId))
                .order("desc")
                .collect();
        }
        return await ctx.db.query("inboxItems").order("desc").collect();
    },
});

export const get = query({
    args: { inboxItemId: v.id("inboxItems") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.inboxItemId);
    },
});

export const assignToProject = mutation({
    args: { inboxItemId: v.id("inboxItems"), projectId: v.id("projects") },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.inboxItemId, { projectId: args.projectId });
    },
});

export const archive = mutation({
    args: { inboxItemId: v.id("inboxItems") },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.inboxItemId, { status: "archived" });
    },
});

export const updateTriageStatus = internalMutation({
    args: { 
        inboxItemId: v.id("inboxItems"), 
        status: v.union(v.literal("running"), v.literal("done"), v.literal("failed")),
        suggestions: v.optional(v.any()), 
        error: v.optional(v.string())
    },
    handler: async (ctx, args) => {
        const update: any = { 
            suggestions: { 
                ...(args.suggestions || {}),
                triage: { status: args.status, error: args.error } 
            } 
        };
        
        const item = await ctx.db.get(args.inboxItemId);
        if (!item) return;

        const currentSuggestions = item.suggestions || { 
            tasksDraft: [], decisionsDraft: [], questionsDraft: [], triage: { status: "not_started" } 
        };

        if (args.suggestions) {
            update.suggestions = {
                ...args.suggestions,
                triage: { status: args.status, error: args.error }
            };
        } else {
            update.suggestions = {
                ...currentSuggestions,
                triage: { status: args.status, error: args.error }
            };
        }

        await ctx.db.patch(args.inboxItemId, update);
    }
});

export const runTriage = action({
    args: { inboxItemId: v.id("inboxItems") },
    handler: async (ctx, args) => {
        const item = await ctx.runQuery(api.inbox.get, { inboxItemId: args.inboxItemId });
        if (!item) throw new Error("Item not found");

        await ctx.runMutation(internal.inbox.updateTriageStatus, { 
            inboxItemId: args.inboxItemId, 
            status: "running" 
        });

        try {
            const prompt = `
                Analyze this inbox message and suggest tasks, decisions, and questions.
                From: ${item.fromName} (${item.fromAddressOrPhone})
                Subject: ${item.subject}
                Body: ${item.bodyText}
                Attachments: ${item.attachments.map((a: any) => a.name).join(", ")}
            `;

            const result = await callChatWithSchema(TriageSchema, {
                systemPrompt: "You are a Project Manager Assistant. Triage this message.",
                userPrompt: prompt,
            });

            await ctx.runMutation(internal.inbox.updateTriageStatus, {
                inboxItemId: args.inboxItemId,
                status: "done",
                suggestions: {
                    tasksDraft: result.tasks.map(t => ({
                        ...t,
                        dueAt: t.dueInDays ? Date.now() + t.dueInDays * 86400000 : undefined
                    })),
                    decisionsDraft: result.decisions,
                    questionsDraft: result.questions,
                }
            });

        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Unknown error";
            await ctx.runMutation(internal.inbox.updateTriageStatus, {
                inboxItemId: args.inboxItemId,
                status: "failed",
                error: message
            });
        }
    },
});

export const acceptSuggestions = mutation({
    args: {
        inboxItemId: v.id("inboxItems"),
        acceptedTasks: v.array(v.number()), // Indices
        acceptedDecisions: v.array(v.number()), // Indices
        acceptedQuestions: v.array(v.number()), // Indices
    },
    handler: async (ctx, args) => {
        const item = await ctx.db.get(args.inboxItemId);
        if (!item || !item.suggestions) throw new Error("Item or suggestions not found");
        if (!item.projectId) throw new Error("Project must be assigned before accepting suggestions");

        const createdTaskIds = [];
        
        // Create Tasks
        for (const index of args.acceptedTasks) {
            const draft = item.suggestions.tasksDraft[index];
            if (draft) {
                const taskId = await ctx.db.insert("tasks", {
                    projectId: item.projectId,
                    title: draft.title,
                    description: draft.details,
                    status: "todo",
                    category: "Admin", // Default
                    priority: (draft.priority as any) || "Medium",
                    source: "agent",
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                });
                createdTaskIds.push(taskId);
            }
        }

        // Note: Decisions and Questions tables are not yet defined in schema.
        // For now, we only create tasks.
        
        await ctx.db.patch(args.inboxItemId, {
            status: "triaged",
            linked: {
                ...item.linked,
                taskIds: [...(item.linked.taskIds || []), ...createdTaskIds],
            }
        });
    },
});
