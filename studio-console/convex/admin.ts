import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const listSkills = query({
    args: {},
    handler: async (ctx) => {
        return await ctx.db.query("skills").collect();
    },
});

export const saveSkill = mutation({
    args: {
        skillId: v.optional(v.id("skills")),
        name: v.string(),
        type: v.string(),
        content: v.string(),
        metadataJson: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const { skillId, metadataJson, ...rest } = args;
        const data = { ...rest, metadataJson: metadataJson ?? "{}" };
        if (skillId) {
            await ctx.db.patch(skillId, data);
            return skillId;
        }
        return await ctx.db.insert("skills", data);
    },
});

export const deleteSkill = mutation({
    args: { skillId: v.id("skills") },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.skillId);
    },
});

export const listEnrichmentProfiles = query({
    args: {},
    handler: async (ctx) => {
        return await ctx.db.query("enrichmentProfiles").collect();
    },
});

export const saveEnrichmentProfile = mutation({
    args: {
        profileId: v.optional(v.id("enrichmentProfiles")),
        name: v.string(),
        description: v.string(),
        llmModel: v.string(),
        useWebSearch: v.boolean(),
        useCodeInterpreter: v.boolean(),
        systemPrompt: v.string(),
        schemaJson: v.string(),
    },
    handler: async (ctx, args) => {
        const { profileId, ...data } = args;
        if (profileId) {
            await ctx.db.patch(profileId, data);
            return profileId;
        }
        return await ctx.db.insert("enrichmentProfiles", data);
    },
});

export const deleteEnrichmentProfile = mutation({
    args: { profileId: v.id("enrichmentProfiles") },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.profileId);
    },
});
