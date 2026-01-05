
import { api, internal } from "../_generated/api";
import { action } from "../_generated/server";

export const check = action({
    args: {},
    handler: async (ctx) => {
        // Get the most recent project
        const projects = await ctx.runQuery(api.projects.listProjects, {});
        const project = projects[0];

        // Check TurnBundles content
        const bundles = await ctx.runQuery(internal.turnBundles.listByProject, {
            projectId: project._id,
            limit: 1
        });

        if (bundles.length > 0) {
            console.log("Latest Bundle Content:");
            console.log(bundles[0].bundleText);
        } else {
            console.log("No bundles.");
        }
    },
});
