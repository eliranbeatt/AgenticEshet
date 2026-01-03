import { internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";

// --- Types ---

export type SkillDefinition = {
    skillKey: string;
    name: string;
    type: "agent_system" | "enrichment" | "agent_skill";
    content: string; // Prompt
    inputSchema?: string;
    outputSchema?: string;
    inputSchemaJson?: string;
    outputSchemaJson?: string;
    metadataJson: string;
};

export type SkillRunInput = {
    skillKey: string;
    input: any;
    projectId?: Id<"projects">; // Optional context
};

export type SkillRunResult = {
    success: boolean;
    data?: any;
    error?: string;
    usage?: { inputTokens: number; outputTokens: number };
};

// --- Actions (Simulated for Test / Placeholder) ---

// In a real implementation, this would call OpenAI/Gemini.
// For now, we'll implement a stub that can be mocked or basic logic.
export const validateInput = (schema: object, input: any) => {
    // Basic JSON schema validation stub
    // In production, use 'ajv' or similar
    if (schema && typeof schema === "object" && "required" in schema) {
        const required = (schema as any).required as string[];
        for (const field of required) {
            if (!(field in input)) {
                throw new Error(`Validation Error: Missing required field '${field}'`);
            }
        }
    }
    return true;
};

export const validateOutput = (schema: object, output: any) => {
    // Basic JSON schema validation stub
    if (schema && typeof schema === "object" && "required" in schema) {
        const required = (schema as any).required as string[];
        for (const field of required) {
            if (!(field in output)) {
                 throw new Error(`Output Validation Error: Missing required field '${field}'`);
            }
        }
    }
    return true;
};

// Helper query to fetch skill by key
export const getSkillByKey = internalQuery({
    args: { skillKey: v.string() },
    handler: async (ctx, args) => {
        const bySkillKey = await ctx.db
            .query("skills")
            .withIndex("by_skillKey", (q) => q.eq("skillKey", args.skillKey))
            .first();
        if (bySkillKey) {
            return bySkillKey;
        }
        return await ctx.db
            .query("skills")
            .withIndex("by_key", (q) => q.eq("key", args.skillKey))
            .first();
    },
});

// Main runner logic
export async function runSkillLogic(
    ctx: any, // ActionCtx
    skillDef: Doc<"skills"> | { key?: string; skillKey?: string; inputSchema?: string; outputSchema?: string; inputSchemaJson?: string; outputSchemaJson?: string }, // Loose type for mocking
    input: any
): Promise<SkillRunResult> {
    
    const inputSchemaRaw = skillDef.inputSchemaJson ?? skillDef.inputSchema ?? "{}";
    const outputSchemaRaw = skillDef.outputSchemaJson ?? skillDef.outputSchema ?? "{}";
    const skillKey = skillDef.key ?? skillDef.skillKey ?? "unknown";

    // 1. Validate Input
    validateInput(JSON.parse(inputSchemaRaw), input);

    // 2. Call LLM (Stubbed here, would import OpenAI)
    // console.log(`[Skill:${skillDef.key}] Running with input:`, JSON.stringify(input).slice(0, 100));
    
    // Mock response based on skill key for testing if not mocked externally
    let resultData = {};
    if (skillKey === "test.skill") {
        resultData = { result: 123, text: "Mock success" };
        if (input.fail) throw new Error("Mock failure");
    }

    // 3. Validate Output
    validateOutput(JSON.parse(outputSchemaRaw), resultData);

    return {
        success: true,
        data: resultData
    };
}

// Wrapper for usage in Actions/Tests
export async function runSkill(ctx: any, args: SkillRunInput) {
    const skill = await ctx.runQuery(internal.lib.skills.getSkillByKey, {
        skillKey: args.skillKey,
    });

    if (!skill) {
        throw new Error(`Skill not found: ${args.skillKey}`);
    }

    return await runSkillLogic(ctx, skill, args.input);
}
