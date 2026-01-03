import { internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { callChatWithJsonSchema } from "./openai";

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

export const validateInput = (schema: object, input: any) => {
    // Basic JSON schema validation stub
    // In production, use 'ajv' or similar if strict validation is needed pre-flight.
    if (schema && typeof schema === "object" && "required" in schema) {
        const required = (schema as any).required as string[];
        if (Array.isArray(required)) {
            for (const field of required) {
                if (!(field in input)) {
                    // console.warn(`Validation Warning: Missing required input field '${field}'`);
                }
            }
        }
    }
    return true;
};

export const validateOutput = (schema: object, output: any) => {
    // Basic JSON schema validation stub
    if (schema && typeof schema === "object" && "required" in schema) {
        const required = (schema as any).required as string[];
        if (Array.isArray(required)) {
            for (const field of required) {
                if (!(field in output)) {
                     throw new Error(`Output Validation Error: Missing required field '${field}'`);
                }
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
    skillDef: Doc<"skills"> | { key?: string; skillKey?: string; content?: string; inputSchema?: string; outputSchema?: string; inputSchemaJson?: string; outputSchemaJson?: string }, 
    input: any
): Promise<SkillRunResult> {
    
    const inputSchemaRaw = skillDef.inputSchemaJson || skillDef.inputSchema || "{}";
    const outputSchemaRaw = skillDef.outputSchemaJson || skillDef.outputSchema || "{}";
    const skillKey = skillDef.key ?? skillDef.skillKey ?? "unknown";

    // 1. Validate Input
    try {
        const inputSchema = JSON.parse(inputSchemaRaw);
        validateInput(inputSchema, input);
    } catch (e) {
        console.warn(`[Skill:${skillKey}] Input schema validation warning:`, e);
    }

    // 2. Call LLM
    try {
        const outputSchema = JSON.parse(outputSchemaRaw);
        const promptContent = skillDef.content || "You are a helpful assistant.";
        const fullPrompt = `${promptContent}\n\nRESPONSE FORMAT INSTRUCTIONS:\nYou must output a valid JSON object.\nThe object must strictly follow this JSON Schema structure:\n\`\`\`json\n${JSON.stringify(outputSchema, null, 2)}\n\`\`\`\nDo not include the schema keys (like "properties", "type", "required") in your output unless they are part of the data. Output only the instance data.`;

        console.log(`[Skill:${skillKey}] Invoking LLM...`);
        
        const resultData = await callChatWithJsonSchema(outputSchema, {
            systemPrompt: fullPrompt,
            userPrompt: JSON.stringify(input, null, 2),
            model: "gpt-4o", // Default to a strong model for skills
            temperature: 0.2, // Low temp for deterministic skills
        });

        console.log(`[Skill:${skillKey}] Raw LLM Output:`, JSON.stringify(resultData, null, 2));

        // 3. Validate Output
        try {
             validateOutput(outputSchema, resultData);
        } catch (e: any) {
             throw new Error(`${e.message}. Received Data: ${JSON.stringify(resultData)}`);
        }

        return {
            success: true,
            data: resultData
        };
    } catch (err: any) {
        console.error(`[Skill:${skillKey}] Execution Failed:`, err);
        return {
            success: false,
            error: err.message || "Unknown error during skill execution"
        };
    }
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
