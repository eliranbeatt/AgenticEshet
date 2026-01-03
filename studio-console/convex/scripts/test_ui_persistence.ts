import { action } from "../_generated/server";
import { internal, api } from "../_generated/api";

export const testUiPersistence = action({
    handler: async (ctx) => {
        // 1. Setup
        const { projectId, conversationId } = await ctx.runMutation(internal.scripts.test_helpers.setupTestEnvironment, {});

        // 2. Call continueRun (Simulate UI)
        console.log("--- Calling continueRun ---");
        await ctx.runAction(api.agents.controller.continueRun, {
            projectId,
            conversationId,
            userMessage: "Start planning"
        });

        // 3. Inspect Workspace
        const workspace = await ctx.runQuery(api.projectWorkspaces.getByConversation, { projectId, conversationId });
        const lastOutput = workspace?.artifactsIndex?.lastControllerOutput;
        
        console.log("--- Workspace Output ---");
        console.log(JSON.stringify(lastOutput, null, 2));

        if (!lastOutput || !lastOutput.mode) {
            throw new Error("UI Persistence Failed: lastControllerOutput missing");
        }

        return { success: true, mode: lastOutput.mode };
    }
});
