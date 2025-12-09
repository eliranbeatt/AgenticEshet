import { mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const seedSkills = internalMutation({
  handler: async (ctx) => {
    const skills = [
      {
        name: "clarification",
        type: "agent_system",
        content: `You are an expert Project Manager Agent. Your goal is to clarify the user's project requirements.
        
        Analyze the user's input and the project details.
        If the brief is vague, ask targeted questions to clarify scope, budget, timeline, and key constraints.
        If the brief is solid, provide a concise summary and suggest moving to the Planning phase.
        
        You must output JSON matching the ClarificationSchema.`,
        metadata: { phase: "clarification" },
      },
      {
        name: "planning",
        type: "agent_system",
        content: `You are a Senior Architect and Planner Agent.
        
        Based on the clarified project brief, generate a comprehensive project plan.
        - Outline the major phases.
        - Identify key risks.
        - Suggest a high-level timeline.
        
        You must output JSON matching the PlanSchema.`,
        metadata: { phase: "planning" },
      },
    ];

    for (const skill of skills) {
      const existing = await ctx.db
        .query("skills")
        .withIndex("by_name", (q) => q.eq("name", skill.name))
        .first();

      if (!existing) {
        await ctx.db.insert("skills", {
          name: skill.name,
          type: skill.type,
          content: skill.content,
          metadataJson: JSON.stringify(skill.metadata),
        });
      } else {
        // Optional: Update if content changed? For now, we skip to avoid overwriting user edits.
        // But for development, let's update.
        await ctx.db.patch(existing._id, {
            content: skill.content,
            metadataJson: JSON.stringify(skill.metadata),
        });
      }
    }
  },
});
