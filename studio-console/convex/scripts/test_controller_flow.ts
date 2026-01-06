import { action } from "../_generated/server";
import { internal, api } from "../_generated/api";

export const testFlow = action({
    handler: async (ctx) => {
        // 1. Setup Project & Thread via helper mutation
        const { projectId, threadId, conversationId } = await ctx.runMutation(internal.scripts.test_helpers.setupTestEnvironment, {});

        // 2. Setup Workspace
        const { workspaceId } = await ctx.runMutation(api.projectWorkspaces.ensure, {
            projectId,
            conversationId
        });

        // 2.5 Seed Facts
        await ctx.runMutation(internal.projectWorkspaces.seedFacts, {
            workspaceId,
            facts: {
                projectType: "Pop-up Store",
                budget: 50000,
                deadline: "2026-02-01",
                location: "Tel Aviv Port"
            }
        });
        
        // 3. Run Controller Step via UI Action
        console.log("--- Calling continueRun ---");
        await ctx.runAction(api.agents.controller.continueRun, {
            projectId,
            conversationId,
            userMessage: "Start planning",
            mode: "continue"
        });

        // 3.25 Check Running Memory + Recent Messages
        const runningMemory = await ctx.runQuery(api.memory.getRunningMemoryMarkdown, { projectId });
        const recentMessages = await ctx.runQuery(api.projectConversations.listRecentMessages, {
            projectId,
            conversationId,
            limit: 10
        });
        console.log("--- Running Memory ---");
        console.log(runningMemory);
        console.log("--- Recent Messages ---");
        console.log(JSON.stringify(recentMessages.map((m) => ({
            role: m.role,
            content: m.content,
            createdAt: m.createdAt
        })), null, 2));

        // 3.5 Check Workspace
        const workspace = await ctx.runQuery(api.projectWorkspaces.getByConversation, { projectId, conversationId });
        const result = workspace?.artifactsIndex?.lastControllerOutput;
        console.log("--- Workspace Result ---");
        console.log(JSON.stringify(result, null, 2));
        
        // 4. Inspect Agent Runs
        const runs = await ctx.runQuery(internal.agentRuns.listByProject, { projectId });
        console.log("--- Agent Runs ---");
        console.log(JSON.stringify(runs, null, 2));

        return result;
    }
});
