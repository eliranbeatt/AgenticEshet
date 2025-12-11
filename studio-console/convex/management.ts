import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

function cleanTags(tags?: string[]) {
    return tags?.map((tag) => tag.trim()).filter(Boolean) ?? [];
}

export const listManagementData = query({
    args: {},
    handler: async (ctx) => {
        const [vendors, employees, materials, purchases] = await Promise.all([
            ctx.db.query("vendors").collect(),
            ctx.db.query("employees").collect(),
            ctx.db.query("materialCatalog").collect(),
            ctx.db.query("purchases").collect(),
        ]);

        return {
            vendors,
            employees,
            materials,
            purchases: purchases.sort((a, b) => (b.purchasedAt ?? b.createdAt) - (a.purchasedAt ?? a.createdAt)),
        };
    },
});

// Vendors -------------------------------------------------------------------

export const createVendor = mutation({
    args: {
        name: v.string(),
        category: v.optional(v.string()),
        contactInfo: v.optional(v.string()),
        rating: v.optional(v.number()),
        description: v.optional(v.string()),
        tags: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("vendors", {
            name: args.name,
            category: args.category,
            contactInfo: args.contactInfo,
            rating: args.rating,
            description: args.description,
            tags: cleanTags(args.tags),
        });
    },
});

export const updateVendor = mutation({
    args: {
        id: v.id("vendors"),
        updates: v.object({
            name: v.optional(v.string()),
            category: v.optional(v.string()),
            contactInfo: v.optional(v.string()),
            rating: v.optional(v.number()),
            description: v.optional(v.string()),
            tags: v.optional(v.array(v.string())),
        }),
    },
    handler: async (ctx, args) => {
        const tags = args.updates.tags ? cleanTags(args.updates.tags) : undefined;
        await ctx.db.patch(args.id, {
            ...args.updates,
            ...(tags ? { tags } : {}),
        });
    },
});

export const deleteVendor = mutation({
    args: { id: v.id("vendors") },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.id);
    },
});

// Employees -----------------------------------------------------------------

export const createEmployee = mutation({
    args: {
        name: v.string(),
        description: v.optional(v.string()),
        tags: v.optional(v.array(v.string())),
        role: v.optional(v.string()),
        contactInfo: v.optional(v.string()),
        status: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("employees", {
            name: args.name,
            description: args.description,
            tags: cleanTags(args.tags),
            role: args.role,
            contactInfo: args.contactInfo,
            status: args.status,
        });
    },
});

export const updateEmployee = mutation({
    args: {
        id: v.id("employees"),
        updates: v.object({
            name: v.optional(v.string()),
            description: v.optional(v.string()),
            tags: v.optional(v.array(v.string())),
            role: v.optional(v.string()),
            contactInfo: v.optional(v.string()),
            status: v.optional(v.string()),
        }),
    },
    handler: async (ctx, args) => {
        const tags = args.updates.tags ? cleanTags(args.updates.tags) : undefined;
        await ctx.db.patch(args.id, {
            ...args.updates,
            ...(tags ? { tags } : {}),
        });
    },
});

export const deleteEmployee = mutation({
    args: { id: v.id("employees") },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.id);
    },
});

// Materials (Catalog) -------------------------------------------------------

export const createMaterial = mutation({
    args: {
        name: v.string(),
        category: v.string(),
        defaultUnit: v.string(),
        lastPrice: v.number(),
        vendorId: v.optional(v.id("vendors")),
        description: v.optional(v.string()),
        tags: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("materialCatalog", {
            category: args.category,
            name: args.name,
            defaultUnit: args.defaultUnit,
            lastPrice: args.lastPrice,
            vendorId: args.vendorId,
            description: args.description,
            tags: cleanTags(args.tags),
            lastUpdated: Date.now(),
        });
    },
});

export const updateMaterial = mutation({
    args: {
        id: v.id("materialCatalog"),
        updates: v.object({
            name: v.optional(v.string()),
            category: v.optional(v.string()),
            defaultUnit: v.optional(v.string()),
            lastPrice: v.optional(v.number()),
            vendorId: v.optional(v.id("vendors")),
            description: v.optional(v.string()),
            tags: v.optional(v.array(v.string())),
        }),
    },
    handler: async (ctx, args) => {
        const tags = args.updates.tags ? cleanTags(args.updates.tags) : undefined;
        await ctx.db.patch(args.id, {
            ...args.updates,
            ...(tags ? { tags } : {}),
            lastUpdated: Date.now(),
        });
    },
});

export const deleteMaterial = mutation({
    args: { id: v.id("materialCatalog") },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.id);
    },
});

// Purchases -----------------------------------------------------------------

export const createPurchase = mutation({
    args: {
        itemName: v.string(),
        description: v.optional(v.string()),
        vendorId: v.optional(v.id("vendors")),
        materialId: v.optional(v.id("materialCatalog")),
        employeeId: v.optional(v.id("employees")),
        projectId: v.optional(v.id("projects")),
        amount: v.number(),
        currency: v.optional(v.string()),
        status: v.optional(v.string()),
        tags: v.optional(v.array(v.string())),
        purchasedAt: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("purchases", {
            itemName: args.itemName,
            description: args.description,
            vendorId: args.vendorId,
            materialId: args.materialId,
            employeeId: args.employeeId,
            projectId: args.projectId,
            amount: args.amount,
            currency: args.currency ?? "ILS",
            status: args.status ?? "recorded",
            tags: cleanTags(args.tags),
            purchasedAt: args.purchasedAt ?? Date.now(),
            createdAt: Date.now(),
        });
    },
});

export const updatePurchase = mutation({
    args: {
        id: v.id("purchases"),
        updates: v.object({
            itemName: v.optional(v.string()),
            description: v.optional(v.string()),
            vendorId: v.optional(v.id("vendors")),
            materialId: v.optional(v.id("materialCatalog")),
            employeeId: v.optional(v.id("employees")),
            projectId: v.optional(v.id("projects")),
            amount: v.optional(v.number()),
            currency: v.optional(v.string()),
            status: v.optional(v.string()),
            tags: v.optional(v.array(v.string())),
            purchasedAt: v.optional(v.number()),
        }),
    },
    handler: async (ctx, args) => {
        const tags = args.updates.tags ? cleanTags(args.updates.tags) : undefined;
        await ctx.db.patch(args.id, {
            ...args.updates,
            ...(tags ? { tags } : {}),
        });
    },
});

export const deletePurchase = mutation({
    args: { id: v.id("purchases") },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.id);
    },
});
