import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ElementPatchOpsSchema } from "./lib/zodSchemas";
import type { Id } from "./_generated/dataModel";

import { applyPatchOps, normalizeSnapshot } from "./lib/elementSnapshots";
import { api, internal } from "./_generated/api";
import { buildElementDigest } from "./lib/elementDigest";

const originTabSchema = v.union(
  v.literal("Ideation"),
  v.literal("Planning"),
  v.literal("Solutioning"),
  v.literal("Accounting"),
  v.literal("Tasks")
);

const actionTypeSchema = v.union(
  v.literal("manual_edit"),
  v.literal("agent_suggestions"),
  v.literal("dependency_calc"),
  v.literal("critique"),
  v.literal("stress_test"),
  v.literal("risk_scan"),
  v.literal("improve")
);

type ChangeStats = {
  mode: "patchOps" | "snapshot";
  ops: Record<string, number>;
  totalOps: number;
};

function buildEmptySnapshot() {
  return {
    schemaVersion: "element-snapshot/v1",
    descriptions: { short: "", long: "" },
    freeText: {
      preferences: "",
      risks: "",
      openQuestions: "",
      installation: "",
      building: "",
      constraints: "",
      notes: "",
    },
    materials: [],
    labor: [],
    tasks: [],
    tombstones: { taskKeys: [], materialKeys: [], laborKeys: [] },
  };
}

async function loadBaseSnapshot(ctx: {
  db: { get: (id: string) => Promise<{ snapshot?: unknown } | null> };
}, baseVersionId?: string) {
  if (!baseVersionId) return buildEmptySnapshot();
  const version = await ctx.db.get(baseVersionId);
  if (version?.snapshot) return version.snapshot;
  return buildEmptySnapshot();
}

function buildChangeStats(patchOps?: Array<{ op: string; entity?: string }>): ChangeStats {
  if (!patchOps || patchOps.length === 0) {
    return { mode: "snapshot", ops: {}, totalOps: 0 };
  }
  const ops: Record<string, number> = {};
  for (const op of patchOps) {
    const key = op.entity ? `${op.op}:${op.entity}` : op.op;
    ops[key] = (ops[key] ?? 0) + 1;
  }
  return { mode: "patchOps", ops, totalOps: patchOps.length };
}

function buildAutoSummary(revisionSummary?: string) {
  const trimmed = revisionSummary?.trim();
  if (trimmed) return trimmed;
  return "Element snapshot update";
}

export const createDraft = mutation({
  args: {
    projectId: v.id("projects"),
    originTab: originTabSchema,
    actionType: actionTypeSchema,
    summary: v.optional(v.string()),
    createdBy: v.optional(v.string()),
    forceNew: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (!args.forceNew) {
      const existing = await ctx.db
        .query("revisions")
        .withIndex("by_project_tab_status", (q) =>
          q.eq("projectId", args.projectId).eq("originTab", args.originTab).eq("status", "draft")
        )
        .order("desc")
        .first();
      if (existing) {
        return { revisionId: existing._id, reused: true };
      }
    }

    const revisionId = await ctx.db.insert("revisions", {
      projectId: args.projectId,
      status: "draft",
      originTab: args.originTab,
      actionType: args.actionType,
      summary: args.summary ?? "New Draft",
      tags: [],
      affectedElementIds: [],
      createdAt: Date.now(),
      createdBy: args.createdBy ?? "user", // TODO: get from auth
    });
    return { revisionId };
  },
});

export const patchElement = mutation({
  args: {
    revisionId: v.id("revisions"),
    elementId: v.id("projectItems"),
    patchOps: v.any(),
    baseVersionId: v.optional(v.id("elementVersions")),
  },
  handler: async (ctx, args) => {
    // Validate Zod
    const result = ElementPatchOpsSchema.safeParse(args.patchOps);
    if (!result.success) {
      throw new Error("Invalid patchOps: " + JSON.stringify(result.error.flatten()));
    }

    const revision = await ctx.db.get(args.revisionId);
    if (!revision) throw new Error("Revision not found");
    if (revision.status !== "draft") throw new Error("Revision is not a draft");

    const element = await ctx.db.get(args.elementId);
    if (!element) throw new Error("Element not found");

    // Add to affectedElementIds if not present
    if (!revision.affectedElementIds?.includes(args.elementId)) {
      const newAffected = [...(revision.affectedElementIds || []), args.elementId];
      await ctx.db.patch(args.revisionId, { affectedElementIds: newAffected });
    }

    // Check if we already have changes for this element in this revision
    const existingChange = await ctx.db
      .query("revisionChanges")
      .withIndex("by_revision_element", (q) =>
        q.eq("revisionId", args.revisionId).eq("elementId", args.elementId)
      )
      .unique();

    if (existingChange) {
      // Append ops
      const currentOps = existingChange.patchOps || [];
      await ctx.db.patch(existingChange._id, {
        patchOps: [...currentOps, ...result.data],
      });
    } else {
      await ctx.db.insert("revisionChanges", {
        revisionId: args.revisionId,
        elementId: args.elementId,
        baseVersionId: args.baseVersionId ?? element.activeVersionId ?? element.publishedVersionId,
        replaceMask: [], // TODO: calculate mask logic if needed
        patchOps: result.data,
      });
    }
  },
});

export const upsertChange = mutation({
  args: {
    revisionId: v.id("revisions"),
    elementId: v.id("projectItems"),
    proposedSnapshot: v.optional(v.any()),
    replaceMask: v.optional(v.array(v.string())),
    baseVersionId: v.optional(v.id("elementVersions")),
    diffPreview: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const revision = await ctx.db.get(args.revisionId);
    if (!revision) throw new Error("Revision not found");
    if (revision.status !== "draft") throw new Error("Revision is not a draft");

    const element = await ctx.db.get(args.elementId);
    if (!element) throw new Error("Element not found");

    if (!revision.affectedElementIds?.includes(args.elementId)) {
      const newAffected = [...(revision.affectedElementIds || []), args.elementId];
      await ctx.db.patch(args.revisionId, { affectedElementIds: newAffected });
    }

    const existingChange = await ctx.db
      .query("revisionChanges")
      .withIndex("by_revision_element", (q) =>
        q.eq("revisionId", args.revisionId).eq("elementId", args.elementId)
      )
      .unique();

    if (existingChange) {
      await ctx.db.patch(existingChange._id, {
        proposedSnapshot: args.proposedSnapshot ?? existingChange.proposedSnapshot,
        replaceMask: args.replaceMask ?? existingChange.replaceMask,
        diffPreview: args.diffPreview ?? existingChange.diffPreview,
        baseVersionId: args.baseVersionId ?? existingChange.baseVersionId,
      });
      return { changeId: existingChange._id };
    }

    const changeId = await ctx.db.insert("revisionChanges", {
      revisionId: args.revisionId,
      elementId: args.elementId,
      baseVersionId: args.baseVersionId ?? element.activeVersionId ?? element.publishedVersionId,
      replaceMask: args.replaceMask ?? [],
      proposedSnapshot: args.proposedSnapshot,
      diffPreview: args.diffPreview,
    });
    return { changeId };
  },
});

export const approve = mutation({
  args: {
    revisionId: v.id("revisions"),
    approvedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const revision = await ctx.db.get(args.revisionId);
    if (!revision) throw new Error("Revision not found");
    if (revision.status !== "draft") throw new Error("Revision is not a draft");

    const changes = await ctx.db
      .query("revisionChanges")
      .withIndex("by_revision", (q) => q.eq("revisionId", args.revisionId))
      .collect();

    const now = Date.now();
    const approvedBy = args.approvedBy ?? "user";

    for (const change of changes) {
      const element = await ctx.db.get(change.elementId);
      if (!element) continue;

      // Conflict Check
      const currentVersionId = element.activeVersionId ?? element.publishedVersionId;
      if (change.baseVersionId && currentVersionId && change.baseVersionId !== currentVersionId) {
        // Simple conflict strategy: Fail. 
        // In future: allow rebase or force.
        throw new Error(`Conflict detected for element ${element.title} (${element._id}). Base ${change.baseVersionId} != Current ${currentVersionId}`);
      }

      const baseSnapshot = await loadBaseSnapshot(ctx, currentVersionId ?? undefined);

      // Apply Patches
      let newSnapshot;
      if (change.proposedSnapshot) {
        newSnapshot = normalizeSnapshot(change.proposedSnapshot);
      } else if (change.patchOps) {
        newSnapshot = applyPatchOps(baseSnapshot, change.patchOps);
      } else {
        newSnapshot = baseSnapshot; // No op?
      }

      const changeStats = buildChangeStats(change.patchOps ?? undefined);
      const summary = buildAutoSummary(revision.summary);

      const changeTags = new Set(revision.tags ?? []);
      changeTags.add(`tab:${revision.originTab}`);
      changeTags.add(`action:${revision.actionType}`);
      if (change.patchOps) {
        for (const op of change.patchOps) {
          changeTags.add(`change:${op.op}`);
        }
      } else if (change.proposedSnapshot) {
        changeTags.add("change:snapshot");
      }

      // Create new Version
      const versionId = await ctx.db.insert("elementVersions", {
        projectId: revision.projectId,
        elementId: element._id,
        revisionId: revision._id,
        createdAt: now,
        createdBy: approvedBy,
        createdFrom: {
          tab: revision.originTab,
          source: revision.actionType,
        },
        tags: Array.from(changeTags),
        summary,
        changeStats,
        snapshot: newSnapshot,
      });

      // Update Element
      await ctx.db.patch(element._id, {
        activeVersionId: versionId,
        // publishedVersionId: versionId, // Sync for now?
        elementStatus: "active", // Activate if it was suggested
        updatedAt: now,
      });

      try {
        const digestText = buildElementDigest(newSnapshot as any);
        if (digestText) {
          await ctx.runMutation(internal.projectBrain.markNotesCoveredByApproved, {
            projectId: revision.projectId,
            elementId: element._id,
            digestText,
          });
        }
      } catch (error) {
        console.warn("Failed to mark notes covered by approved digest", error);
      }
    }

    // Mark Revision Approved
    await ctx.db.patch(revision._id, {
      status: "approved",
    });

    // Trigger Projections
    await ctx.scheduler.runAfter(0, api.projections.rebuild, { projectId: revision.projectId });
  },
});

export const listDrafts = query({
  args: { projectId: v.id("projects"), originTab: v.optional(originTabSchema) },
  handler: async (ctx, args) => {
    if (args.originTab) {
      return await ctx.db
        .query("revisions")
        .withIndex("by_project_tab_status", (q) =>
          q.eq("projectId", args.projectId).eq("originTab", args.originTab).eq("status", "draft")
        )
        .collect();
    }
    return await ctx.db
      .query("revisions")
      .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId).eq("status", "draft"))
      .collect();
  },
});

export const listSuggestionDrafts = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const drafts = await ctx.db
      .query("revisions")
      .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId).eq("status", "draft"))
      .collect();

    const suggestionDrafts = drafts.filter((draft) =>
      ["agent_suggestions", "dependency_calc", "critique", "stress_test", "risk_scan", "improve"].includes(draft.actionType)
    );

    const results = [];
    for (const draft of suggestionDrafts) {
      const changes = await ctx.db
        .query("revisionChanges")
        .withIndex("by_revision", (q) => q.eq("revisionId", draft._id))
        .collect();

      const elementIds = changes.map((change) => change.elementId);
      const elements = await Promise.all(elementIds.map((id) => ctx.db.get(id)));
      const elementById = new Map(elements.filter(Boolean).map((element) => [element!._id, element!]));

      results.push({
        _id: draft._id,
        summary: draft.summary,
        createdAt: draft.createdAt,
        originTab: draft.originTab,
        actionType: draft.actionType,
        changes: changes.map((change) => {
          const element = elementById.get(change.elementId);
          return {
            _id: change._id,
            elementId: change.elementId,
            elementTitle: element?.title ?? "Unknown element",
            changeType: change.baseVersionId ? "update" : "create",
            mode: change.proposedSnapshot ? "snapshot" : "patchOps",
            patchOpsCount: change.patchOps?.length ?? 0,
            replaceMask: change.replaceMask ?? [],
          };
        }),
      });
    }

    results.sort((a, b) => b.createdAt - a.createdAt);
    return results;
  },
});

export const previewSnapshots = query({
  args: {
    revisionId: v.id("revisions"),
    elementIds: v.array(v.id("projectItems")),
  },
  handler: async (ctx, args) => {
    const revision = await ctx.db.get(args.revisionId);
    if (!revision) throw new Error("Revision not found");

    const countSnapshot = (snapshot: unknown) => {
      const data = snapshot as { tasks?: unknown[]; materials?: unknown[]; labor?: unknown[] } | null;
      return {
        tasks: Array.isArray(data?.tasks) ? data!.tasks.length : 0,
        materials: Array.isArray(data?.materials) ? data!.materials.length : 0,
        labor: Array.isArray(data?.labor) ? data!.labor.length : 0,
      };
    };

    const results: Array<{
      elementId: Id<"projectItems">;
      baseVersionId: Id<"elementVersions"> | undefined;
      snapshot: unknown;
      counts: {
        base: { tasks: number; materials: number; labor: number };
        next: { tasks: number; materials: number; labor: number };
      };
    }> = [];

    for (const elementId of args.elementIds) {
      const element = await ctx.db.get(elementId);
      if (!element) continue;

      const change = await ctx.db
        .query("revisionChanges")
        .withIndex("by_revision_element", (q) =>
          q.eq("revisionId", args.revisionId).eq("elementId", elementId)
        )
        .unique();

      const baseVersionId = (change?.baseVersionId ??
        element.activeVersionId ??
        element.publishedVersionId) as Id<"elementVersions"> | undefined;
      const baseSnapshot = await loadBaseSnapshot(ctx, baseVersionId ?? undefined);

      let snapshot = baseSnapshot;
      if (change?.proposedSnapshot) {
        snapshot = normalizeSnapshot(change.proposedSnapshot);
      } else if (change?.patchOps) {
        snapshot = applyPatchOps(baseSnapshot, change.patchOps);
      }

      results.push({
        elementId,
        baseVersionId,
        snapshot,
        counts: {
          base: countSnapshot(baseSnapshot),
          next: countSnapshot(snapshot),
        },
      });
    }

    return results;
  },
});

export const getDraft = query({
  args: { projectId: v.id("projects"), originTab: originTabSchema },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("revisions")
      .withIndex("by_project_tab_status", (q) =>
        q.eq("projectId", args.projectId).eq("originTab", args.originTab).eq("status", "draft")
      )
      .order("desc")
      .first();
  },
});

export const getRevisionChanges = query({
  args: { revisionId: v.id("revisions") },
  handler: async (ctx, args) => {
    const changes = await ctx.db
      .query("revisionChanges")
      .withIndex("by_revision", (q) => q.eq("revisionId", args.revisionId))
      .collect();
    return changes;
  },
});

export const discardDraft = mutation({
  args: { revisionId: v.id("revisions") },
  handler: async (ctx, args) => {
    const revision = await ctx.db.get(args.revisionId);
    if (!revision) throw new Error("Revision not found");
    if (revision.status !== "draft") throw new Error("Can only discard drafts");

    // Delete changes first
    const changes = await ctx.db
      .query("revisionChanges")
      .withIndex("by_revision", (q) => q.eq("revisionId", args.revisionId))
      .collect();

    for (const change of changes) {
      await ctx.db.delete(change._id);
    }

    await ctx.db.delete(args.revisionId);
  },
});

export const discard = mutation({
  args: { revisionId: v.id("revisions") },
  handler: async (ctx, args) => {
    return await ctx.runMutation(api.revisions.discardDraft, { revisionId: args.revisionId });
  },
});

export const updateSummaryTags = mutation({
  args: {
    revisionId: v.id("revisions"),
    summary: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const revision = await ctx.db.get(args.revisionId);
    if (!revision) throw new Error("Revision not found");
    if (revision.status !== "draft") throw new Error("Only draft revisions can be updated");

    await ctx.db.patch(args.revisionId, {
      summary: args.summary ?? revision.summary,
      tags: args.tags ?? revision.tags,
    });
  },
});
