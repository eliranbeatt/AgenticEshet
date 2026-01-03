import { query } from "../_generated/server";

export const checkSkill = query({
    handler: async (ctx) => {
        const skill = await ctx.db
            .query("skills")
            .withIndex("by_skillKey", (q) => q.eq("skillKey", "controller.autonomousPlanner"))
            .first();
        console.log(JSON.stringify(skill, null, 2));
    }
});
