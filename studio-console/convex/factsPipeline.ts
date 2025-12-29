import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { buildSearchText } from "./lib/itemHelpers";
import { getRegistryField, getBucketDefinition, isValidBucketKey, isValidFieldPath } from "./lib/elementRegistry";
import type { Doc, Id } from "./_generated/dataModel";
import { api, internal } from "./_generated/api";

function resolveScope(args: { scope?: "project" | "element"; elementId?: Id<"projectItems"> | null }) {
    if (args.scope === "element" || args.elementId) {
        return { scopeType: "item" as const, itemId: args.elementId ?? null, scope: "element" as const };
    }
    return { scopeType: "project" as const, itemId: null, scope: "project" as const };
}

function resolveSourceKind(source?: string | null) {
    if (!source) return "manual" as const;
    if (source === "agent_inference") return "agent" as const;
    if (source === "manual_edit" || source === "migration") return "manual" as const;
    return "user" as const;
}

function resolveLegacyValue(fieldPath?: string, bucketKey?: string, valueTyped?: unknown, valueTextHe?: string) {
    const field = fieldPath ? getRegistryField(fieldPath) : null;
    if (field?.valueType === "date") {
        if (typeof valueTyped === "string" && valueTyped.trim()) {
            return { valueType: "date", value: { iso: valueTyped.trim() } };
        }
        if (typeof valueTextHe === "string" && valueTextHe.trim()) {
            return { valueType: "date", value: { iso: valueTextHe.trim() } };
        }
    }

    if (typeof valueTyped === "number") return { valueType: "number", value: valueTyped };
    if (typeof valueTyped === "boolean") return { valueType: "boolean", value: valueTyped };
    if (typeof valueTyped === "string") return { valueType: "string", value: valueTyped.trim() };

    if (valueTextHe && valueTextHe.trim()) {
        return { valueType: "string", value: valueTextHe.trim() };
    }

    if (bucketKey) {
        return { valueType: "note", value: valueTextHe ?? "" };
    }

    return { valueType: "string", value: "" };
}

function resolveLegacyKey(fieldPath?: string, bucketKey?: string) {
    if (fieldPath) return fieldPath;
    if (bucketKey) return `freeText.${bucketKey}`;
    return "note";
}

function normalizeConfidence(confidence?: number) {
    if (typeof confidence !== "number" || Number.isNaN(confidence)) return 0.5;
    return Math.max(0, Math.min(confidence, 1));
}

export const listFacts = query({
    args: { projectId: v.id("projects"), status: v.optional(v.string()) },
    handler: async (ctx, args) => {
        const facts = await ctx.db
            .query("facts")
            .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId))
            .collect();
        const filtered = args.status ? facts.filter((fact) => fact.status === args.status) : facts;
        return filtered.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
    },
});

export const listFactsGrouped = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const facts = await ctx.db
            .query("facts")
            .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId))
            .collect();

        const grouped = new Map<string, Doc<"facts">[]>();
        for (const fact of facts) {
            const key = fact.categoryHe ?? "????";
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key)!.push(fact);
        }

        return Array.from(grouped.entries()).map(([categoryHe, entries]) => ({
            categoryHe,
            facts: entries.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)),
        }));
    },
});

export const createFact = mutation({
    args: {
        projectId: v.id("projects"),
        scope: v.optional(v.union(v.literal("project"), v.literal("element"))),
        elementId: v.optional(v.union(v.id("projectItems"), v.null())),
        categoryHe: v.string(),
        subCategoryHe: v.optional(v.string()),
        type: v.union(
            v.literal("field_update"),
            v.literal("free_text"),
            v.literal("decision"),
            v.literal("risk"),
            v.literal("preference"),
            v.literal("constraint"),
            v.literal("note")
        ),
        fieldPath: v.optional(v.string()),
        bucketKey: v.optional(v.string()),
        valueTyped: v.optional(v.any()),
        valueTextHe: v.optional(v.string()),
        source: v.optional(v.union(
            v.literal("user_chat"),
            v.literal("user_form"),
            v.literal("file_upload"),
            v.literal("agent_inference"),
            v.literal("manual_edit"),
            v.literal("migration")
        )),
        sourceRef: v.optional(v.string()),
        confidence: v.optional(v.number()),
        status: v.optional(v.union(v.literal("proposed"), v.literal("accepted"), v.literal("rejected"))),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const scope = resolveScope({ scope: args.scope, elementId: args.elementId ?? null });
        const legacyKey = resolveLegacyKey(args.fieldPath, args.bucketKey);
        const legacyValue = resolveLegacyValue(args.fieldPath, args.bucketKey, args.valueTyped, args.valueTextHe);
        const confidence = normalizeConfidence(args.confidence);
        const status = args.status ?? "proposed";

        if (args.fieldPath && !getRegistryField(args.fieldPath)) {
            throw new Error("Unknown fieldPath in registry");
        }
        if (args.bucketKey && !getBucketDefinition(args.bucketKey)) {
            throw new Error("Unknown bucketKey in registry");
        }

        const factId = await ctx.db.insert("facts", {
            projectId: args.projectId,
            scopeType: scope.scopeType,
            itemId: scope.itemId,
            key: legacyKey,
            valueType: legacyValue.valueType,
            value: legacyValue.value,
            status,
            needsReview: status === "proposed",
            confidence,
            sourceKind: resolveSourceKind(args.source ?? null),
            createdAt: now,
            scope: scope.scope,
            elementId: scope.itemId ?? undefined,
            categoryHe: args.categoryHe,
            subCategoryHe: args.subCategoryHe,
            type: args.type,
            fieldPath: args.fieldPath,
            bucketKey: args.bucketKey,
            valueTyped: args.valueTyped,
            valueTextHe: args.valueTextHe,
            source: args.source,
            sourceRef: args.sourceRef,
            updatedAt: now,
        });

        return { factId };
    },
});

export const acceptFact = mutation({
    args: { factId: v.id("facts") },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.factId, { status: "accepted", needsReview: false, updatedAt: Date.now() });
    },
});

export const rejectFact = mutation({
    args: { factId: v.id("facts") },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.factId, { status: "rejected", needsReview: false, updatedAt: Date.now() });
    },
});

export const bulkAcceptFacts = mutation({
    args: { factIds: v.array(v.id("facts")) },
    handler: async (ctx, args) => {
        const now = Date.now();
        for (const factId of args.factIds) {
            await ctx.db.patch(factId, { status: "accepted", needsReview: false, updatedAt: now });
        }
    },
});

export const upsertFactFromAtom = internalMutation({
    args: { factAtomId: v.id("factAtoms") },
    handler: async (ctx, args) => {
        const atom = await ctx.db.get(args.factAtomId);
        if (!atom || atom.status === "duplicate") return null;

        const existing = await ctx.db
            .query("facts")
            .withIndex("by_project_sourceRef", (q) =>
                q.eq("projectId", atom.projectId).eq("sourceRef", atom._id),
            )
            .first();
        if (existing) return existing._id;

        const bucketCandidate = atom.key?.startsWith("freeText.") ? atom.key.slice("freeText.".length) : undefined;
        const fieldPath = atom.key && isValidFieldPath(atom.key) ? atom.key : undefined;
        const bucketKey = bucketCandidate && isValidBucketKey(bucketCandidate) ? bucketCandidate : undefined;

        const status =
            atom.status === "accepted"
                ? "accepted"
                : atom.status === "rejected"
                    ? "rejected"
                    : "proposed";

        const source =
            atom.createdFrom.sourceKind === "agent"
                ? "agent_inference"
                : atom.createdFrom.sourceKind === "doc"
                    ? "file_upload"
                    : "user_chat";

        const scope = atom.scopeType === "item" ? "element" : "project";

        const result = await ctx.runMutation(api.factsPipeline.createFact, {
            projectId: atom.projectId,
            scope,
            elementId: atom.itemId ?? null,
            categoryHe: atom.category ?? "כללי",
            type: fieldPath ? "field_update" : bucketKey ? "free_text" : "note",
            fieldPath,
            bucketKey,
            valueTyped: atom.value,
            valueTextHe: atom.factTextHe,
            source,
            sourceRef: String(atom._id),
            confidence: atom.confidence,
            status,
        });

        return result.factId;
    },
});

export const backfillFromFactAtoms = mutation({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const atoms = await ctx.db
            .query("factAtoms")
            .withIndex("by_project_item", (q) => q.eq("projectId", args.projectId))
            .collect();

        let inserted = 0;
        for (const atom of atoms) {
            const result = await ctx.runMutation(internal.factsPipeline.upsertFactFromAtom, {
                factAtomId: atom._id,
            });
            if (result) inserted += 1;
        }
        return { inserted };
    },
});

export const updateFactMapping = mutation({
    args: {
        factId: v.id("facts"),
        elementId: v.optional(v.union(v.id("projectItems"), v.null())),
        fieldPath: v.optional(v.string()),
        bucketKey: v.optional(v.string()),
        categoryHe: v.optional(v.string()),
        subCategoryHe: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const fact = await ctx.db.get(args.factId);
        if (!fact) throw new Error("Fact not found");

        if (args.fieldPath && !getRegistryField(args.fieldPath)) {
            throw new Error("Unknown fieldPath in registry");
        }
        if (args.bucketKey && !getBucketDefinition(args.bucketKey)) {
            throw new Error("Unknown bucketKey in registry");
        }

        const scope = resolveScope({ scope: fact.scope ?? undefined, elementId: args.elementId ?? null });
        const legacyKey = resolveLegacyKey(args.fieldPath ?? fact.fieldPath, args.bucketKey ?? fact.bucketKey);
        const legacyValue = resolveLegacyValue(
            args.fieldPath ?? fact.fieldPath,
            args.bucketKey ?? fact.bucketKey,
            fact.valueTyped,
            fact.valueTextHe
        );

        await ctx.db.patch(args.factId, {
            elementId: args.elementId ?? null,
            scopeType: scope.scopeType,
            itemId: scope.itemId,
            scope: scope.scope,
            fieldPath: args.fieldPath ?? fact.fieldPath,
            bucketKey: args.bucketKey ?? fact.bucketKey,
            categoryHe: args.categoryHe ?? fact.categoryHe,
            subCategoryHe: args.subCategoryHe ?? fact.subCategoryHe,
            key: legacyKey,
            valueType: legacyValue.valueType,
            value: legacyValue.value,
            updatedAt: Date.now(),
        });
    },
});

export const createSuggestedElement = mutation({
    args: {
        projectId: v.id("projects"),
        titleHe: v.string(),
        typeKey: v.string(),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const itemId = await ctx.db.insert("projectItems", {
            projectId: args.projectId,
            title: args.titleHe,
            name: args.titleHe,
            typeKey: args.typeKey,
            category: args.typeKey,
            kind: "deliverable",
            status: "draft",
            elementStatus: "suggested",
            searchText: buildSearchText({ name: args.titleHe, typeKey: args.typeKey }),
            createdFrom: { source: "agent" },
            latestRevisionNumber: 0,
            createdAt: now,
            updatedAt: now,
        });
        return { elementId: itemId };
    },
});

export const applyMappings = mutation({
    args: {
        projectId: v.id("projects"),
        mappings: v.array(v.object({
            factId: v.id("facts"),
            action: v.union(
                v.literal("map_to_field"),
                v.literal("create_element_and_map"),
                v.literal("keep_project_level_unmapped")
            ),
            elementId: v.optional(v.id("projectItems")),
            createElement: v.optional(v.object({
                titleHe: v.string(),
                typeKey: v.string(),
            })),
            fieldPath: v.optional(v.string()),
            bucketKey: v.optional(v.string()),
            categoryHe: v.optional(v.string()),
            subCategoryHe: v.optional(v.string()),
        })),
    },
    handler: async (ctx, args) => {
        for (const mapping of args.mappings) {
            let elementId = mapping.elementId ?? null;

            if (mapping.action === "create_element_and_map") {
                if (!mapping.createElement) {
                    throw new Error("createElement payload required");
                }
                const created = await ctx.db.insert("projectItems", {
                    projectId: args.projectId,
                    title: mapping.createElement.titleHe,
                    name: mapping.createElement.titleHe,
                    typeKey: mapping.createElement.typeKey,
                    category: mapping.createElement.typeKey,
                    kind: "deliverable",
                    status: "draft",
                    elementStatus: "suggested",
                    searchText: buildSearchText({
                        name: mapping.createElement.titleHe,
                        typeKey: mapping.createElement.typeKey,
                    }),
                    createdFrom: { source: "agent" },
                    latestRevisionNumber: 0,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                });
                elementId = created;
            }

            if (mapping.action === "keep_project_level_unmapped") {
                await ctx.db.patch(mapping.factId, {
                    elementId: null,
                    scopeType: "project",
                    itemId: null,
                    scope: "project",
                    fieldPath: undefined,
                    bucketKey: undefined,
                    updatedAt: Date.now(),
                });
                continue;
            }

            await ctx.db.patch(mapping.factId, {
                elementId,
                scopeType: "item",
                itemId: elementId,
                scope: "element",
                fieldPath: mapping.fieldPath,
                bucketKey: mapping.bucketKey,
                categoryHe: mapping.categoryHe,
                subCategoryHe: mapping.subCategoryHe,
                key: resolveLegacyKey(mapping.fieldPath, mapping.bucketKey),
                updatedAt: Date.now(),
            });
        }

        return { ok: true };
    },
});
