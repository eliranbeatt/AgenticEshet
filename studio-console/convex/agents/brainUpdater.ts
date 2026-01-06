import { action } from "../_generated/server";
import { internal, api } from "../_generated/api";
import { v } from "convex/values";
import { callChatWithSchema } from "../lib/openai";
import { BrainUpdaterOutputSchema } from "../lib/zodSchemas";

export const run = action({
    args: {
        projectId: v.id("projects"),
        brainEventId: v.id("brainEvents"),
        attempt: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const attempt = args.attempt ?? 0;

        try {
            const event = await ctx.runQuery(internal.brainEvents.get, { eventId: args.brainEventId });
            if (!event) throw new Error("BrainEvent not found");

            let brain = await ctx.runQuery(api.projectBrain.getCurrent, { projectId: args.projectId });
            if (!brain) {
                await ctx.runMutation(internal.projectBrain.ensure, { projectId: args.projectId });
                brain = await ctx.runQuery(api.projectBrain.getCurrent, { projectId: args.projectId });
            }

            const itemRefs = await ctx.runQuery(internal.items.getItemRefs, { projectId: args.projectId });

            const systemPrompt = `
You are the Project Brain updater.
You must output strict JSON that matches the schema.
Rules:
- Brain is a digest, not a transcript.
- Only add bullets, conflicts, and a recent update line. Do not edit existing bullets.
- If unsure about element mapping, use unmapped with confidence=low.
- Do NOT modify approved element truth (not stored here).
- Add exactly one add_recent_update op per event.
- If you add a conflict, include bulletAId/bulletBId that match existing Brain bullet IDs when possible.
- Schema Clarification:
  - use op="add_bullet" for ALL new information strings (project or element).
  - for project scope, use "section" (overview, preferences, etc). Do NOT use "path".
  - for element scope, use target.scope="element" and target.elementId.
  - Do NOT invent new ops like "add_element_note".
`.trim();

            const userPrompt = `
EVENT TYPE: ${event.eventType}
EVENT PAYLOAD:
${JSON.stringify(event.payload, null, 2)}

PROJECT BRAIN (current):
${JSON.stringify({
                project: brain?.project ?? {},
                elementNotes: brain?.elementNotes ?? {},
                unmapped: brain?.unmapped ?? [],
                conflicts: brain?.conflicts ?? [],
                recentUpdates: (brain?.recentUpdates ?? []).slice(-5),
            }, null, 2)}

KNOWN ELEMENTS:
${itemRefs.map((item) => `- ${item.name} (ID: ${item.id})`).join("\n") || "(none)"}

TASK:
- Extract new facts/preferences/constraints/timeline/stakeholders and add them to the correct section.
- Add element-specific notes to element scope (using op="add_bullet", scope="element") when a known element matches.
- Add conflicts if the new info contradicts existing bullets.
- Add one recent update line summarizing what changed.
`.trim();

            const result = await callChatWithSchema(BrainUpdaterOutputSchema, {
                systemPrompt,
                userPrompt,
                model: "gpt-4o"
            });

            await ctx.runMutation(internal.brainRuns.create, {
                projectId: args.projectId,
                eventId: args.brainEventId,
                model: "default",
                outputJson: JSON.stringify(result),
                runSummary: result.runSummary,
                status: "completed",
            });

            const applyResult = await ctx.runMutation(internal.brainEvents.apply, {
                eventId: args.brainEventId,
                patchOps: result.patchOps,
                runSummary: result.runSummary,
            });

            if (applyResult.status === "conflict_retry") {
                if (attempt < 2) {
                    await ctx.runMutation(internal.brainEvents.resetForRetry, { eventId: args.brainEventId });
                    await ctx.scheduler.runAfter(0, api.agents.brainUpdater.run, {
                        projectId: args.projectId,
                        brainEventId: args.brainEventId,
                        attempt: attempt + 1,
                    });
                    return { ok: false, summary: "Brain update queued for retry" };
                }
            }

            return { ok: true, summary: result.runSummary };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await ctx.runMutation(internal.brainRuns.create, {
                projectId: args.projectId,
                eventId: args.brainEventId,
                model: "default",
                status: "failed",
                error: message,
            });

            const event = await ctx.runQuery(internal.brainEvents.get, { eventId: args.brainEventId });
            const fallbackText = JSON.stringify(event?.payload ?? {}, null, 2).slice(0, 800);
            const patchOps = [
                {
                    op: "add_bullet",
                    target: { scope: "unmapped" },
                    bullet: {
                        text: fallbackText || "Fallback brain update",
                        status: "proposed",
                        confidence: "low",
                        tags: ["fallback"],
                    },
                },
                {
                    op: "add_recent_update",
                    text: `Fallback update applied after error: ${message}`,
                },
            ];

            await ctx.runMutation(internal.brainEvents.apply, {
                eventId: args.brainEventId,
                patchOps,
                runSummary: "Fallback brain update applied",
            });

            return { ok: false, summary: "Fallback update applied" };
        }
    },
});
