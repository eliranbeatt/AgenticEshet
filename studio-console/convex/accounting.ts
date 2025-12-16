import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { calculateSectionSnapshot, getProjectPricingDefaults } from "./lib/costing";

// --------------------------------------------------------------------------
// Queries
// --------------------------------------------------------------------------

export const getProjectAccounting = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Project not found");

    const sections = await ctx.db
      .query("sections")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    // Fetch all lines for the project in bulk (using the denormalized projectId index)
    const allMaterials = await ctx.db
      .query("materialLines")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    const allWork = await ctx.db
      .query("workLines")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    // Organize lines by section
    const materialsBySection = new Map<string, Doc<"materialLines">[]>();
    const workBySection = new Map<string, Doc<"workLines">[]>();

    for (const m of allMaterials) {
      const sid = m.sectionId;
      if (!materialsBySection.has(sid)) materialsBySection.set(sid, []);
      materialsBySection.get(sid)!.push(m);
    }
    for (const w of allWork) {
      const sid = w.sectionId;
      if (!workBySection.has(sid)) workBySection.set(sid, []);
      workBySection.get(sid)!.push(w);
    }

    // Project Defaults
    const defaults = getProjectPricingDefaults(project);

    // Build Result
    const sectionData = sections.map((s) => {
      const mats = materialsBySection.get(s._id) || [];
      const wrk = workBySection.get(s._id) || [];
      const snapshot = calculateSectionSnapshot(s, mats, wrk, defaults);
      
      return {
        section: s,
        materials: mats,
        work: wrk,
        stats: snapshot
      };
    });

    // Sort by group then sortOrder
    sectionData.sort((a, b) => {
      if (a.section.group !== b.section.group) return a.section.group.localeCompare(b.section.group);
      return a.section.sortOrder - b.section.sortOrder;
    });

    // Project Totals
    const totals = sectionData.reduce((acc, curr) => ({
      plannedDirect: acc.plannedDirect + curr.stats.plannedDirectCost,
      plannedClientPrice: acc.plannedClientPrice + curr.stats.plannedClientPrice,
      actualDirect: acc.actualDirect + curr.stats.actualDirectCost,
    }), { plannedDirect: 0, plannedClientPrice: 0, actualDirect: 0 });

    return {
      project,
      sections: sectionData,
      totals
    };
  },
});

export const searchVendors = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    if (!args.query) return [];
    return await ctx.db
      .query("vendors")
      .withSearchIndex("search_name", (q) => q.search("name", args.query))
      .take(10);
  },
});

export const searchMaterialCatalog = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    if (!args.query) return [];
    return await ctx.db
      .query("materialCatalog")
      .withSearchIndex("search_material", (q) => q.search("name", args.query))
      .take(10);
  },
});


// --------------------------------------------------------------------------
// Mutations - Section Management
// --------------------------------------------------------------------------

export const addSection = mutation({
  args: {
    projectId: v.id("projects"),
    group: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    sortOrder: v.number(),
    pricingMode: v.union(v.literal("estimated"), v.literal("actual"), v.literal("mixed")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("sections", args);
  },
});

export const updateSection = mutation({
  args: {
    id: v.id("sections"),
    updates: v.object({
        name: v.optional(v.string()),
        group: v.optional(v.string()),
        description: v.optional(v.string()),
        sortOrder: v.optional(v.number()),
        pricingMode: v.optional(v.union(v.literal("estimated"), v.literal("actual"), v.literal("mixed"))),
        overheadPercentOverride: v.optional(v.number()),
        riskPercentOverride: v.optional(v.number()),
        profitPercentOverride: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, args.updates);
  },
});

export const deleteSection = mutation({
  args: { id: v.id("sections") },
  handler: async (ctx, args) => {
    // Cascade delete lines? Or forbid?
    // For now, let's delete lines to be clean.
    const mats = await ctx.db.query("materialLines").withIndex("by_section", q => q.eq("sectionId", args.id)).collect();
    for (const m of mats) await ctx.db.delete(m._id);
    
    const works = await ctx.db.query("workLines").withIndex("by_section", q => q.eq("sectionId", args.id)).collect();
    for (const w of works) await ctx.db.delete(w._id);

    await ctx.db.delete(args.id);
  },
});

// --------------------------------------------------------------------------
// Mutations - Material Lines
// --------------------------------------------------------------------------

export const addMaterialLine = mutation({
  args: {
    sectionId: v.id("sections"),
    projectId: v.id("projects"),
    category: v.string(),
    label: v.string(),
    description: v.optional(v.string()),
    procurement: v.optional(
      v.union(
        v.literal("in_stock"),
        v.literal("local"),
        v.literal("abroad"),
        v.literal("either")
      )
    ),
    vendorId: v.optional(v.id("vendors")),
    vendorName: v.optional(v.string()),
    unit: v.string(),
    plannedQuantity: v.number(),
    plannedUnitCost: v.number(),
    taxRate: v.optional(v.number()),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("materialLines", {
      ...args,
      procurement: args.procurement ?? "either",
    });
  },
});

export const updateMaterialLine = mutation({
  args: {
    id: v.id("materialLines"),
    updates: v.object({
        category: v.optional(v.string()),
        label: v.optional(v.string()),
        description: v.optional(v.string()),
        procurement: v.optional(
          v.union(
            v.literal("in_stock"),
            v.literal("local"),
            v.literal("abroad"),
            v.literal("either")
          )
        ),
        vendorName: v.optional(v.string()),
        unit: v.optional(v.string()),
        plannedQuantity: v.optional(v.number()),
        plannedUnitCost: v.optional(v.number()),
        actualQuantity: v.optional(v.number()),
        actualUnitCost: v.optional(v.number()),
        status: v.optional(v.string()),
        note: v.optional(v.string()),
    })
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, args.updates);
  },
});

export const deleteMaterialLine = mutation({
  args: { id: v.id("materialLines") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

// --------------------------------------------------------------------------
// Mutations - Work Lines
// --------------------------------------------------------------------------

export const addWorkLine = mutation({
  args: {
    sectionId: v.id("sections"),
    projectId: v.id("projects"),
    workType: v.string(),
    role: v.string(),
    rateType: v.string(),
    plannedQuantity: v.number(),
    plannedUnitCost: v.number(),
    status: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("workLines", args);
  },
});

export const updateWorkLine = mutation({
  args: {
    id: v.id("workLines"),
    updates: v.object({
        workType: v.optional(v.string()),
        role: v.optional(v.string()),
        rateType: v.optional(v.string()),
        plannedQuantity: v.optional(v.number()),
        plannedUnitCost: v.optional(v.number()),
        actualQuantity: v.optional(v.number()),
        actualUnitCost: v.optional(v.number()),
        status: v.optional(v.string()),
        description: v.optional(v.string()),
    })
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, args.updates);
  },
});

export const deleteWorkLine = mutation({
  args: { id: v.id("workLines") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

// --------------------------------------------------------------------------
// Mutations - Catalog & Vendors
// --------------------------------------------------------------------------

export const ensureVendor = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("vendors")
        .withSearchIndex("search_name", q => q.search("name", args.name))
        .first();
    
    if (existing) return existing._id;
    return await ctx.db.insert("vendors", { name: args.name });
  }
});

export const saveToCatalog = mutation({
  args: {
    category: v.string(),
    name: v.string(),
    defaultUnit: v.string(),
    lastPrice: v.number(),
    vendorId: v.optional(v.id("vendors")),
  },
  handler: async (ctx, args) => {
    // Check if exists
    const existing = await ctx.db.query("materialCatalog")
        .withSearchIndex("search_material", q => q.search("name", args.name))
        .first();

    if (existing) {
        await ctx.db.patch(existing._id, {
            lastPrice: args.lastPrice,
            lastUpdated: Date.now(),
            vendorId: args.vendorId ?? existing.vendorId
        });
        return existing._id;
    } else {
        return await ctx.db.insert("materialCatalog", {
            category: args.category,
            name: args.name,
            defaultUnit: args.defaultUnit,
            lastPrice: args.lastPrice,
            vendorId: args.vendorId,
            lastUpdated: Date.now()
        });
    }
  }
});
