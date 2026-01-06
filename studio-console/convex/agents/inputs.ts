import { ActionCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { api } from "../_generated/api";

export async function buildSkillInput(
    ctx: ActionCtx,
    skillKey: string,
    context: {
        projectId: Id<"projects">;
        conversationId?: Id<"projectConversations">;
        userMessage: string;
        runningMemory: string;
        state: any;
    }
): Promise<any> {
    const { projectId, userMessage, runningMemory, conversationId } = context;
    const recentMessages = conversationId
        ? await ctx.runQuery(api.projectConversations.listRecentMessages, {
            projectId,
            conversationId,
            limit: 10,
        })
        : [];
    const sharedContext = {
        runningMemory,
        recentMessages: recentMessages.map((message) => ({
            role: message.role,
            content: message.content,
            createdAt: message.createdAt,
        })),
    };

    // Common fetches (executed on demand or pre-fetched if cheap)
    // We already have runningMemory and state (workspace).

    // 1. Inputs for specific skills
    if (skillKey === "questions.pack5") {
        const approvedElements = await ctx.runQuery(api.items.listApproved, { projectId });
        return {
            stage: context.state?.workspace?.stagePinned || "planning",
            briefText: runningMemory, // The memory assumes role of brief/context
            knownFacts: {}, // The memory markdown is the facts source now
            approvedElements: approvedElements.map(e => ({ title: e.title, type: e.typeKey })), // Minify
            recentQA: (context.state as any)?.transcript || "",
            ...sharedContext,
        };
    }

    if (skillKey === "ideation.elementsGenerator") {
        return {
            briefText: userMessage + "\n\nContext:\n" + runningMemory,
            knownFacts: {}, // Using text for now
            constraints: [],
            styleRefs: "",
            ...sharedContext,
        };
    }

    if (skillKey === "planning.masterPlan") {
        const approvedElements = await ctx.runQuery(api.items.listApproved, { projectId });
        return {
            approvedElements: approvedElements.map(e => ({ title: e.title, category: e.category })),
            schedule: {}, // TODO: fetch schedule
            constraints: [],
            budgetConfig: {},
            ...sharedContext,
        };
    }

    if (skillKey === "tasks.builderAndOptimizer") {
        const [approvedElements, existingTasks] = await Promise.all([
            ctx.runQuery(api.items.listApproved, { projectId }),
            ctx.runQuery(api.tasks.listByProject, { projectId })
        ]);
        return {
            approvedElements: approvedElements.map(e => ({ id: e._id, title: e.title })),
            activePlan_he: "", // Derived from memory if needed
            existingTasks: existingTasks.map(t => ({ id: t._id, title: t.title, status: t.status })),
            crew: {},
            stageFocus: "generate", // Default, maybe derive from userMessage?
            ...sharedContext,
        };
    }

    if (skillKey === "accounting.costModelAndQuoteDraft") {
        const [approvedElements, tasks] = await Promise.all([
            ctx.runQuery(api.items.listApproved, { projectId }),
            ctx.runQuery(api.tasks.listByProject, { projectId })
        ]);
        // We might want full details for accounting
        return {
            approvedElements: approvedElements.map(e => ({ title: e.title })),
            tasksSummary: tasks.map(t => ({ title: t.title })),
            knownPrices: [],
            laborRates: [],
            markupConfig: {},
            ...sharedContext,
        };
    }

    if (skillKey === "changeset.builder") {
        // Generic changeset builder
        return {
            userRequest: userMessage,
            workspaceState: {
                stage: context.state?.workspace?.stagePinned,
                memory: runningMemory
            },
            targets: [], // Implicit
            ...sharedContext,
        };
    }

    // Default Fallback
    // Return what we have
    return {
        userMessage,
        workspaceSummary: runningMemory,
        projectContext: runningMemory,
        ...sharedContext,
    };
}
