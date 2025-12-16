import { v } from "convex/values";
import { action, query, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

// --- Helpers ---

function calculateStats(prices: number[]) {
    if (prices.length === 0) return { min: 0, max: 0, median: 0 };
    const sorted = [...prices].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    return { min, max, median };
}

// --- Actions ---

export const generateSuggestions = action({
    args: { materialLineId: v.id("materialLines") },
    handler: async (ctx, args) => {
        // 1. Get Material Line
        // We need to query the DB. Since this is an action, we can't query directly.
        // We need a helper query or pass data.
        // Let's use a helper query to get the material line and its context.
        
        const materialLine = await ctx.runQuery(api.buying.getMaterialLineContext, { materialLineId: args.materialLineId });
        if (!materialLine) throw new Error("Material line not found");

        // 2. Normalize Item Name (if needed)
        // We can call the mutation `prices.normalizeItemName`
        const canonicalItemId = await ctx.runMutation(api.prices.normalizeItemName, { raw: materialLine.label });

        // 3. Get History
        // We can call `prices.getHistory`
        const history = await ctx.runQuery(api.prices.getHistory, { canonicalItemId, limit: 50 });

        // 4. Compute Suggestions
        const prices = history
            .map((h) => (h as { unitPrice?: unknown }).unitPrice)
            .filter((value): value is number => typeof value === "number");
        const stats = calculateStats(prices);
        
        // Group by vendor to find top options
        const vendorStats = new Map<string, { prices: number[], name: string, id?: string }>();
        
        for (const obs of history) {
            const key = obs.vendorId || obs.vendorName || "Unknown";
            if (!vendorStats.has(key)) {
                vendorStats.set(key, { prices: [], name: obs.vendorName || "Unknown", id: obs.vendorId });
            }
            vendorStats.get(key)!.prices.push(obs.unitPrice);
        }

        const options = Array.from(vendorStats.values()).map(v => {
            const vStats = calculateStats(v.prices);
            return {
                vendorName: v.name,
                vendorUrl: undefined,
                priceMin: vStats.min,
                priceMax: vStats.max,
                unit: materialLine.unit, // Use material line unit or observation unit?
                leadTimeDays: undefined, // TODO: Extract from history if available
                notes: `Based on ${v.prices.length} past purchases.`,
                confidence: v.prices.length > 2 ? "high" : "medium",
            };
        }).sort((a, b) => (a.priceMin || 0) - (b.priceMin || 0)).slice(0, 3); // Top 3 cheapest

        // 5. Store Suggestions
        await ctx.runMutation(internal.buying.saveSuggestions, {
            materialLineId: args.materialLineId,
            canonicalItemId,
            source: "history",
            summary: `Found ${history.length} historical records. Median price: ${stats.median.toFixed(2)} ${history[0]?.currency || "ILS"}.`,
            options,
            citations: [],
        });
    },
});

// --- Mutations ---

export const saveSuggestions = internalMutation({
    args: {
        materialLineId: v.id("materialLines"),
        canonicalItemId: v.id("canonicalItems"),
        source: v.union(v.literal("history"), v.literal("research")),
        summary: v.string(),
        options: v.array(v.object({
            vendorName: v.string(),
            vendorUrl: v.optional(v.string()),
            priceMin: v.optional(v.number()),
            priceMax: v.optional(v.number()),
            unit: v.string(),
            leadTimeDays: v.optional(v.number()),
            notes: v.optional(v.string()),
            confidence: v.string(),
        })),
        citations: v.array(v.object({
            title: v.string(),
            url: v.string(),
            snippet: v.string(),
        })),
    },
    handler: async (ctx, args) => {
        // Check if exists, update or insert
        // For simplicity, we'll just insert a new one or replace.
        // Let's delete old ones for this material line to keep it clean?
        // Or just keep history of suggestions?
        // The schema has `buyingSuggestions` indexed by `materialLineId`.
        // We'll just insert.
        
        await ctx.db.insert("buyingSuggestions", {
            materialLineId: args.materialLineId,
            canonicalItemId: args.canonicalItemId,
            source: args.source,
            status: "ready",
            summary: args.summary,
            options: args.options,
            citations: args.citations,
            createdAt: Date.now(),
            expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 7, // 7 days
        });
    },
});

// --- Queries ---

export const getMaterialLineContext = query({
    args: { materialLineId: v.id("materialLines") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.materialLineId);
    },
});

export const getSuggestions = query({
    args: { materialLineId: v.id("materialLines") },
    handler: async (ctx, args) => {
        // Get latest suggestion
        return await ctx.db
            .query("buyingSuggestions")
            .withIndex("by_materialLine_createdAt", (q) => q.eq("materialLineId", args.materialLineId))
            .order("desc")
            .first();
    },
});
