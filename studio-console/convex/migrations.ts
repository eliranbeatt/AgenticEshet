import { mutation } from "./_generated/server";

export const assignTaskNumbers = mutation({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.db.query("projects").collect();
    let totalUpdated = 0;

    for (const project of projects) {
      const tasks = await ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .collect();

      // Sort by creation time to keep numbering consistent with history
      tasks.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

      let counter = 1;
      for (const task of tasks) {
        if (task.taskNumber !== counter) {
          await ctx.db.patch(task._id, { taskNumber: counter });
          totalUpdated++;
        }
        counter++;
      }
    }
    return `Updated ${totalUpdated} tasks with numbers.`;
  },
});
