import { action } from "../_generated/server";
import { internal, api } from "../_generated/api";

export const testSuggestionsFlow = action({
    handler: async (ctx) => {
        const { projectId } = await ctx.runMutation(internal.scripts.test_helpers.setupTestEnvironment, {});

        // Run Skill Directly
        console.log("--- Running ideation.elementIdeas ---");
        const skillResult = await ctx.runAction(api.agents.skillRunner.run, {
            skillKey: "ideation.elementIdeas",
            input: {
                brief: { goal: "Fun pop-up store", audience: "Teens" },
                constraints: { budget: "Low", size: "Small" }
            }
        });
        
        console.log("--- Skill Result ---");
        console.log(JSON.stringify(skillResult, null, 2));

        return skillResult;
    }
});
