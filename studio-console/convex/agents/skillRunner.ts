import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { runSkillLogic } from "../lib/skills";

export const run = action({
    args: {
        skillKey: v.string(),
        input: v.any(),
    },
    handler: async (ctx, args) => {
        const skill = await ctx.runQuery(internal.lib.skills.getSkillByKey, {
            skillKey: args.skillKey,
        });

        if (!skill) {
            throw new Error(`Skill not found: ${args.skillKey}`);
        }

        // In a real app, we'd have the LLM call here.
        // For the unit test, we rely on the logic inside runSkillLogic
        // or we expect the test to mock this action entirely.
        // However, to make the unit test `skills.test.ts` work which imports `runSkill` from `lib`,
        // we actually tested the library function directly?
        // Wait, the test imported `runSkill` from `../../convex/lib/skills`.
        // Let's ensure `runSkill` exists in `lib/skills.ts` or `agents/skillRunner.ts`.
        
        // I put `runSkillLogic` in `lib/skills.ts`. Let's export a helper there.
        return await runSkillLogic(ctx, skill, args.input);
    },
});
