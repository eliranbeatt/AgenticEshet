import { MutationCtx } from "../../_generated/server";
import { verifyEvidence } from "./verify";
import { FACT_KEY_REGISTRY, HIGH_RISK_KEYS } from "./registry";
import { Doc, Id } from "../../_generated/dataModel";
import { patchBlocks } from "../knowledgeBlocks/patch";

export async function reconcileOps(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  turnBundleId: Id<"turnBundles">,
  parseRunId: Id<"factParseRuns">,
  ops: any[]
) {
  const bundle = await ctx.db.get(turnBundleId);
  if (!bundle) throw new Error("Bundle not found");

  const stats = {
    opsIn: ops.length,
    factsAdded: 0,
    factsUpdated: 0,
    conflicts: 0,
    notes: 0,
    needsReview: 0,
    rejected: 0,
  };

  const acceptedFactsForPatch: any[] = [];

  for (const op of ops) {
    // 1. Verify Evidence
    const verification = verifyEvidence(bundle.bundleText, op.evidence);
    if (!verification.valid) {
      stats.rejected++;
      continue;
    }

    // 2. Check Registry
    const def = FACT_KEY_REGISTRY[op.key];
    if (!def && op.op !== "NOTE") {
        op.op = "NOTE";
    }

    // 3. Determine Status
    let status = "proposed";
    let needsReview = op.needsReview;

    if (op.op === "NOTE") {
        status = "accepted"; // Notes are accepted as notes
        needsReview = false;
        stats.notes++;
    } else if (op.op === "CONFLICT") {
        status = "conflict";
        needsReview = true;
        stats.conflicts++;
    } else {
        // ADD or UPDATE
        const isHighRisk = HIGH_RISK_KEYS.includes(op.key);
        const isAgentOutput = op.evidence.sourceSection === "AGENT_OUTPUT";
        const highConfidence = op.confidence > 0.85;

        if (!isHighRisk && !isAgentOutput && highConfidence && !needsReview) {
            status = "accepted";
        } else {
            status = "proposed";
            needsReview = true;
        }
    }

    // 4. Check Existing
    let existingFact: Doc<"facts"> | null = null;
    
    if (op.scope.type === "project") {
        existingFact = await ctx.db
            .query("facts")
            .withIndex("by_scope_key", (q) => 
                q.eq("projectId", projectId)
                 .eq("scopeType", "project")
                 .eq("itemId", null)
                 .eq("key", op.key)
            )
            .filter(q => q.eq(q.field("status"), "accepted"))
            .first();
    } else {
        if (!op.scope.itemId) {
            stats.rejected++;
            continue;
        }
        existingFact = await ctx.db
            .query("facts")
            .withIndex("by_scope_key", (q) => 
                q.eq("projectId", projectId)
                 .eq("scopeType", "item")
                 .eq("itemId", op.scope.itemId as Id<"projectItems">)
                 .eq("key", op.key)
            )
            .filter(q => q.eq(q.field("status"), "accepted"))
            .first();
    }

    // 5. Insert
    if (status === "accepted" && op.op !== "NOTE") {
        if (existingFact) {
            if (JSON.stringify(existingFact.value) === JSON.stringify(op.value)) {
                continue;
            }
            await ctx.db.patch(existingFact._id, { status: "superseded" });
            stats.factsUpdated++;
        } else {
            stats.factsAdded++;
        }
    } else if (status === "proposed") {
        stats.needsReview++;
    }

    const factId = await ctx.db.insert("facts", {
        projectId,
        scopeType: op.scope.type,
        itemId: (op.scope.itemId as Id<"projectItems">) || null,
        key: op.key,
        valueType: op.valueType,
        value: op.value,
        status: status as any,
        needsReview,
        confidence: op.confidence,
        sourceKind: op.evidence.sourceSection === "AGENT_OUTPUT" ? "agent" : "user",
        evidence: {
            turnBundleId,
            quote: op.evidence.quote,
            startChar: op.evidence.startChar,
            endChar: op.evidence.endChar,
            sourceSection: op.evidence.sourceSection,
        },
        parseRunId,
        createdAt: Date.now(),
        supersedesFactId: existingFact?._id,
    });

    if (status === "accepted" && op.op !== "NOTE") {
        acceptedFactsForPatch.push({
            _id: factId,
            key: op.key,
            value: op.value,
            scopeType: op.scope.type,
            itemId: (op.scope.itemId as Id<"projectItems">) || null
        });
    }
  }

  if (acceptedFactsForPatch.length > 0) {
    await patchBlocks(ctx, projectId, acceptedFactsForPatch);
  }

  return stats;
}
