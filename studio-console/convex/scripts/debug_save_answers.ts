
import { api, internal } from "../_generated/api";
import { action } from "../_generated/server";

export const test = action({
    args: {},
    handler: async (ctx) => {
        // 1. Get Project
        const projects = await ctx.runQuery(api.projects.listProjects, {});
        const project = projects[0];
        console.log(`Project: ${project.name}`);

        // 2. Get Active Planning Session
        const session = await ctx.runQuery(api.structuredQuestions.getActiveSession, {
            projectId: project._id,
            stage: "planning"
        });

        if (!session) {
            console.log("No active planning session.");
            return;
        }
        console.log(`Session: ${session._id}`);

        // 3. Get Turns
        const turns = await ctx.runQuery(api.structuredQuestions.listTurns, { sessionId: session._id });
        if (turns.length === 0) {
            console.log("No turns.");
            return;
        }
        const turn = turns[turns.length - 1]; // Latest
        console.log(`Turn: ${turn.turnNumber}, Questions: ${turn.questions.length}`);

        // 4. Construct Answers
        // Assuming questions have 'id'
        const answers = turn.questions.map((q: any) => ({
            questionId: q.id,
            quick: "yes",
            text: "Test answer for debugging"
        }));

        console.log("Submitting answers:", JSON.stringify(answers, null, 2));

        // 5. Call saveAnswers
        await ctx.runMutation(api.structuredQuestions.saveAnswers, {
            sessionId: session._id,
            turnNumber: turn.turnNumber,
            answers: answers,
            userInstructions: "Debug run instructions"
        });
        console.log("Answers saved.");

        // 6. Check Memory directly (wait a bit for consistency if needed, but mutation is consistent)
        const memory = await ctx.runQuery(api.memory.getRunningMemoryMarkdown, {
            projectId: project._id,
        });
        console.log("Memory Check:");
        console.log(memory);

        // 7. Check if TurnBundle was created
        const bundles = await ctx.runQuery(internal.turnBundles.listByProject, { projectId: project._id, limit: 1 });
        console.log(`Bundles found: ${bundles.length}`);
        if (bundles.length > 0) {
            console.log("Latest Bundle Text:", bundles[0].bundleText);
        }
    },
});
