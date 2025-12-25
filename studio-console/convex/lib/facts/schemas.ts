import { v } from "convex/values";

export const evidenceSchema = v.object({
  turnBundleId: v.id("turnBundles"),
  quote: v.string(),
  startChar: v.number(),
  endChar: v.number(),
  sourceSection: v.union(
    v.literal("STRUCTURED_QUESTIONS"),
    v.literal("USER_ANSWERS"),
    v.literal("FREE_CHAT"),
    v.literal("AGENT_OUTPUT")
  ),
});

export const factValueSchema = v.union(
  v.string(),
  v.number(),
  v.boolean(),
  v.object({ value: v.number(), unit: v.string() }), // dimension/currency
  v.object({ min: v.number(), max: v.number() }), // numeric range
  v.object({ iso: v.string() }) // date
);

export const factStatusSchema = v.union(
  v.literal("proposed"),
  v.literal("accepted"),
  v.literal("rejected"),
  v.literal("conflict"),
  v.literal("superseded")
);

export const factSourceKindSchema = v.union(
  v.literal("user"),
  v.literal("agent"),
  v.literal("system"),
  v.literal("manual")
);

export const factScopeTypeSchema = v.union(
  v.literal("project"),
  v.literal("item")
);

export const factParseRunStatusSchema = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed")
);

export const factParseRunStatsSchema = v.object({
  opsIn: v.number(),
  factsAdded: v.number(),
  factsUpdated: v.number(),
  conflicts: v.number(),
  notes: v.number(),
  needsReview: v.number(),
  rejected: v.number(),
});
