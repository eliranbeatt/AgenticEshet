import { v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { generateImageBase64Png } from "./lib/openaiImages";
import { generateImageBase64WithGemini } from "./lib/geminiImages";

type EntityType = "materialLine" | "projectItem" | "task" | "quote";

export const generateUploadUrl = mutation({
    args: {},
    handler: async (ctx) => {
        return await ctx.storage.generateUploadUrl();
    },
});

export const createAssetFromUpload = mutation({
    args: {
        projectId: v.id("projects"),
        storageId: v.string(),
        mimeType: v.string(),
        filename: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const assetId = await ctx.db.insert("projectAssets", {
            projectId: args.projectId,
            kind: "image",
            storageId: args.storageId,
            mimeType: args.mimeType,
            filename: args.filename,
            source: "upload",
            createdAt: Date.now(),
            createdBy: "user",
        });

        const url = await ctx.storage.getUrl(args.storageId);
        return { assetId, url };
    },
});

export const getAssetUrl = query({
    args: { assetId: v.id("projectAssets") },
    handler: async (ctx, args) => {
        const asset = await ctx.db.get(args.assetId);
        if (!asset) return null;
        return await ctx.storage.getUrl(asset.storageId);
    },
});

export const listProjectAssets = query({
    args: { projectId: v.id("projects"), kind: v.optional(v.literal("image")) },
    handler: async (ctx, args) => {
        const assets = await ctx.db
            .query("projectAssets")
            .withIndex("by_project_createdAt", (q) => q.eq("projectId", args.projectId))
            .order("desc")
            .collect();

        const filtered = args.kind ? assets.filter((a) => a.kind === args.kind) : assets;

        return await Promise.all(
            filtered.map(async (asset) => ({
                ...asset,
                url: await ctx.storage.getUrl(asset.storageId),
            }))
        );
    },
});

export const listEntityAssets = query({
    args: {
        projectId: v.id("projects"),
        entityType: v.union(v.literal("materialLine"), v.literal("projectItem"), v.literal("task"), v.literal("quote")),
        entityId: v.string(),
    },
    handler: async (ctx, args) => {
        const links = await ctx.db
            .query("assetLinks")
            .withIndex("by_project_entity", (q) =>
                q.eq("projectId", args.projectId).eq("entityType", args.entityType).eq("entityId", args.entityId)
            )
            .collect();

        const assets = await Promise.all(links.map((l) => ctx.db.get(l.assetId)));
        const entries = assets.filter(Boolean);

        return await Promise.all(
            entries.map(async (asset) => ({
                ...asset,
                url: await ctx.storage.getUrl(asset.storageId),
            }))
        );
    },
});

export const linkAsset = mutation({
    args: {
        projectId: v.id("projects"),
        assetId: v.id("projectAssets"),
        entityType: v.union(v.literal("materialLine"), v.literal("projectItem"), v.literal("task"), v.literal("quote")),
        entityId: v.string(),
        role: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const existing =
            (await ctx.db
                .query("assetLinks")
                .withIndex("by_project_asset_entity", (q) =>
                    q.eq("projectId", args.projectId)
                        .eq("assetId", args.assetId)
                        .eq("entityType", args.entityType)
                        .eq("entityId", args.entityId)
                )
                .first()) ?? null;

        if (existing) return { linkId: existing._id };

        const linkId = await ctx.db.insert("assetLinks", {
            projectId: args.projectId,
            assetId: args.assetId,
            entityType: args.entityType,
            entityId: args.entityId,
            role: args.role,
            createdAt: Date.now(),
            createdBy: "user",
        });

        return { linkId };
    },
});

export const unlinkAsset = mutation({
    args: {
        projectId: v.id("projects"),
        assetId: v.id("projectAssets"),
        entityType: v.union(v.literal("materialLine"), v.literal("projectItem"), v.literal("task"), v.literal("quote")),
        entityId: v.string(),
    },
    handler: async (ctx, args) => {
        const link =
            (await ctx.db
                .query("assetLinks")
                .withIndex("by_project_asset_entity", (q) =>
                    q.eq("projectId", args.projectId)
                        .eq("assetId", args.assetId)
                        .eq("entityType", args.entityType)
                        .eq("entityId", args.entityId)
                )
                .first()) ?? null;

        if (!link) return { ok: true };
        await ctx.db.delete(link._id);
        return { ok: true };
    },
});

export const linkAssetInternal = internalMutation({
    args: {
        projectId: v.id("projects"),
        assetId: v.id("projectAssets"),
        entityType: v.union(v.literal("materialLine"), v.literal("projectItem"), v.literal("task"), v.literal("quote")),
        entityId: v.string(),
        role: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const existing =
            (await ctx.db
                .query("assetLinks")
                .withIndex("by_project_asset_entity", (q) =>
                    q.eq("projectId", args.projectId)
                        .eq("assetId", args.assetId)
                        .eq("entityType", args.entityType)
                        .eq("entityId", args.entityId)
                )
                .first()) ?? null;

        if (existing) return { linkId: existing._id };

        const linkId = await ctx.db.insert("assetLinks", {
            projectId: args.projectId,
            assetId: args.assetId,
            entityType: args.entityType,
            entityId: args.entityId,
            role: args.role,
            createdAt: Date.now(),
            createdBy: "user",
        });

        return { linkId };
    },
});

export const createGeneratedImageAsset = internalMutation({
    args: {
        projectId: v.id("projects"),
        storageId: v.string(),
        mimeType: v.string(),
        prompt: v.string(),
        provider: v.string(),
        model: v.string(),
        width: v.optional(v.number()),
        height: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("projectAssets", {
            projectId: args.projectId,
            kind: "image",
            storageId: args.storageId,
            mimeType: args.mimeType,
            filename: "generated.png",
            source: "generated",
            prompt: args.prompt,
            provider: args.provider,
            model: args.model,
            width: args.width,
            height: args.height,
            createdAt: Date.now(),
            createdBy: "agent",
        });
    },
});

export const generateImage = action({
    args: {
        projectId: v.id("projects"),
        prompt: v.string(),
        size: v.optional(v.union(v.literal("1024x1024"), v.literal("1024x1536"), v.literal("1536x1024"))),
        linkTo: v.optional(
            v.object({
                entityType: v.union(v.literal("materialLine"), v.literal("projectItem"), v.literal("task"), v.literal("quote")),
                entityId: v.string(),
                role: v.optional(v.string()),
            })
        ),
    },
    handler: async (ctx, args) => {
        await ctx.runMutation(internal.rateLimit.consume, {
            key: `image:${args.projectId}`,
            limit: 8,
            windowMs: 60_000,
        });

        const settings = await ctx.runQuery(internal.settings.getAll);

        const provider = settings.imageProvider ?? "openai";
        const desiredSize = args.size ?? "1024x1024";

        let base64: string;
        let mimeType: string;
        let model: string;

        if (provider === "gemini") {
            const result = await generateImageBase64WithGemini({
                prompt: args.prompt,
                model: settings.geminiImageModel || "imagen-3.0-generate-002",
                sampleCount: 1,
            });
            base64 = result.base64;
            mimeType = result.mimeType || "image/png";
            model = result.model;
        } else {
            const result = await generateImageBase64Png({
                prompt: args.prompt,
                model: settings.openaiImageModel || "gpt-image-1",
                size: desiredSize,
            });
            base64 = result.base64Png;
            mimeType = "image/png";
            model = result.model;
        }

        const binary = atob(base64);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        const blob = new Blob([bytes], { type: mimeType });
        const storageId = await ctx.storage.store(blob);

        const assetId = await ctx.runMutation(internal.assets.createGeneratedImageAsset, {
            projectId: args.projectId,
            storageId,
            mimeType,
            prompt: args.prompt,
            provider,
            model,
            width: desiredSize === "1536x1024" ? 1536 : 1024,
            height: desiredSize === "1024x1536" ? 1536 : 1024,
        });

        if (args.linkTo) {
            await ctx.runMutation(internal.assets.linkAssetInternal, {
                projectId: args.projectId,
                assetId,
                entityType: args.linkTo.entityType as EntityType,
                entityId: args.linkTo.entityId,
                role: args.linkTo.role,
            });
        }

        const url = await ctx.storage.getUrl(storageId);
        return { assetId, storageId, url };
    },
});
