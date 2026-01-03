import { action } from "../_generated/server";
import { internal, api } from "../_generated/api";

export const testChangesetFlow = action({
    handler: async (ctx) => {
        // 1. Setup Project & Thread
        const { projectId, threadId, conversationId } = await ctx.runMutation(internal.scripts.test_helpers.setupTestEnvironment, {});

        // 2. Setup Workspace
        const { workspaceId } = await ctx.runMutation(api.projectWorkspaces.ensure, {
            projectId,
            conversationId
        });

        // 2.5 Seed Facts (Simulate request for tasks)
        // We set facts that imply we are ready for tasks.
        await ctx.runMutation(internal.projectWorkspaces.seedFacts, {
            workspaceId,
            facts: {
                projectType: "Pop-up Store",
                budget: 50000,
                deadline: "2026-02-01",
                location: "Tel Aviv Port",
                elements: [
                    { name: "Main Counter", description: "Wood counter 2m, Plywood, White finish" },
                    { name: "Back Wall", description: "Printed PVC 3x3m, Graphics provided by client" }
                ],
                constraints: ["Ground floor access", "No install on Shabbat"],
                userGoal: "Generate tasks for the counter and wall immediately"
            }
        });

        // 2.6 Pin Skill
        await ctx.runMutation(api.projectWorkspaces.setPins, {
            workspaceId,
            skillPinned: "planning.taskBreakdownQuoteLevel"
        });
        
        // 3. Run Skill Directly
        console.log("--- Running Skill Directly ---");
        const skillResult = await ctx.runAction(api.agents.skillRunner.run, {
            skillKey: "planning.taskBreakdownQuoteLevel",
            input: {
                elements: [
                    { name: "Main Counter", description: "Wood counter 2m" },
                    { name: "Back Wall", description: "Printed PVC 3x3m" }
                ],
                existingTasks: []
            }
        });
        
        console.log("--- Skill Result ---");
        console.log(JSON.stringify(skillResult, null, 2));

        return skillResult;
    }
});
