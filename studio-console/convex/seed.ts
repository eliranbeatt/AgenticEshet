import { mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";

// Public mutation for UI button access
export const seedSkillsPublic = mutation({
  handler: async (ctx) => {
    // Re-use logic or call internal? Calling internal is safer if possible, 
    // but here we just duplicate logic or we can simply export as mutation directly.
    // For simplicity, let's just copy the logic here or make the original one public.
    // Making original public:
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
      {
        name: "architect",
        type: "agent_system",
        content: `You are a Technical Lead and Task Manager.
        
        Your input is a high-level project plan.
        Your goal is to decompose this plan into specific, actionable tasks for the team.
        
        - Create 5-15 tasks depending on complexity.
        - Ensure mix of categories (Logistics, Creative, etc.).
        - Assign priorities sensibly.
        
        You must output JSON matching the TaskBreakdownSchema.`,
        metadata: { phase: "execution" },
      },
      {
        name: "quote",
        type: "agent_system",
        content: `You are a Professional Cost Estimator for Creative Projects.
        
        Based on the provided Project Details and List of Tasks/Requirements:
        1. Estimate the costs for resources, labor, and materials.
        2. Respect the Budget Cap if one exists; if the estimation exceeds it, add a note explaining why.
        3. Generate a formal client-facing document text.
        
        - Currency: ILS (unless specified otherwise).
        - Be realistic but conservative.
        
        You must output JSON matching the QuoteSchema.`,
        metadata: { phase: "quote" },
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
