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
        skillKey: v.optional(v.string()),
        description: v.optional(v.string()),
        stageTags: v.optional(v.array(v.string())),
        channelTags: v.optional(v.array(v.string())),
        inputSchemaJson: v.optional(v.string()),
        outputSchemaJson: v.optional(v.string()),
        toolPolicyJson: v.optional(v.string()),
        enabled: v.optional(v.boolean()),
        version: v.optional(v.number()),
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

// --- Templates Management ---

export const listTemplates = query({
    args: {},
    handler: async (ctx) => {
        return await ctx.db.query("templateDefinitions").order("desc").collect();
    },
});

export const saveTemplate = mutation({
    args: {
        id: v.optional(v.id("templateDefinitions")),
        templateId: v.string(),
        version: v.number(),
        name: v.string(),
        appliesToKind: v.union(v.literal("deliverable"), v.literal("day"), v.literal("service")),
        fields: v.array(v.object({
            key: v.string(),
            label: v.string(),
            type: v.union(v.literal("text"), v.literal("number"), v.literal("boolean")),
            required: v.boolean(),
            default: v.optional(v.any()),
        })),
        tasks: v.array(v.object({
            title: v.string(),
            category: v.string(),
            role: v.string(),
            effortDays: v.number(),
            condition: v.optional(v.object({ field: v.string(), equals: v.any() })),
        })),
        materials: v.array(v.object({
            name: v.string(),
            spec: v.optional(v.string()),
            qty: v.optional(v.number()),
            unit: v.optional(v.string()),
            defaultVendorRole: v.optional(v.string())
        })),
        companionRules: v.optional(v.array(v.object({
            type: v.union(v.literal("suggestItem"), v.literal("autoAddItem")),
            templateId: v.string(),
            when: v.string()
        }))),
        quotePattern: v.optional(v.string()),
        status: v.union(v.literal("draft"), v.literal("published")),
    },
    handler: async (ctx, args) => {
        const { id, ...data } = args;
        const now = Date.now();
        if (id) {
            await ctx.db.patch(id, data);
            return id;
        }
        return await ctx.db.insert("templateDefinitions", { ...data, createdAt: now });
    },
});

export const deleteTemplate = mutation({
    args: { id: v.id("templateDefinitions") },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.id);
    },
});

// --- Roles Management ---

export const listRoles = query({
    args: {},
    handler: async (ctx) => {
        return await ctx.db.query("roleCatalog").collect();
    },
});

export const saveRole = mutation({
    args: {
        id: v.optional(v.id("roleCatalog")),
        roleName: v.string(),
        defaultRatePerDay: v.number(),
        isInternalRole: v.boolean(),
        isVendorRole: v.boolean(),
    },
    handler: async (ctx, args) => {
        const { id, ...data } = args;
        if (id) {
            await ctx.db.patch(id, data);
            return id;
        }
        return await ctx.db.insert("roleCatalog", data);
    },
});

export const deleteRole = mutation({
    args: { id: v.id("roleCatalog") },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.id);
    },
});

