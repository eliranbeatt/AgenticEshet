import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal, api } from "./_generated/api";

// Helper to format the bundle text deterministically
function formatBundleText(args: {
  bundleId: string;
  stage: string;
  scope: { type: string; itemIds?: string[] };
  itemRefs: { id: string; name: string }[];
  timestamp: number;
  structuredQuestions?: { id: string; text: string }[];
  userAnswers?: { qId: string; quick: string; text?: string }[];
  freeChat?: string;
  agentOutput?: string;
}): string {
  const lines: string[] = [];

  // [TURN_META]
  lines.push("[TURN_META]");
  lines.push(`bundleId=${args.bundleId}`);
  lines.push(`stage=${args.stage}`);
  lines.push(`scope=${args.scope.type}`);

  const itemRefsStr = args.itemRefs
    .map((r) => `{id:"${r.id}",name:"${r.name}"}`)
    .join(", ");
  lines.push(`itemRefs=[${itemRefsStr}]`);

  const selectedIdsStr = args.scope.itemIds
    ? `["${args.scope.itemIds.join('","')}"]`
    : "[]";
  lines.push(`selectedItemIds=${selectedIdsStr}`);
  lines.push(`timestamp=${args.timestamp}`);
  lines.push("");

  // [STRUCTURED_QUESTIONS]
  lines.push("[STRUCTURED_QUESTIONS]");
  if (args.structuredQuestions && args.structuredQuestions.length > 0) {
    args.structuredQuestions.forEach((q, idx) => {
      lines.push(`Q${idx + 1}(id=${q.id}): ${q.text}`);
    });
  } else {
    lines.push("(none)");
  }
  lines.push("");

  // [USER_ANSWERS]
  lines.push("[USER_ANSWERS]");
  if (args.userAnswers && args.userAnswers.length > 0) {
    args.userAnswers.forEach((a, idx) => {
      const textPart = a.text ? ` text="${a.text}"` : "";
      lines.push(`A${idx + 1}(qId=${a.qId}): quick=${a.quick}${textPart}`);
    });
  } else {
    lines.push("(none)");
  }
  lines.push("");

  // [FREE_CHAT]
  lines.push("[FREE_CHAT]");
  if (args.freeChat) {
    lines.push(args.freeChat);
  } else {
    lines.push("(none)");
  }
  lines.push("");

  // [AGENT_OUTPUT]
  lines.push("[AGENT_OUTPUT]");
  if (args.agentOutput) {
    lines.push(args.agentOutput);
  } else {
    lines.push("(none)");
  }

  return lines.join("\n");
}

async function sha256(text: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const createFromTurn = internalMutation({
  args: {
    projectId: v.id("projects"),
    stage: v.union(v.literal("ideation"), v.literal("planning"), v.literal("solutioning")),
    scope: v.object({
      type: v.union(v.literal("project"), v.literal("item"), v.literal("multiItem")),
      itemIds: v.optional(v.array(v.id("projectItems"))),
    }),
    source: v.object({
      type: v.union(v.literal("structuredQuestions"), v.literal("chat"), v.literal("generation"), v.literal("mixed")),
      sourceIds: v.array(v.string()),
    }),
    itemRefs: v.array(v.object({ id: v.string(), name: v.string() })),

    // Content
    structuredQuestions: v.optional(v.array(v.object({ id: v.string(), text: v.string() }))),
    userAnswers: v.optional(v.array(v.object({ qId: v.string(), quick: v.string(), text: v.optional(v.string()) }))),
    freeChat: v.optional(v.string()),
    agentOutput: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    console.log("createFromTurn called for project", args.projectId);
    // 1. Generate ID (we need it for the text)
    // Since we can't know the ID before insertion, we might use a placeholder or insert first?
    // But the text needs to be immutable and contain the ID?
    // Actually, the design says `bundleId=<id>`.
    // We can insert with empty text, get ID, then update text?
    // Or use a UUID? Convex IDs are special.
    // Let's insert with a placeholder text first, then update.

    const timestamp = Date.now();

    const bundleId = await ctx.db.insert("turnBundles", {
      projectId: args.projectId,
      stage: args.stage,
      scope: args.scope,
      source: args.source,
      bundleText: "", // Placeholder
      bundleHash: "", // Placeholder
      createdAt: timestamp,
    });

    // 2. Format text
    const bundleText = formatBundleText({
      bundleId: bundleId,
      stage: args.stage,
      scope: args.scope,
      itemRefs: args.itemRefs,
      timestamp: timestamp,
      structuredQuestions: args.structuredQuestions,
      userAnswers: args.userAnswers,
      freeChat: args.freeChat,
      agentOutput: args.agentOutput,
    });

    // 3. Hash
    const bundleHash = await sha256(bundleText);

    // 4. Update
    await ctx.db.patch(bundleId, {
      bundleText,
      bundleHash,
    });

    // 5. (Legacy knowledge updater removed)

    /* 
    // LEGACY FACTS PIPELINE (DISABLED)
    if (project?.features?.factsV2 !== false) {
      await ctx.scheduler.runAfter(0, internal.factsV2.extractTurnBundle, { turnBundleId: bundleId });
    } else {
      await ctx.scheduler.runAfter(0, internal.facts.parseTurnBundle, { turnBundleId: bundleId });
    }
    
    // LEGACY KNOWLEDGE AGGREGATOR (REMOVED)
    */

    // --- NEW RUNNING MEMORY ---
    // Extract text from user/assistant to pass to summarizer
    // Join structured Q&A and free chat for user text
    const structuredQA = args.userAnswers?.map(a => {
        const qText = args.structuredQuestions?.find(q => q.id === a.qId)?.text ?? "";
        return `Q: ${qText}\nA: ${a.text || a.quick}`;
    }).join("\n") ?? "";

    const userText = [structuredQA, args.freeChat].filter(Boolean).join("\n\n");
    const assistantText = args.agentOutput ?? "";
    
    const elementContext = args.scope.itemIds?.[0]; // Use first item as context if available
    const elementName = args.itemRefs.find(r => r.id === elementContext)?.name;

    await ctx.scheduler.runAfter(0, internal.memory.appendTurnSummary, {
        projectId: args.projectId,
        stage: args.stage,
        channel: args.source.type === "chat" ? "free" : "structured",
        elementContext,
        elementName,
        userText,
        assistantText
    });

    return bundleId;
  },
});

export const listByProject = query({
  args: {
    projectId: v.id("projects"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 15, 50));
    return await ctx.db
      .query("turnBundles")
      .withIndex("by_project_createdAt", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(limit);
  },
});
