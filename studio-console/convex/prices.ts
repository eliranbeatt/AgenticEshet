import { v } from "convex/values";
import { mutation, query, internalMutation, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";

// --- Helpers ---

function calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function internalIngestPurchase(ctx: MutationCtx, purchaseId: Id<"purchases">) {
    const purchase = await ctx.db.get(purchaseId);
    if (!purchase) return;

    // 1. Normalize Item Name
    const rawNormalized = purchase.itemName.trim().toLowerCase();
    let canonicalItemId: Id<"canonicalItems">;

    const existingMap = await ctx.db
        .query("itemNormalizationMap")
        .withIndex("by_raw", (q) => q.eq("raw", rawNormalized))
        .first();

    if (existingMap) {
        canonicalItemId = existingMap.canonicalItemId;
    } else {
        canonicalItemId = await ctx.db.insert("canonicalItems", {
            name: purchase.itemName.trim(),
            tags: purchase.tags || [],
            defaultUnit: purchase.unit || "unit", 
            synonyms: [rawNormalized],
        });
        await ctx.db.insert("itemNormalizationMap", {
            raw: rawNormalized,
            canonicalItemId,
            confidence: 1.0,
            updatedAt: Date.now(),
        });
    }

    // 2. Create Observation
    const quantity = purchase.quantity || 1;
    const unitPrice = purchase.amount / quantity;

    await ctx.db.insert("priceObservations", {
        canonicalItemId,
        rawItemName: purchase.itemName,
        vendorId: purchase.vendorId,
        unit: purchase.unit || "unit",
        unitPrice,
        currency: purchase.currency || "ILS",
        source: "purchase",
        sourceRef: {
            type: "purchaseId",
            id: purchase._id,
        },
        projectId: purchase.projectId,
        observedAt: purchase.purchasedAt || purchase.createdAt,
        notes: purchase.description,
    });
}

// --- Mutations ---

/**
 * Normalizes a raw item name to a canonical item ID.
 * Currently uses a deterministic exact match or creates a new one.
 * Future: Use LLM or fuzzy matching.
 */
export const normalizeItemName = mutation({
    args: { raw: v.string() },
    handler: async (ctx, args) => {
        const rawNormalized = args.raw.trim().toLowerCase();

        // 1. Check cache
        const existingMap = await ctx.db
            .query("itemNormalizationMap")
            .withIndex("by_raw", (q) => q.eq("raw", rawNormalized))
            .first();

        if (existingMap) {
            return existingMap.canonicalItemId;
        }

        // 2. Check if a canonical item exists with this name (case-insensitive check via search would be better, but for now exact)
        
        const newCanonicalId = await ctx.db.insert("canonicalItems", {
            name: args.raw.trim(), // Keep original casing for display
            tags: [],
            defaultUnit: "unit", // Default, can be updated later
            synonyms: [rawNormalized],
        });

        // 3. Save mapping
        await ctx.db.insert("itemNormalizationMap", {
            raw: rawNormalized,
            canonicalItemId: newCanonicalId,
            confidence: 1.0, // Manual/Deterministic creation
            updatedAt: Date.now(),
        });

        return newCanonicalId;
    },
});

/**
 * Ingests a purchase into the price memory.
 * Should be called after a purchase is created or updated.
 */
export const ingestFromPurchase = mutation({
    args: { purchaseId: v.id("purchases") },
    handler: async (ctx, args) => {
        await internalIngestPurchase(ctx, args.purchaseId);
    },
});

export const addManualObservation = mutation({
    args: {
        rawItemName: v.string(),
        vendorId: v.optional(v.id("vendors")),
        unit: v.string(),
        unitPrice: v.number(),
        currency: v.string(),
        leadTimeDays: v.optional(v.number()),
        locationTag: v.optional(v.string()),
        notes: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        // 1. Normalize
        const rawNormalized = args.rawItemName.trim().toLowerCase();
        let canonicalItemId: Id<"canonicalItems">;

        const existingMap = await ctx.db
            .query("itemNormalizationMap")
            .withIndex("by_raw", (q) => q.eq("raw", rawNormalized))
            .first();

        if (existingMap) {
            canonicalItemId = existingMap.canonicalItemId;
        } else {
            canonicalItemId = await ctx.db.insert("canonicalItems", {
                name: args.rawItemName.trim(),
                tags: [],
                defaultUnit: args.unit,
                synonyms: [rawNormalized],
            });
            await ctx.db.insert("itemNormalizationMap", {
                raw: rawNormalized,
                canonicalItemId,
                confidence: 1.0,
                updatedAt: Date.now(),
            });
        }

        // 2. Insert
        await ctx.db.insert("priceObservations", {
            canonicalItemId,
            rawItemName: args.rawItemName,
            vendorId: args.vendorId,
            unit: args.unit,
            unitPrice: args.unitPrice,
            currency: args.currency,
            leadTimeDays: args.leadTimeDays,
            locationTag: args.locationTag,
            source: "manual",
            sourceRef: {
                type: "manual",
                id: "user", // or userId if available
            },
            observedAt: Date.now(),
            notes: args.notes,
        });
    },
});

// --- Queries ---

export const getHistory = query({
    args: {
        canonicalItemId: v.optional(v.id("canonicalItems")),
        rawItemName: v.optional(v.string()), // Optional: lookup by raw name
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        let canonicalItemId = args.canonicalItemId;

        if (!canonicalItemId && args.rawItemName) {
             const existingMap = await ctx.db
                .query("itemNormalizationMap")
                .withIndex("by_raw", (q) => q.eq("raw", args.rawItemName!.trim().toLowerCase()))
                .first();
            if (existingMap) canonicalItemId = existingMap.canonicalItemId;
        }

        if (!canonicalItemId) return [];

        const observations = await ctx.db
            .query("priceObservations")
            .withIndex("by_canonicalItem_observedAt", (q) => q.eq("canonicalItemId", canonicalItemId!))
            .order("desc")
            .take(args.limit || 20);

        // Enrich with vendor names
        const enriched = await Promise.all(observations.map(async (obs) => {
            let vendorName = "Unknown";
            if (obs.vendorId) {
                const vendor = await ctx.db.get(obs.vendorId);
                if (vendor) vendorName = vendor.name;
            }
            return { ...obs, vendorName };
        }));

        return enriched;
    },
});

export const listLatestObservations = query({
    args: {
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const observations = await ctx.db
            .query("priceObservations")
            .order("desc")
            .take(args.limit ?? 50);

        const enriched = await Promise.all(
            observations.map(async (obs) => {
                let vendorName = "Unknown";
                if (obs.vendorId) {
                    const vendor = await ctx.db.get(obs.vendorId);
                    if (vendor) vendorName = vendor.name;
                }
                return { ...obs, vendorName };
            })
        );

        return enriched;
    },
});

export const getBestEstimate = query({
    args: {
        canonicalItemId: v.id("canonicalItems"),
        locationTag: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const observations = await ctx.db
            .query("priceObservations")
            .withIndex("by_canonicalItem_observedAt", (q) => q.eq("canonicalItemId", args.canonicalItemId))
            .order("desc")
            .take(50); // Take last 50 for stats

        if (observations.length === 0) return null;

        const prices = observations.map(o => o.unitPrice);
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const median = calculateMedian(prices);

        return {
            range: { min, max },
            median,
            confidence: observations.length > 5 ? "high" : "low",
            lastSeenAt: observations[0].observedAt,
            sampleSize: observations.length,
            unit: observations[0].unit, // Assuming mostly consistent units for now
        };
    },
});
