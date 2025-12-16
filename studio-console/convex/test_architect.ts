import { internalMutation, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

export const setupAndRun = internalAction({
  args: {},
  handler: async (ctx) => {
    // 1. Create Project and Plan
    const projectId = await ctx.runMutation(internal.test_architect.createProjectAndPlan, {});
    console.log("Created project and plan:", projectId);

    // 2. Run Architect Agent
    console.log("Running architect agent...");
    try {
        await ctx.runAction(internal.agents.architect.runInBackground, { projectId });
        console.log("Architect agent finished successfully.");
    } catch (e) {
        console.error("Architect agent failed:", e);
    }
  },
});

export const createProjectAndPlan = internalMutation({
  args: {},
  handler: async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      name: "Test Project " + Date.now(),
      clientName: "Test Client",
      status: "planning",
      details: {
        notes: "This is a test project for the architect agent.",
      },
      createdAt: Date.now(),
      createdBy: "test",
    });

    await ctx.db.insert("plans", {
      projectId,
      version: 1,
      phase: "planning",
      isDraft: false,
      isActive: true,
      contentMarkdown: `
# Test Plan

## List 1: Creative
- Design the logo
- Create the website

## List 2: Logistics
- Buy materials
- Rent a van
      `,
      createdAt: Date.now(),
      createdBy: "test",
    });

    // Create some sections for accounting linking
    await ctx.db.insert("sections", {
        projectId,
        group: "Creative",
        name: "Design",
        sortOrder: 1,
        pricingMode: "estimated",
    });

    return projectId;
  },
});
