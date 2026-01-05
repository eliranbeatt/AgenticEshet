import agentSkills from "./agentSkills.generated.json";
import type { MutationCtx } from "../_generated/server";
import { mutation } from "../_generated/server";

type AgentSkillSeed = {
    skillKey: string;
    stage: string;
    channel: string;
    allowedTools: string[];
    inputSchema: string;
    outputSchema: string;
    prompt: string;
    guidelines: string;
};

type AgentSkillsGeneratedJson = {
    globalPrompt?: string;
    categoryPrompts?: Record<string, string>;
    skills: AgentSkillSeed[];
};

const STUDIO_CONTEXT = [
    "Studio context:",
    "- We run real-world production projects (pop-ups, installations, sets, props, prints, logistics).",
    "- Favor structured, actionable outputs and short sections over long prose.",
    "- Use NIS (ILS) by default unless the project specifies otherwise.",
    "- Use studio data first (vendors, materials, rates, past purchases); label assumptions when estimating.",
    "- Never overwrite approved elements directly; propose changes as pending ChangeSets.",
    "- Keep tasks, accounting, procurement, and schedule consistent with each other.",
    "- The agent follows a gated flow: questions (0–5, only the minimum blockers), suggestions, then approval before applying changes.",
    "- Ask for missing constraints (sizes, deadlines, budget ranges, approvals) before committing to plans.",
    "- Avoid destructive edits; prefer reversible, additive changes.",
    "- Use clear stage labels (ideation/planning/solutioning/procurement/scheduling/critique/printing/trello).",
].join("\n");

function buildSkillPrompt(prompt: string, guidelines: string) {
    const blocks = [STUDIO_CONTEXT, prompt.trim()];
    if (guidelines && guidelines.trim()) {
        blocks.push("Guidelines:\n" + guidelines.trim());
    }
    return blocks.join("\n\n");
}

export async function seedAgentSkills(ctx: MutationCtx) {
    const generated = agentSkills as unknown as AgentSkillsGeneratedJson | AgentSkillSeed[];
    const skills = Array.isArray(generated) ? generated : generated.skills;

    if (!Array.isArray(skills)) {
        throw new Error("agentSkills.generated.json has unexpected shape: expected an array at .skills");
    }

    for (const skill of skills) {
        if (!skill.skillKey) continue;
        const name = skill.skillKey;
        const metadata = {
            stage: skill.stage,
            channel: skill.channel,
            allowedTools: skill.allowedTools,
        };

        const existing =
            (await ctx.db
                .query("skills")
                .withIndex("by_skillKey", (q) => q.eq("skillKey", skill.skillKey))
                .first()) ??
            (await ctx.db
                .query("skills")
                .withIndex("by_name", (q) => q.eq("name", name))
                .first());

        const content = buildSkillPrompt(skill.prompt, skill.guidelines);
        const patch = {
            name,
            skillKey: skill.skillKey,
            type: "agent_skill",
            content,
            metadataJson: JSON.stringify(metadata),
            stageTags: skill.stage ? [skill.stage] : [],
            channelTags: skill.channel ? [skill.channel] : [],
            inputSchemaJson: skill.inputSchema || "",
            outputSchemaJson: skill.outputSchema || "",
            toolPolicyJson: JSON.stringify({ allowedTools: skill.allowedTools }),
            enabled: true,
            version: 1,
        } as const;

        if (!existing) {
            await ctx.db.insert("skills", patch);
        } else {
            await ctx.db.patch(existing._id, patch);
        }
    }
}

export const seedAgentSkillsPublic = mutation({
    handler: async (ctx) => {
        await seedAgentSkills(ctx);
    },
});
