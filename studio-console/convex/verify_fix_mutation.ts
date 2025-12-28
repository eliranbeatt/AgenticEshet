
import { mutation } from "./_generated/server";
import { api } from "./_generated/api";

export const testCreate = mutation({
    args: {},
    handler: async (ctx) => {
        // 1. Get any project
        const project = await ctx.db.query("projects").first();
        if (!project) throw new Error("No projects found to test with");

        // 2. Call the mutation (internal call or direct logic? Direct call via api is safer for simulation)
        // We can't call `api.items.createFromTemplate` easily from here if it's not internal.
        // But `items.ts` exports `createFromTemplate`. We can call it if we import it, OR use ctx.runMutation if it's public.
        // schema.ts definitions are available. 

        // Check if studio_build exists
        const template = await ctx.db.query("templateDefinitions")
            .withIndex("by_templateId_version", q => q.eq("templateId", "studio_build"))
            .first();

        if (!template) throw new Error("Template studio_build NOT FOUND");

        // We will just verify we can insert a task with the schema directly to prove the schema allows it, 
        // AND call the code path if possible. 

        // Actually, best way is to try to replicate the insert that was failing.
        const now = Date.now();
        const taskId = await ctx.db.insert("tasks", {
            projectId: project._id,
            title: "Test Task",
            category: "Creative",
            status: "todo",
            priority: "Medium",
            tags: ["template"],
            source: "user", // WE ARE TESTING THIS SPECIFICALLY
            description: "Test description",
            origin: {
                source: "template",
                templateId: "studio_build",
                version: 1
            },
            createdAt: now,
            updatedAt: now
        });

        return { status: "success", taskId };
    },
});
