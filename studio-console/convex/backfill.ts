import { v } from "convex/values";
import { action, internalQuery } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";

type SourceType = "doc_upload" | "plan" | "conversation" | "task" | "quest" | "quote" | "system_note";

const ingestArtifact = (internal as any).knowledge.ingestArtifact;

async function alreadyIngested(ctx: ActionCtx, sourceType: SourceType, sourceRefId: string) {
    const existing = await ctx.runQuery(internal.knowledge.findBySourceRef, { sourceType, sourceRefId });
    return existing.length > 0;
}

export const getProject = internalQuery({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        return ctx.db.get(args.projectId);
    },
});

export const listProjects = internalQuery({
    args: {},
    handler: async (ctx) => {
        return ctx.db.query("projects").collect();
    },
});

export const listPlansByProject = internalQuery({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        return ctx.db.query("plans").withIndex("by_project", (q) => q.eq("projectId", args.projectId)).collect();
    },
});

export const listConversationsByProject = internalQuery({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        return ctx.db.query("conversations").withIndex("by_project_phase", (q) => q.eq("projectId", args.projectId)).collect();
    },
});

export const listTasksByProject = internalQuery({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        return ctx.db.query("tasks").withIndex("by_project", (q) => q.eq("projectId", args.projectId)).collect();
    },
});

export const listQuestsByProject = internalQuery({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        return ctx.db.query("quests").withIndex("by_project", (q) => q.eq("projectId", args.projectId)).collect();
    },
});

export const listQuotesByProject = internalQuery({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        return ctx.db.query("quotes").withIndex("by_project", (q) => q.eq("projectId", args.projectId)).collect();
    },
});

async function ingestPlans(ctx: ActionCtx, project: Doc<"projects">, plans: Doc<"plans">[]) {
    for (const plan of plans) {
        const sourceRefId = plan._id.toString();
        if (await alreadyIngested(ctx, "plan", sourceRefId)) continue;
        await ctx.runAction(ingestArtifact, {
            projectId: project._id,
            sourceType: "plan",
            sourceRefId,
            title: `Plan v${plan.version} (${plan.phase})`,
            text: plan.contentMarkdown,
            summary: plan.reasoning || "Plan summary",
            tags: ["plan", plan.phase],
            phase: plan.phase,
            clientName: project.clientName,
        });
    }
}

async function ingestConversations(ctx: ActionCtx, project: Doc<"projects">, conversations: Doc<"conversations">[]) {
    for (const convo of conversations) {
        const sourceRefId = convo._id.toString();
        if (await alreadyIngested(ctx, "conversation", sourceRefId)) continue;
        let text = "";
        try {
            const parsed = JSON.parse(convo.messagesJson) as { role: string; content: string }[];
            text = parsed.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n");
        } catch {
            text = convo.messagesJson;
        }
        await ctx.runAction(ingestArtifact, {
            projectId: project._id,
            sourceType: "conversation",
            sourceRefId,
            title: `Conversation ${new Date(convo.createdAt).toISOString()}`,
            text,
            summary: `Conversation in phase ${convo.phase}`,
            tags: ["conversation", convo.phase],
            phase: convo.phase,
            clientName: project.clientName,
        });
    }
}

async function ingestTasks(ctx: ActionCtx, project: Doc<"projects">, tasks: Doc<"tasks">[]) {
    for (const task of tasks) {
        const sourceRefId = task._id.toString();
        if (await alreadyIngested(ctx, "task", sourceRefId)) continue;
        const text = [
            `Title: ${task.title}`,
            `Description: ${task.description || ""}`,
            `Category: ${task.category}`,
            `Priority: ${task.priority}`,
            `Status: ${task.status}`,
            task.questId ? `Quest: ${task.questId}` : null,
        ]
            .filter(Boolean)
            .join("\n");
        await ctx.runAction(ingestArtifact, {
            projectId: project._id,
            sourceType: "task",
            sourceRefId,
            title: `Task: ${task.title}`,
            text,
            summary: task.description || task.title,
            tags: ["task", task.category],
            clientName: project.clientName,
        });
    }
}

async function ingestQuests(ctx: ActionCtx, project: Doc<"projects">, quests: Doc<"quests">[]) {
    for (const quest of quests) {
        const sourceRefId = quest._id.toString();
        if (await alreadyIngested(ctx, "quest", sourceRefId)) continue;
        const text = `Quest: ${quest.title}\nDescription: ${quest.description || ""}\nOrder: ${quest.order}`;
        await ctx.runAction(ingestArtifact, {
            projectId: project._id,
            sourceType: "quest",
            sourceRefId,
            title: `Quest: ${quest.title}`,
            text,
            summary: quest.description || quest.title,
            tags: ["quest"],
            clientName: project.clientName,
        });
    }
}

async function ingestQuotes(ctx: ActionCtx, project: Doc<"projects">, quotes: Doc<"quotes">[]) {
    for (const quote of quotes) {
        const sourceRefId = quote._id.toString();
        if (await alreadyIngested(ctx, "quote", sourceRefId)) continue;
        const breakdown = JSON.parse(quote.internalBreakdownJson) as { label: string; amount: number; currency: string; notes?: string | null }[];
        const breakdownText = breakdown.map((item) => `- ${item.label}: ${item.amount} ${item.currency} ${item.notes ?? ""}`).join("\n");
        const text = [
            `Quote v${quote.version}`,
            `Currency: ${quote.currency}`,
            `Total: ${quote.totalAmount}`,
            "Breakdown:",
            breakdownText,
            "",
            "Client Document:",
            quote.clientDocumentText,
        ].join("\n");
        await ctx.runAction(ingestArtifact, {
            projectId: project._id,
            sourceType: "quote",
            sourceRefId,
            title: `Quote v${quote.version}`,
            text,
            summary: quote.clientDocumentText.slice(0, 500),
            tags: ["quote", "pricing"],
            clientName: project.clientName,
            domain: "pricing",
        });
    }
}

export const backfillProject: ReturnType<typeof action> = action({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const project = await ctx.runQuery(internal.backfill.getProject, { projectId: args.projectId });
        if (!project) throw new Error("Project not found");

        const [plans, conversations, tasks, quests, quotes] = await Promise.all([
            ctx.runQuery(internal.backfill.listPlansByProject, { projectId: args.projectId }),
            ctx.runQuery(internal.backfill.listConversationsByProject, { projectId: args.projectId }),
            ctx.runQuery(internal.backfill.listTasksByProject, { projectId: args.projectId }),
            ctx.runQuery(internal.backfill.listQuestsByProject, { projectId: args.projectId }),
            ctx.runQuery(internal.backfill.listQuotesByProject, { projectId: args.projectId }),
        ]);

        await ingestPlans(ctx, project, plans);
        await ingestConversations(ctx, project, conversations);
        await ingestTasks(ctx, project, tasks);
        await ingestQuests(ctx, project, quests);
        await ingestQuotes(ctx, project, quotes);

        return {
            projectId: project._id,
            plans: plans.length,
            conversations: conversations.length,
            tasks: tasks.length,
            quests: quests.length,
            quotes: quotes.length,
        };
    },
});

export const backfillAllProjects: ReturnType<typeof action> = action({
    args: {},
    handler: async (ctx) => {
        const projects = await ctx.runQuery(internal.backfill.listProjects, {});
        const results = [];
        for (const project of projects) {
            try {
                const result = await ctx.runAction(api.backfill.backfillProject, { projectId: project._id as Id<"projects"> });
                results.push(result);
            } catch (error) {
                console.error("Backfill failed for project", project._id, error);
            }
        }
        return results;
    },
});
