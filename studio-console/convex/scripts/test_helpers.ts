import { mutation } from "../_generated/server";
import { v } from "convex/values";

export const setupTestEnvironment = mutation({
    args: {},
    handler: async (ctx) => {
        // 1. Create Project
        const projectId = await ctx.db.insert("projects", {
            name: "Test Project Auto",
            clientName: "Test Client",
            status: "planning",
            stage: "planning",
            details: {
                notes: "Auto generated test project"
            },
            createdAt: Date.now(),
            createdBy: "test_runner"
        });

        // 2. Create Scenario
        const scenarioId = await ctx.db.insert("projectScenarios", {
            projectId,
            phase: "planning",
            scenarioKey: "default",
            createdAt: Date.now(),
            createdBy: "test_runner"
        });

        // 3. Create Thread
        const threadId = await ctx.db.insert("chatThreads", {
            projectId,
            scenarioId,
            title: "Test Thread",
            createdAt: Date.now(),
            createdBy: "test_runner"
        });

        // 4. Create Conversation
        const conversationId = await ctx.db.insert("projectConversations", {
            projectId,
            title: "Test Conversation",
            stageTag: "planning",
            defaultChannel: "free",
            contextMode: "all",
            status: "active",
            createdAt: Date.now(),
            updatedAt: Date.now()
        });

        return { projectId, threadId, conversationId };
    }
});
