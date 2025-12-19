import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type ImageProvider = "openai" | "gemini";
export type ModelConfig = Record<string, string>;

const SETTINGS_KEYS = {
    imageProvider: "image_provider",
    openaiImageModel: "openai_image_model",
    geminiImageModel: "gemini_image_model",
    brandingLogoStorageId: "branding_logo_storage_id",
    quoteFooterHebrew: "quote_footer_hebrew",
    modelConfig: "model_config",
} as const;

function safeParseJson<T>(valueJson: string | undefined, fallback: T): T {
    if (!valueJson) return fallback;
    try {
        return JSON.parse(valueJson) as T;
    } catch {
        return fallback;
    }
}

async function getSetting(ctx: QueryCtx | MutationCtx, key: string) {
    return await ctx.db
        .query("settings")
        .withIndex("by_key", (q) => q.eq("key", key))
        .first();
}

async function upsertSetting(ctx: MutationCtx, key: string, value: unknown) {
    const existing = await getSetting(ctx, key);
    const valueJson = JSON.stringify(value);
    if (existing) {
        await ctx.db.patch(existing._id, { valueJson });
        return;
    }
    await ctx.db.insert("settings", { key, valueJson });
}

export const getAll = query({
    args: {},
    handler: async (ctx) => {
        const imageProvider = safeParseJson<ImageProvider>(
            (await getSetting(ctx, SETTINGS_KEYS.imageProvider))?.valueJson,
            "openai"
        );
        const openaiImageModel = safeParseJson<string>(
            (await getSetting(ctx, SETTINGS_KEYS.openaiImageModel))?.valueJson,
            "gpt-image-1"
        );
        const geminiImageModel = safeParseJson<string>(
            (await getSetting(ctx, SETTINGS_KEYS.geminiImageModel))?.valueJson,
            "imagen-3.0-generate-002"
        );
        const brandingLogoStorageId = safeParseJson<string | null>(
            (await getSetting(ctx, SETTINGS_KEYS.brandingLogoStorageId))?.valueJson,
            null
        );
        const quoteFooterHebrew = safeParseJson<string>(
            (await getSetting(ctx, SETTINGS_KEYS.quoteFooterHebrew))?.valueJson,
            ""
        );
        const modelConfig = safeParseJson<ModelConfig>(
            (await getSetting(ctx, SETTINGS_KEYS.modelConfig))?.valueJson,
            {}
        );

        const brandingLogoUrl = brandingLogoStorageId ? await ctx.storage.getUrl(brandingLogoStorageId) : null;

        return {
            imageProvider,
            openaiImageModel,
            geminiImageModel,
            brandingLogoStorageId,
            brandingLogoUrl,
            quoteFooterHebrew,
            modelConfig,
        };
    },
});

export const setMany = mutation({
    args: {
        imageProvider: v.optional(v.union(v.literal("openai"), v.literal("gemini"))),
        openaiImageModel: v.optional(v.string()),
        geminiImageModel: v.optional(v.string()),
        brandingLogoStorageId: v.optional(v.union(v.string(), v.null())),
        quoteFooterHebrew: v.optional(v.string()),
        modelConfig: v.optional(v.string()), // JSON string for ModelConfig
    },
    handler: async (ctx, args) => {
        const entries = [
            args.imageProvider !== undefined ? [SETTINGS_KEYS.imageProvider, args.imageProvider] : null,
            args.openaiImageModel !== undefined ? [SETTINGS_KEYS.openaiImageModel, args.openaiImageModel] : null,
            args.geminiImageModel !== undefined ? [SETTINGS_KEYS.geminiImageModel, args.geminiImageModel] : null,
            args.brandingLogoStorageId !== undefined
                ? [SETTINGS_KEYS.brandingLogoStorageId, args.brandingLogoStorageId]
                : null,
            args.quoteFooterHebrew !== undefined ? [SETTINGS_KEYS.quoteFooterHebrew, args.quoteFooterHebrew] : null,
            args.modelConfig !== undefined ? [SETTINGS_KEYS.modelConfig, JSON.parse(args.modelConfig)] : null,
        ].filter(Boolean) as Array<[string, unknown]>;

        for (const [key, value] of entries) {
            await upsertSetting(ctx, key, value);
        }
    },
});
