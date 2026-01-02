import { v } from "convex/values";
import { mutation, query, internalQuery } from "./_generated/server";
import { api } from "./_generated/api";
import { buildElementDigest } from "./lib/elementDigest";
import type { Doc, Id } from "./_generated/dataModel";
import { isValidBucketKey, isValidFieldPath } from "./lib/elementRegistry";


function setDeepValue(target: Record<string, unknown>, path: string, value: unknown) {
    const parts = path.split(".");
    let cursor: Record<string, unknown> = target;
    for (let i = 0; i < parts.length - 1; i += 1) {
        const key = parts[i];
        if (!cursor[key] || typeof cursor[key] !== "object") {
            cursor[key] = {};
        }
        cursor = cursor[key] as Record<string, unknown>;
    }
    cursor[parts[parts.length - 1]] = value;
}

function stableHash(input: unknown) {
    const text = JSON.stringify(input ?? "");
    let hash = 5381;
    for (let i = 0; i < text.length; i += 1) {
        hash = (hash * 33) ^ text.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
}

function pickLatestFact(facts: Doc<"facts">[]) {
    return facts
        .slice()
        .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))[0];
}

function coerceFactValue(fact: Doc<"facts">) {
    if (fact.valueTyped !== undefined && fact.valueTyped !== null) return fact.valueTyped;
    if (typeof fact.value === "object" && fact.value !== null) {
        if ("iso" in fact.value) return (fact.value as { iso: string }).iso;
        if ("value" in fact.value) return (fact.value as { value: number }).value;
    }
    return fact.valueTextHe ?? fact.value ?? null;
}

export const listElementVersions = query({
    args: { elementId: v.id("projectItems") },
    handler: async (ctx, args) => {
        const versions = await ctx.db
            .query("elementVersions")
            .withIndex("by_element_createdAt", (q) => q.eq("elementId", args.elementId))
            .collect();
        return versions.sort((a, b) => b.createdAt - a.createdAt);
    },
});

export const listProjectVersions = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const versions = await ctx.db
            .query("projectVersions")
            .withIndex("by_project_createdAt", (q) => q.eq("projectId", args.projectId))
            .collect();
        return versions.sort((a, b) => b.createdAt - a.createdAt);
    },
});

export const listProjectElementVersions = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const versions = await ctx.db
            .query("elementVersions")
            .withIndex("by_project_createdAt", (q) => q.eq("projectId", args.projectId))
            .collect();
        return versions.sort((a, b) => b.createdAt - a.createdAt);
    },
});

export const getActiveSnapshotsByItemIds = internalQuery({
    args: { itemIds: v.array(v.id("projectItems")) },
    handler: async (ctx, args) => {
        const results: Array<{
            itemId: Id<"projectItems">;
            title: string;
            typeKey: string;
            versionId?: Id<"elementVersions">;
            snapshot: unknown | null;
            digestText?: string;
        }> = [];

        for (const itemId of args.itemIds) {
            const item = await ctx.db.get(itemId);
            if (!item) continue;
            const versionId = item.activeVersionId ?? item.publishedVersionId;
            const version = versionId ? await ctx.db.get(versionId) : null;
            const digestText = version?.snapshot ? buildElementDigest(version.snapshot as any) : undefined;
            results.push({
                itemId,
                title: item.title,
                typeKey: item.typeKey,
                versionId: versionId ?? undefined,
                snapshot: version?.snapshot ?? null,
                digestText,
            });
        }

        return results;
    },
});

export const getPendingElementUpdates = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const elements = await ctx.db
            .query("projectItems")
            .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId))
            .collect();

        const pending = new Map<string, number>();
        for (const element of elements) {
            const lastVersionId = element.publishedVersionId ?? null;
            const lastVersion = lastVersionId ? await ctx.db.get(lastVersionId) : null;
            const lastTs = lastVersion?.createdAt ?? 0;

            const acceptedFacts = await ctx.db
                .query("facts")
                .withIndex("by_project_element_status", (q) =>
                    q.eq("projectId", args.projectId)
                        .eq("elementId", element._id)
                        .eq("status", "accepted")
                )
                .collect();

            const changed = acceptedFacts.filter((fact) => (fact.updatedAt ?? fact.createdAt) > lastTs);
            if (changed.length > 0) {
                pending.set(String(element._id), changed.length);
            }
        }

        return Array.from(pending.entries()).map(([elementId, count]) => ({
            elementId: elementId as Id<"projectItems">,
            count,
        }));
    },
});

export const publishElementVersion = mutation({
    args: {
        elementId: v.id("projectItems"),
        createdBy: v.string(),
    },
    handler: async (ctx, args) => {
        const element = await ctx.db.get(args.elementId);
        if (!element) throw new Error("Element not found");
        const project = await ctx.db.get(element.projectId);
        if (project?.features?.factsEnabled === false || project?.features?.elementsCanonical) {
            throw new Error("Facts publishing is disabled for this project.");
        }

        const lastVersionId = element.publishedVersionId ?? null;
        const lastVersion = lastVersionId ? await ctx.db.get(lastVersionId) : null;

        const acceptedFacts = await ctx.db
            .query("facts")
            .withIndex("by_project_element_status", (q) =>
                q.eq("projectId", element.projectId).eq("elementId", element._id).eq("status", "accepted")
            )
            .collect();

        const nextData: Record<string, unknown> = lastVersion?.data ? { ...lastVersion.data } : {};
        const nextFreeText: Record<string, unknown> = lastVersion?.freeText ? { ...lastVersion.freeText } : {};

        const fieldFacts = acceptedFacts.filter((fact) => fact.fieldPath);
        fieldFacts.sort((a, b) => (a.updatedAt ?? a.createdAt) - (b.updatedAt ?? b.createdAt));
        for (const fact of fieldFacts) {
            if (!fact.fieldPath || !isValidFieldPath(fact.fieldPath)) continue;
            setDeepValue(nextData, fact.fieldPath, coerceFactValue(fact));
        }

        const bucketFacts = acceptedFacts.filter((fact) => fact.bucketKey);
        const lastTs = lastVersion?.createdAt ?? 0;
        const bucketsWithChanges = new Set(
            bucketFacts
                .filter((fact) => (fact.updatedAt ?? fact.createdAt) > lastTs)
                .map((fact) => fact.bucketKey)
        );

        const bucketsToUpdate = bucketsWithChanges.size > 0 ? bucketsWithChanges : new Set(bucketFacts.map((fact) => fact.bucketKey));
        for (const bucketKey of bucketsToUpdate) {
            if (!bucketKey || !isValidBucketKey(bucketKey)) continue;
            const matching = bucketFacts.filter((fact) => fact.bucketKey === bucketKey);
            if (matching.length === 0) continue;
            const latest = pickLatestFact(matching);
            nextFreeText[bucketKey] = latest.valueTextHe ?? String(coerceFactValue(latest) ?? "");
        }

        const hashes = {
            dataHash: stableHash(nextData),
            freeTextHashByBucket: Object.fromEntries(
                Object.keys(nextFreeText).map((bucket) => [bucket, stableHash(nextFreeText[bucket])])
            ),
        };

        const diffSummaryHe = "?????? ???? ??????? ?????.";

        const versionId = await ctx.db.insert("elementVersions", {
            projectId: element.projectId,
            elementId: element._id,
            createdAt: Date.now(),
            createdBy: args.createdBy,
            basedOnVersionId: lastVersionId ?? undefined,
            appliedFactIds: acceptedFacts.map((fact) => fact._id),
            data: nextData,
            freeText: nextFreeText,
            hashes,
            diffSummaryHe,
        });

        await ctx.db.patch(element._id, {
            publishedVersionId: versionId,
            elementStatus: element.elementStatus === "suggested" ? "active" : element.elementStatus,
            updatedAt: Date.now(),
        });

        await ctx.runMutation(api.derivations.applyDerivationRun, {
            projectId: element.projectId,
            triggerType: "elementVersion",
            triggerId: versionId,
            mode: "patch",
            elementId: element._id,
            changeSet: {
                elementId: element._id,
                ops: {
                    accounting: [{ op: "recompute_element_rollup", elementId: element._id }],
                },
            },
        });

        return { versionId };
    },
});

export const publishProjectVersion = mutation({
    args: {
        projectId: v.id("projects"),
        createdBy: v.string(),
        noteHe: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const elements = await ctx.db
            .query("projectItems")
            .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId))
            .collect();

        const publishedIds = elements
            .map((element) => element.publishedVersionId)
            .filter((id): id is Id<"elementVersions"> => Boolean(id));

        const hash = stableHash(publishedIds);

        const versionId = await ctx.db.insert("projectVersions", {
            projectId: args.projectId,
            createdAt: Date.now(),
            createdBy: args.createdBy,
            publishedElementVersionIds: publishedIds,
            noteHe: args.noteHe,
            hash,
        });

        return { versionId };
    },
});

export const revertElementVersion = mutation({
    args: {
        elementId: v.id("projectItems"),
        versionId: v.id("elementVersions"),
        createdBy: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const element = await ctx.db.get(args.elementId);
        if (!element) throw new Error("Element not found");

        const targetVersion = await ctx.db.get(args.versionId);
        if (!targetVersion) throw new Error("Version not found");
        if (targetVersion.elementId !== element._id) {
            throw new Error("Version does not belong to element");
        }

        const now = Date.now();
        const createdBy = args.createdBy ?? "user";
        const summary = targetVersion.summary
            ? `Revert: ${targetVersion.summary}`
            : `Revert to ${new Date(targetVersion.createdAt).toLocaleString()}`;

        const newVersionId = await ctx.db.insert("elementVersions", {
            projectId: element.projectId,
            elementId: element._id,
            createdAt: now,
            createdBy,
            basedOnVersionId: element.activeVersionId ?? element.publishedVersionId,
            createdFrom: {
                tab: "history",
                source: "revert",
            },
            tags: ["revert", `revert:${args.versionId}`],
            summary,
            snapshot: targetVersion.snapshot ?? undefined,
            changeStats: targetVersion.changeStats ?? undefined,
        });

        await ctx.db.patch(element._id, {
            activeVersionId: newVersionId,
            updatedAt: now,
        });

        await ctx.runMutation(api.projections.rebuildElement, { elementId: element._id });

        return { versionId: newVersionId };
    },
});
