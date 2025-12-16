import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";

type MutationRunner = (ref: unknown, args: unknown) => Promise<unknown>;
type QueryRunner = (ref: unknown, args: unknown) => Promise<unknown>;
type Scheduler = { runAfter: (ms: number, ref: unknown, args: unknown) => Promise<unknown> };

type ActionCtx = {
    runQuery: QueryRunner;
    runMutation: MutationRunner;
    scheduler: Scheduler;
};

export async function queueTaskGeneration(ctx: ActionCtx, projectId: Id<"projects">) {
    const { latestPlan } = await ctx.runQuery(internal.agents.architect.getContext, {
        projectId,
    }) as { latestPlan: unknown };

    if (!latestPlan) {
        throw new Error("No active plan found. Approve a plan before generating tasks.");
    }

    const agentRunId = await ctx.runMutation(internal.agentRuns.createRun, {
        projectId,
        agent: "architect",
        stage: "queued",
        initialMessage: "Queued task generation.",
    }) as string;

    await ctx.scheduler.runAfter(0, internal.agents.architect.runInBackground, {
        projectId,
        agentRunId,
    });

    return { queued: true, runId: agentRunId };
}
